// The plan engine: turns plan data + saved state into today's session,
// and folds a finished session back into state. Pure functions only.
import type { AppData } from './data';
import type { Bell, BreathPattern, DayKey, Item, LadderStep, Phase, PlanFile, Station } from './schema';

// ---------- State ----------

export interface Pointer {
  /** Completed rotation cycles. Week = cycle + 1. */
  cycle: number;
  /** Position in plan.rotation. */
  slot: number;
}

/** Joint pain reported: increases freeze at the week the pain was reported. */
export interface Hold {
  week: number;
  since: string;
}

export interface ProgressEntry {
  step: number;
  ready: boolean;
}

/** A bell the user picked. Sticks only while the plan's bell for that move is unchanged. */
export interface BellPref {
  bell: Bell;
  planBell: Bell;
}

export interface EngineState {
  pointer: Pointer;
  hold: Hold | null;
  progress: Record<string, ProgressEntry>;
  bellPrefs: Record<string, BellPref>;
}

export const initialState = (): EngineState => ({
  pointer: { cycle: 0, slot: 0 },
  hold: null,
  progress: {},
  bellPrefs: {},
});

// ---------- Pointer ----------

export function dayAt(plan: PlanFile, p: Pointer): DayKey {
  return plan.rotation[p.slot];
}

export function advance(plan: PlanFile, p: Pointer): Pointer {
  const slot = p.slot + 1;
  return slot >= plan.rotation.length ? { cycle: p.cycle + 1, slot: 0 } : { cycle: p.cycle, slot };
}

export function back(plan: PlanFile, p: Pointer): Pointer {
  if (p.slot > 0) return { cycle: p.cycle, slot: p.slot - 1 };
  if (p.cycle > 0) return { cycle: p.cycle - 1, slot: plan.rotation.length - 1 };
  return p;
}

// ---------- Weeks and phases ----------

export interface WeekContext {
  week: number;
  /** The week used to look up the plan. Lower than `week` while a pain hold is on. */
  effectiveWeek: number;
  phase: Phase;
  held: boolean;
  /** Past the last week in the plan data; repeating the final week. */
  beyondPlan: boolean;
  finalWeekOfPhase: boolean;
}

export function weekContext(plan: PlanFile, p: Pointer, hold: Hold | null): WeekContext {
  const week = p.cycle + 1;
  let effectiveWeek = hold ? Math.min(week, hold.week) : week;
  const last = plan.phases[plan.phases.length - 1];
  let beyondPlan = false;
  if (effectiveWeek > last.weeks[1]) {
    effectiveWeek = last.weeks[1];
    beyondPlan = true;
  }
  const phase =
    plan.phases.find((ph) => effectiveWeek >= ph.weeks[0] && effectiveWeek <= ph.weeks[1]) ??
    [...plan.phases].reverse().find((ph) => ph.weeks[0] <= effectiveWeek) ??
    plan.phases[0];
  return { week, effectiveWeek, phase, held: !!hold, beyondPlan, finalWeekOfPhase: effectiveWeek === phase.weeks[1] };
}

// ---------- Item resolution ----------

export type Section = 'warmup' | 'main' | 'cooldown';

/** An item with week overrides applied. */
type Resolved = Item;

export function resolveItem(item: Item, week: number, phase: Phase, section: Section): Resolved | null {
  if (item.weeks && (week < item.weeks[0] || week > item.weeks[1])) return null;
  const r: Resolved = { ...item };
  const keys = Object.keys(item.byWeek ?? {}).map(Number).sort((a, b) => a - b);
  for (const k of keys) if (week >= k) Object.assign(r, item.byWeek![String(k)]);
  const cap = phase.setCapInWeek?.[String(week)];
  if (cap && section === 'main' && r.sets) r.sets = Math.min(r.sets, cap);
  return r;
}

export function ladderOf(r: Resolved): LadderStep[] {
  if (r.ladder?.length) return r.ladder;
  if (r.kind === 'reps' && Array.isArray(r.reps)) {
    const [a, b] = r.reps;
    return Array.from({ length: b - a + 1 }, (_, i) => ({ reps: a + i }));
  }
  if (r.kind === 'time' && Array.isArray(r.seconds)) {
    const [a, b] = r.seconds;
    const steps: LadderStep[] = [];
    for (let s = a; s < b; s += 5) steps.push({ seconds: s });
    steps.push({ seconds: b });
    return steps;
  }
  return [{}];
}

export interface Prescription {
  name: string;
  move?: string;
  sets: number;
  /** Target reps (reps items) or seconds (time items), per side when perSide. */
  target: number;
  /** The plan's range, for display ("8–10"). */
  range?: [number, number];
  /** Bell to use: the user's own pick if it still applies, else the plan's. Null = no bell. */
  bell: Bell | null;
  /** What the plan says, before the user's pick. */
  planBell: Bell | null;
  rest: number;
  notes?: string;
}

const low = (v: number | [number, number] | undefined) => (Array.isArray(v) ? v[0] : v ?? 0);

function prescribe(
  r: Resolved,
  step: LadderStep,
  data: AppData,
  bellPrefs: Record<string, BellPref>,
): Prescription {
  const amount = r.kind === 'time' ? step.seconds ?? r.seconds : step.reps ?? r.reps;
  const planBell = step.bell ?? r.bell ?? null;
  const pref = r.move ? bellPrefs[r.move] : undefined;
  const bell = planBell !== null && pref && pref.planBell === planBell ? pref.bell : planBell;
  const rangeSrc = r.kind === 'time' ? r.seconds : r.reps;
  return {
    name: r.label ?? (r.move ? data.moveById.get(r.move)?.name ?? r.move : r.id),
    move: r.move,
    sets: step.sets ?? r.sets ?? 1,
    target: low(amount),
    range: Array.isArray(rangeSrc) ? rangeSrc : undefined,
    bell,
    planBell,
    rest: r.rest ?? data.plan.defaultRest,
    notes: r.notes,
  };
}

export interface BreathPlan {
  patternKey: string;
  pattern: BreathPattern;
  minutes: number;
}

export interface RoutinePlan {
  title: string;
  stations: Station[];
  transition: number;
  /** Total length, including transitions. */
  seconds: number;
  notes?: string;
}

function routineOf(title: string, stations: Station[], transition: number, notes?: string): RoutinePlan {
  const seconds = stations.reduce((sum, st) => sum + st.seconds, 0) + transition * Math.max(0, stations.length - 1);
  return { title, stations, transition, seconds, notes };
}

export interface PlannedItem {
  itemId: string;
  section: Section;
  kind: Item['kind'];
  perSide: boolean;
  sideLabel?: string;
  progressKey?: string;
  ladderLen: number;
  step: number;
  stay: Prescription;
  /** The next ladder step, offered when the last session went to plan. */
  up?: Prescription;
  breath?: BreathPlan;
  routine?: RoutinePlan;
}

export interface PlannedSession {
  day: DayKey;
  title: string;
  notes?: string;
  cycle: number;
  slot: number;
  week: number;
  effectiveWeek: number;
  phaseId: string;
  phaseName: string;
  effort?: string;
  minutes?: string;
  held: boolean;
  beyondPlan: boolean;
  finalWeekOfPhase: boolean;
  checks?: string[];
  /** The workout itself (main work, then breathwork). */
  items: PlannedItem[];
  /** Part 1 of the day: the guided warm-up (workout days) or the wake-up routine (rest days). */
  warmup?: RoutinePlan;
  /** Part 3 of the day: the evening holds. */
  evening?: RoutinePlan;
}

function planItem(
  item: Item,
  section: Section,
  ctx: WeekContext,
  data: AppData,
  state: EngineState,
): PlannedItem | null {
  const r = resolveItem(item, ctx.effectiveWeek, ctx.phase, section);
  if (!r) return null;
  const base = {
    itemId: item.id,
    section,
    kind: r.kind,
    perSide: !!r.perSide,
    sideLabel: r.sideLabel,
  };

  if (r.kind === 'breath') {
    const keys = r.patterns?.length ? r.patterns : Object.keys(data.plan.breathPatterns);
    const patternKey = keys[(state.pointer.cycle + state.pointer.slot) % keys.length];
    const pattern = data.plan.breathPatterns[patternKey];
    const minutes = r.minutes ?? 4;
    return {
      ...base,
      ladderLen: 1,
      step: 0,
      stay: { name: r.label ?? pattern.name, sets: 1, target: minutes * 60, bell: null, planBell: null, rest: 0 },
      breath: { patternKey, pattern, minutes },
    };
  }

  if (r.kind === 'routine') {
    const extra = r.routine ? ctx.phase[r.routine] : undefined;
    const stations = [...(extra?.stations ?? []), ...(r.stations ?? [])];
    if (!stations.length) return null;
    const routine = routineOf(r.label ?? extra?.title ?? 'Routine', stations, r.transition ?? extra?.transition ?? 0, r.notes);
    return {
      ...base,
      ladderLen: 1,
      step: 0,
      stay: { name: routine.title, sets: 1, target: routine.seconds, bell: null, planBell: null, rest: r.rest ?? 0, notes: r.notes },
      routine,
    };
  }

  const ladder = ladderOf(r);
  const progressKey = section === 'main' ? item.progressKey ?? r.move ?? item.id : undefined;
  const entry = progressKey ? state.progress[progressKey] : undefined;
  const step = Math.min(Math.max(entry?.step ?? 0, 0), ladder.length - 1);
  const stay = prescribe(r, ladder[step], data, state.bellPrefs);
  const canOffer = !ctx.held && !!entry?.ready && step + 1 < ladder.length;
  const up = canOffer ? prescribe(r, ladder[step + 1], data, state.bellPrefs) : undefined;
  return { ...base, progressKey, ladderLen: ladder.length, step, stay, up };
}

export function planSession(data: AppData, state: EngineState): PlannedSession {
  const { plan } = data;
  const ctx = weekContext(plan, state.pointer, state.hold);
  const day = dayAt(plan, state.pointer);
  const d = ctx.phase.days[day];
  const items: PlannedItem[] = [];
  const add = (list: Item[], section: Section) => {
    for (const it of list) {
      const p = planItem(it, section, ctx, data, state);
      if (p) items.push(p);
    }
  };
  // A day has three parts (James, Nov 7, 2026): warm-up, workout, evening holds.
  let warmup: RoutinePlan | undefined;
  if (day !== 'REST') {
    // Guided warm-up timers are their own part, not workout moves.
    const guided: RoutinePlan[] = [];
    for (const it of ctx.phase.warmup) {
      const p = planItem(it, 'warmup', ctx, data, state);
      if (p?.routine) guided.push(p.routine);
      else if (p) items.push(p);
    }
    if (guided.length === 1) warmup = guided[0];
    else if (guided.length > 1)
      warmup = routineOf(guided[0].title, guided.flatMap((g) => g.stations), guided[0].transition, guided[0].notes);
    add(d.items ?? [], 'main');
    add(ctx.phase.cooldown, 'cooldown');
  } else {
    add(d.items ?? [], 'main');
    const m = ctx.phase.morning;
    if (m) warmup = routineOf(m.title, m.stations, m.transition);
  }
  const ev = ctx.phase.evening;
  return {
    day,
    title: d.title,
    notes: d.notes,
    cycle: state.pointer.cycle,
    slot: state.pointer.slot,
    week: ctx.week,
    effectiveWeek: ctx.effectiveWeek,
    phaseId: ctx.phase.id,
    phaseName: ctx.phase.name,
    effort: ctx.phase.effort,
    minutes: ctx.phase.minutes,
    held: ctx.held,
    beyondPlan: ctx.beyondPlan,
    finalWeekOfPhase: ctx.finalWeekOfPhase,
    checks: ctx.phase.checks,
    items,
    warmup,
    evening: ev && routineOf(ev.title, ev.stations, ev.transition),
  };
}

/** The next n sessions in rotation order, starting with the current one. */
export function upcoming(data: AppData, state: EngineState, n: number): PlannedSession[] {
  const out: PlannedSession[] = [];
  let pointer = state.pointer;
  for (let i = 0; i < n; i++) {
    out.push(planSession(data, { ...state, pointer }));
    pointer = advance(data.plan, pointer);
  }
  return out;
}

// ---------- Logging a session ----------

export interface SetLog {
  target: number;
  actual: number;
  done: boolean;
  bell: Bell | null;
}

export interface DraftItem {
  plan: PlannedItem;
  choice: 'stay' | 'up';
  bell: Bell | null;
  sets: SetLog[];
  skipped?: boolean;
}

export interface SessionDraft {
  id: string;
  startedAt: number;
  session: PlannedSession;
  items: DraftItem[];
}

export type SessionStatus = 'done' | 'partial' | 'skipped' | 'rest';

export interface SessionLog {
  id: string;
  date: string; // YYYY-MM-DD, local
  startedAt: number;
  endedAt: number;
  status: SessionStatus;
  session: PlannedSession;
  items: DraftItem[];
  effort?: number;
  pain?: boolean;
  walk?: boolean;
  kbReps: number;
}

export const chosen = (it: DraftItem | { plan: PlannedItem; choice: 'stay' | 'up' }): Prescription =>
  it.choice === 'up' && it.plan.up ? it.plan.up : it.plan.stay;

function setsFor(p: Prescription, bell: Bell | null): SetLog[] {
  return Array.from({ length: p.sets }, () => ({ target: p.target, actual: p.target, done: false, bell }));
}

export function startDraft(session: PlannedSession, id: string, now: number): SessionDraft {
  return {
    id,
    startedAt: now,
    session,
    items: session.items.map((plan) => {
      const choice = plan.up ? 'up' : 'stay';
      const p = choice === 'up' ? plan.up! : plan.stay;
      return { plan, choice, bell: p.bell, sets: setsFor(p, p.bell) };
    }),
  };
}

/** Switch between "move up" and "stay". Sets already done are kept. */
export function setChoice(it: DraftItem, choice: 'stay' | 'up'): DraftItem {
  if (choice === it.choice || (choice === 'up' && !it.plan.up)) return it;
  const p = choice === 'up' ? it.plan.up! : it.plan.stay;
  const bell = p.bell;
  const done = it.sets.filter((s) => s.done);
  const fresh = setsFor(p, bell).slice(done.length);
  return { ...it, choice, bell, sets: [...done, ...fresh] };
}

export function isItemComplete(it: DraftItem): boolean {
  return it.skipped || it.sets.every((s) => s.done);
}

export function kbReps(items: DraftItem[]): number {
  let total = 0;
  for (const it of items) {
    if (it.plan.kind !== 'reps') continue;
    for (const s of it.sets) {
      if (s.done && typeof s.bell === 'number') total += s.actual * (it.plan.perSide ? 2 : 1);
    }
  }
  return total;
}

export function localDate(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export interface FinishResult {
  log: SessionLog;
  state: EngineState;
  /** Moves that were trained, so the library can show them unlocked. */
  trained: string[];
}

export function finishSession(
  plan: PlanFile,
  state: EngineState,
  draft: SessionDraft,
  answers: { effort: number; pain: boolean },
  now: number,
): FinishResult {
  const progress = { ...state.progress };
  const bellPrefs = { ...state.bellPrefs };
  const trained = new Set<string>();

  for (const it of draft.items) {
    const p = chosen(it);
    const didAny = it.sets.some((s) => s.done);
    if (p.move && didAny) trained.add(p.move);

    if (it.plan.section === 'main' && it.plan.progressKey && didAny) {
      const used = it.choice === 'up' && it.plan.up ? it.plan.step + 1 : it.plan.step;
      const allToPlan = !it.skipped && it.sets.length > 0 && it.sets.every((s) => s.done && s.actual >= s.target);
      progress[it.plan.progressKey] = { step: used, ready: allToPlan && !answers.pain };
    }

    if (p.move && p.planBell !== null && didAny) {
      const lastDone = [...it.sets].reverse().find((s) => s.done);
      const usedBell = lastDone?.bell ?? it.bell;
      if (usedBell !== null && usedBell !== p.planBell) bellPrefs[p.move] = { bell: usedBell, planBell: p.planBell };
      else delete bellPrefs[p.move];
    }
  }

  let hold = state.hold;
  if (answers.pain) {
    hold = { week: draft.session.effectiveWeek, since: localDate(now) };
    for (const k of Object.keys(progress)) progress[k] = { ...progress[k], ready: false };
  } else {
    hold = null;
  }

  const allDone = draft.items.every(isItemComplete) && draft.items.every((it) => !it.skipped);
  const log: SessionLog = {
    id: draft.id,
    date: localDate(draft.startedAt),
    startedAt: draft.startedAt,
    endedAt: now,
    status: allDone ? 'done' : 'partial',
    session: draft.session,
    items: draft.items,
    effort: answers.effort,
    pain: answers.pain,
    kbReps: kbReps(draft.items),
  };

  return {
    log,
    trained: [...trained],
    state: { pointer: advance(plan, state.pointer), hold, progress, bellPrefs },
  };
}

/** Log a rest day or a skipped day and move the rotation on. */
export function passDay(
  plan: PlanFile,
  state: EngineState,
  session: PlannedSession,
  kind: 'rest' | 'skipped',
  id: string,
  now: number,
  walk?: boolean,
): { log: SessionLog; state: EngineState } {
  return {
    log: {
      id,
      date: localDate(now),
      startedAt: now,
      endedAt: now,
      status: kind,
      session,
      items: [],
      walk,
      kbReps: 0,
    },
    state: { ...state, pointer: advance(plan, state.pointer) },
  };
}
