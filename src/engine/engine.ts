// The plan engine: turns plan data + saved state into today's session,
// and folds a finished session back into state. Pure functions only.
import type { AppData } from './data';
import { COUNT_GOAL, HOLD_GOAL, MAX_REPS, MAX_SETS, bellsIn, hasBell, heft, isPair, pairOf, pairsFrom, type Bell, type BreathPattern, type DayKey, type Item, type LadderStep, type Phase, type PlanFile, type Station } from './schema';

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
  /** Ladder step (the plan's bell ladders, e.g. bodyweight → 18). */
  step: number;
  /** Last time earned an offer: more (next), or heavier or harder (heavier). */
  ready: boolean;
  /** Counted work (Nov 23): the total he worked at last time, which next time starts from (never below
   *  the plan's). Missing before Nov 23 and for holds. */
  total?: number;
  /** Counted work: he beat the total last time, so next time offers this, what he did (Nov 23). */
  next?: number;
  /** He reached the goal (40 reps or cycles, or a 3-minute hold): a heavier bell or a harder move next. */
  heavier?: boolean;
}

/** A bell the user picked. Sticks only while the plan's bell for that move is unchanged. */
export interface BellPref {
  bell: Bell;
  planBell: Bell;
}

/** What James proved on a move last time: the most he hit on every set (reps, or seconds
 *  for holds), and with which bell. The plan adapts to it (James, Nov 9). */
export interface Level {
  amount: number;
  bell: Bell | null;
  /** How many sets he did at that amount. Missing in state saved before Nov 13, 2026. */
  sets?: number;
}

/** The routine being followed, and the rotation cycle its Week 1 began (Nov 20, 2026). */
export interface RoutinePick {
  id: string;
  start: number;
}

export interface EngineState {
  pointer: Pointer;
  hold: Hold | null;
  progress: Record<string, ProgressEntry>;
  bellPrefs: Record<string, BellPref>;
  /** Hold times: by move since Nov 22, 2026 (holdKey); by progress key before. Missing before Nov 9. */
  levels: Record<string, Level>;
  /** Missing in state saved before Nov 20, 2026: the first Level 1 routine, from the very start. */
  routine?: RoutinePick;
  /** Plan format the progress belongs to. Before 2 (Nov 20) progress steps meant more reps, not more sets. */
  planVersion?: number;
}

/** 2: progress steps add sets (Nov 20, James: "more sets of lower reps"). 3: hold times by move, and
 *  what a bug in the Nov 20 update could lose rebuilt from the logs (Nov 22). 4: beat the total and next
 *  time's total is what you did, up to 40 or a 3-minute hold, then heavier or harder (Nov 23): rebuilt
 *  from the logs under the new rule. */
export const PLAN_VERSION = 4;

export const initialState = (): EngineState => ({
  pointer: { cycle: 0, slot: 0 },
  hold: null,
  progress: {},
  bellPrefs: {},
  levels: {},
  planVersion: PLAN_VERSION,
});

/** Bring saved state up to date. Before routines (Nov 20): Month 1 is now Level 1's first routine, picked
 *  up at the same week, and old progress steps (more reps) start over. From Nov 20 to 22 a finished
 *  workout dropped the routine and the plan version, and the next open wiped the hold times and steps:
 *  all of that comes back from the logs (Nov 22, James: the dead hang went from his 35s to 15s). */
export function migrateState(saved: EngineState, data: AppData, logs: SessionLog[] = []): EngineState {
  const version = saved.planVersion ?? 1;
  if (version >= PLAN_VERSION) return saved;
  const learned = relearn(logs);
  return {
    ...saved,
    // Rebuilt from the routines' logs under the newest rule (Nov 23)
    progress: learned.progress,
    levels: learned.levels,
    routine: saved.routine ?? routineFromLogs(data, logs) ?? { id: firstRoutine(data).id, start: 0 },
    planVersion: PLAN_VERSION,
  };
}

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

// ---------- Levels and routines (Nov 20, 2026) ----------
// Each level holds several 4-week routines. You follow one; when its weeks are done, the next routine at
// the same level starts by itself, so you can stay at a level as long as you like. Picking a routine
// (or another level) starts it at Week 1, Day A.

export const routineLength = (r: Phase) => r.weeks[1] - r.weeks[0] + 1;

export function firstRoutine(data: AppData, level?: number): Phase {
  return data.routines.find((r) => level === undefined || r.level === level) ?? data.routines[0];
}

/** The routine after this one at the same level (back to the first after the last). */
export function nextRoutine(data: AppData, r: Phase): Phase {
  const same = data.routines.filter((x) => x.level === r.level);
  return same[(same.indexOf(r) + 1) % same.length];
}

/** Which routine a rotation cycle falls in, its week in that routine (1-based), and when it began. */
export function routineAt(data: AppData, pick: RoutinePick | undefined, cycle: number): { routine: Phase; week: number; start: number } {
  let routine = (pick && data.routineById.get(pick.id)) ?? firstRoutine(data);
  let start = pick?.start ?? 0;
  if (cycle < start) start = cycle; // (never expected: a pick is always at or before today)
  for (let guard = 0; cycle - start >= routineLength(routine) && guard < 1000; guard++) {
    start += routineLength(routine);
    routine = nextRoutine(data, routine);
  }
  return { routine, week: cycle - start + routine.weeks[0], start };
}

/** Start a routine now (James, Nov 20): its Week 1, Day A comes next. The rest of a half-done rotation
 *  is dropped; nothing already logged changes. Steps up in the old routine don't carry over. */
export function startRoutine(state: EngineState, routineId: string): EngineState {
  const cycle = state.pointer.slot === 0 ? state.pointer.cycle : state.pointer.cycle + 1;
  return { ...state, pointer: { cycle, slot: 0 }, routine: { id: routineId, start: cycle }, hold: null };
}

export interface WeekContext {
  /** Week within the routine. */
  week: number;
  /** The week used to look up the plan. Lower than `week` while a pain hold is on. */
  effectiveWeek: number;
  phase: Phase;
  held: boolean;
  /** Never true since routines (Nov 20): after the last week the next routine starts. Kept for old logs. */
  beyondPlan: boolean;
  finalWeekOfPhase: boolean;
}

export function weekContext(data: AppData, state: Pick<EngineState, 'pointer' | 'hold' | 'routine'>): WeekContext {
  const { routine, week } = routineAt(data, state.routine, state.pointer.cycle);
  const effectiveWeek = state.hold ? Math.max(routine.weeks[0], Math.min(week, state.hold.week)) : week;
  return { week, effectiveWeek, phase: routine, held: !!state.hold, beyondPlan: false, finalWeekOfPhase: week === routine.weeks[1] };
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

/** The plan's own steps (its bell ladders, e.g. bodyweight → 18). Everything else grows from what James
 *  does (Nov 23): beat the total and next time's total is what you did; holds follow the time held. */
export function ladderOf(r: Resolved): LadderStep[] {
  return r.ladder?.length ? r.ladder : [{}];
}

const isCounted = (kind: Item['kind']) => kind === 'reps' || kind === 'circuit' || kind === 'flow';

/** How many sets a total is split into (Nov 23): about 8 a set, 3 to 5 sets; a total of 5 or less is
 *  done one at a time (get-ups). */
export function splitSets(total: number): number {
  if (total <= MAX_SETS) return Math.max(1, total);
  return Math.min(MAX_SETS, Math.max(3, Math.round(total / 8)));
}

/** A total split evenly over the sets, bigger sets first: 23 over 3 → [8, 8, 7]. */
export function evenSplit(total: number, sets: number): number[] {
  const n = Math.max(1, sets);
  const base = Math.floor(total / n);
  return Array.from({ length: n }, (_, k) => base + (k < total % n ? 1 : 0));
}

/** The next bell up from his own bells, if there is one; with two bells, the next heavier pair of his.
 *  Bodyweight and no-bell moves have none: past the goal they need a harder move. */
function nextBell(bell: Bell | null, bells: number[]): Bell | undefined {
  if (isPair(bell)) return pairsFrom(bells).find((b) => heft(b) > heft(bell));
  if (typeof bell !== 'number') return undefined;
  return [...bells].sort((a, b) => a - b).find((b) => b > bell);
}

/** James's bells: 18, 30 and 45 lb (Nov 24: "I don't have a 35lb bell"). */
export const DEFAULT_BELLS = [18, 30, 45];

/** James has no 35 lb bell (Nov 24: "Switch to 30. I don't have a 35lb bell"). The plan said 35 until then,
 *  so a 35 in his logs, progress or picks was his 30: every bell field (`bell`, `planBell`, pairs too)
 *  that says 35 says 30 instead. Everything else is left as it is. */
export function no35<T>(x: T): T {
  const swap = (b: number) => (b === 35 ? 30 : b);
  const fix = (v: unknown): unknown => {
    if (v === 35) return 30;
    if (!isPair(v as Bell)) return v;
    const [a, b] = bellsIn(v as Bell);
    return pairOf(swap(a), swap(b));
  };
  const walk = (v: unknown, key?: string): unknown => {
    if (Array.isArray(v)) return v.map((y) => walk(y));
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, y]) => [k, walk(y, k)]));
    return key === 'bell' || key === 'planBell' ? fix(v) : v;
  };
  return walk(x) as T;
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
  /** The target was set from what James did last time, not the plan's number. */
  fromLast?: boolean;
  /** He did more than 10 reps a set last time, so the extra work became extra sets (Nov 13). */
  moreSets?: boolean;
  /** Reps moves: the total to get done (per side when perSide), in sets of his own size, each ended
   *  by tapping Rest (James, Nov 19: "prescribe a total number of reps… get it done as fast as
   *  possible"). sets × target, so the plan's numbers and ladders carry over. Missing on plans
   *  saved before Nov 19, which keep counting set by set. */
  total?: number;
}

const low =(v: number | [number, number] | undefined) => (Array.isArray(v) ? v[0] : v ?? 0);

function prescribe(
  r: Resolved,
  step: LadderStep,
  data: AppData,
  bellPrefs: Record<string, BellPref>,
): Prescription {
  const amount = r.kind === 'time' ? step.seconds ?? r.seconds : step.reps ?? r.reps;
  // A circuit's bells are its moves' own; a flow uses one bell for every move
  const planBell = r.kind === 'circuit' ? null : step.bell ?? r.bell ?? null;
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
    // James's default rest (Settings). The plan can't set a rest per move (Nov 9); James can, by
    // changing it during a workout (Nov 13, see restAfter)
    rest: data.plan.defaultRest,
    notes: r.notes,
  };
}

/** Fit the target to what James did last time with this bell (Nov 9). With the plan's bell (or
 *  a lighter one), never ask for less than he hit on every set. With a heavier bell than the
 *  plan's, ask for what he managed with it, even if that's below the plan's number.
 *  Never more than 10 reps a set (Nov 13): past that, the same work comes as more sets of 10. */
function adapt(p: Prescription, level: Level | undefined, kind: Item['kind'], total?: number): Prescription {
  if (kind === 'time') return adaptHold(p, level); // holds follow the time he held
  if (isCounted(kind)) return withTotal(p, kind, total);
  return p;
}

/** Counted work as a total (Nov 19, Nov 23): the plan's sets × reps, or the total he's reached when that's
 *  more, split evenly at about 8 a set. Never more than 5 sets: a plan with more is evened out over 5.
 *  Reps moves carry the total; circuits and flows become rounds (or sets) × an even count. */
function withTotal(p: Prescription, kind: Item['kind'], reached?: number): Prescription {
  const planned = p.sets * p.target;
  const total = Math.max(planned, reached ?? 0);
  const own = total > planned;
  const sets = own ? splitSets(total) : Math.min(p.sets, MAX_SETS);
  const out: Prescription = { ...p, sets, target: Math.ceil(total / sets), ...(own ? { fromLast: true } : {}) };
  return kind === 'reps' ? { ...out, total } : out;
}

/** Holds follow the time he held (Nov 9, Nov 23): his total time over his sets (5 at most). With the plan's
 *  bell (or a lighter one), never less than the plan asks; with a heavier bell, what he managed with it. */
function adaptHold(p: Prescription, level: Level | undefined): Prescription {
  if (!level || level.bell !== p.bell) return p;
  const sets = Math.min(MAX_SETS, level.sets ?? p.sets);
  const heavier = heft(p.bell) > heft(p.planBell);
  if (heavier ? level.amount === p.target && sets === p.sets : level.amount * sets <= p.sets * p.target) return p;
  return { ...p, sets, target: level.amount, fromLast: true };
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

/** One move of a circuit or flow, ready to show. */
export interface PlannedPart {
  move: string;
  name: string;
  /** Its own count, when it differs from the round's (circuits), or times through in a cycle (flows). */
  reps?: number;
  perSide: boolean;
  sideLabel?: string;
  /** Circuits only: this move's bell. */
  bell: Bell | null;
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
  /** Why there's an offer (Nov 23): he beat the total ("more"), or reached the goal and a heavier bell
   *  is next ("heavier"), or reached it with no heavier bell to go to ("harder": a note, no offer). */
  offer?: 'more' | 'heavier' | 'harder';
  /** The ladder step the offer is on (the next one for a ladder bell, else the same). */
  upStep?: number;
  breath?: BreathPlan;
  routine?: RoutinePlan;
  /** Circuits and flows (Nov 20). */
  parts?: PlannedPart[];
}

export interface PlannedSession {
  day: DayKey;
  title: string;
  notes?: string;
  cycle: number;
  slot: number;
  week: number;
  effectiveWeek: number;
  /** The routine (a "phase" before Nov 20). */
  phaseId: string;
  phaseName: string;
  /** Difficulty level and routine length. Missing in sessions logged before Nov 20, 2026. */
  level?: number;
  routineWeeks?: number;
  effort?: string;
  minutes?: string;
  held: boolean;
  beyondPlan: boolean;
  finalWeekOfPhase: boolean;
  checks?: string[];
  /** The workout itself (main work, then breathwork). */
  items: PlannedItem[];
  /** Part 1 of a workout day: the guided warm-up. Walking days have none (Nov 14). */
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
  bells: number[],
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
  // Progress belongs to the routine (Nov 20): a new routine starts from its own plan
  const progressKey = section === 'main' ? `${ctx.phase.id}/${item.progressKey ?? r.move ?? item.id}` : undefined;
  const entry = progressKey ? state.progress[progressKey] : undefined;
  const step = Math.min(Math.max(entry?.step ?? 0, 0), ladder.length - 1);
  const level = progressKey && r.kind === 'time' ? state.levels?.[holdKey(r.move, progressKey)] : undefined;
  const own = prescribe(r, ladder[step], data, state.bellPrefs);
  const stay = adapt(own, level, r.kind, entry?.total);
  // What last time earned (Nov 23): beat the total → what he did; reached the goal → a heavier bell (the
  // plan's next ladder bell, or his next bell up), back to the plan's own numbers; no heavier bell → a note
  let up: Prescription | undefined;
  let upStep: number | undefined;
  let offer: PlannedItem['offer'];
  if (!ctx.held && entry?.ready) {
    if (entry.heavier) {
      const ladderBell = ladder[step + 1]?.bell;
      const bell = r.kind === 'circuit' ? undefined : nextBell(stay.bell, bells);
      if (ladderBell !== undefined) {
        up = adapt(prescribe(r, ladder[step + 1], data, state.bellPrefs), undefined, r.kind);
        upStep = step + 1;
      } else if (bell !== undefined) {
        up = { ...adapt(own, undefined, r.kind), bell };
        upStep = step;
      }
      offer = up ? 'heavier' : 'harder';
    } else if (isCounted(r.kind) && entry.next !== undefined && entry.next > (stay.total ?? stay.sets * stay.target)) {
      up = adapt(own, undefined, r.kind, entry.next);
      upStep = step;
      offer = 'more';
    }
  }
  const parts =
    r.kind === 'circuit' || r.kind === 'flow'
      ? (r.parts ?? []).map(
          (pt): PlannedPart => ({
            move: pt.move,
            name: data.moveById.get(pt.move)?.name ?? pt.move,
            reps: pt.reps,
            perSide: !!pt.perSide,
            sideLabel: pt.sideLabel,
            bell: r.kind === 'circuit' ? pt.bell ?? null : null,
          }),
        )
      : undefined;
  const why = offer ? { offer, ...(up ? { upStep } : {}) } : {};
  return { ...base, progressKey, ladderLen: ladder.length, step, stay, up, ...why, ...(parts ? { parts } : {}) };
}

/** `bells`: his own bells (Settings), for the heavier-bell offer (Nov 23). */
export function planSession(data: AppData, state: EngineState, bells: number[] = DEFAULT_BELLS): PlannedSession {
  const { plan } = data;
  const ctx = weekContext(data, state);
  const day = dayAt(plan, state.pointer);
  const d = ctx.phase.days[day];
  const items: PlannedItem[] = [];
  const add = (list: Item[], section: Section) => {
    for (const it of list) {
      const p = planItem(it, section, ctx, data, state, bells);
      if (p) items.push(p);
    }
  };
  // A workout day has three parts (James, Nov 7, 2026): warm-up, workout, evening holds.
  // A walking day has two: the walk and the evening holds. No warm-up needed (James, Nov 14).
  let warmup: RoutinePlan | undefined;
  if (day !== 'REST') {
    // Guided warm-up timers are their own part, not workout moves.
    const guided: RoutinePlan[] = [];
    for (const it of ctx.phase.warmup) {
      const p = planItem(it, 'warmup', ctx, data, state, bells);
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
  }
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
    level: ctx.phase.level,
    routineWeeks: routineLength(ctx.phase),
    effort: ctx.phase.effort,
    minutes: ctx.phase.minutes,
    held: ctx.held,
    beyondPlan: ctx.beyondPlan,
    finalWeekOfPhase: ctx.finalWeekOfPhase,
    checks: ctx.phase.checks,
    items,
    warmup,
    evening: eveningOf(ctx.phase),
  };
}

function eveningOf(phase: Pick<Phase, 'evening'>): RoutinePlan | undefined {
  const ev = phase.evening;
  return ev && routineOf(ev.title, ev.stations, ev.transition);
}

/** A logged day keeps the plan from when it was saved, but its evening holds follow the
 * latest plan, so a change shows the same day (James, Nov 14). A day logged under an old month or a
 * routine since removed gets the shared evening holds. */
export function withLatestEvening(data: AppData, session: PlannedSession): PlannedSession {
  const phase = data.routineById.get(session.phaseId) ?? data.plan.base;
  const evening = eveningOf(phase);
  return evening ? { ...session, evening } : session;
}

/** The next n sessions in rotation order, starting with the current one. */
export function upcoming(data: AppData, state: EngineState, n: number, bells: number[] = DEFAULT_BELLS): PlannedSession[] {
  const out: PlannedSession[] = [];
  let pointer = state.pointer;
  for (let i = 0; i < n; i++) {
    out.push(planSession(data, { ...state, pointer }, bells));
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
  /** When the set was logged (Nov 19, 2026). Missing before. */
  at?: number;
  /** A set added after the plan's work was done: more than prescribed (James, Nov 23). */
  extra?: boolean;
  /** Seconds rested after this set, from the rest timer: its full length if it ran out (±15 taps
   *  included), or until Skip (Nov 23). Missing when no rest followed. */
  rest?: number;
}

export interface DraftItem {
  plan: PlannedItem;
  choice: 'stay' | 'up';
  bell: Bell | null;
  sets: SetLog[];
  skipped?: boolean;
  /** Each move is timed (James, Nov 19: "time them and keep track"): its clock starts when it becomes
   *  the move being done with no rest running, and stops when its last set is logged. */
  startedAt?: number;
  endedAt?: number;
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
  if (p.total !== undefined) return withPending([], p, bell);
  return Array.from({ length: p.sets }, () => ({ target: p.target, actual: p.target, done: false, bell }));
}

/** Reps done so far (per side when perSide). */
export const repsDone = (sets: SetLog[]): number => sets.reduce((sum, s) => sum + (s.done ? s.actual : 0), 0);

/** Totals mode: the sets done, then a box for every set still to do, each with its planned reps
 *  (James, Nov 24: "I need to see boxes for each set WITH the prescribed reps"). What's left is split
 *  evenly over the plan's sets still to do (bigger sets first, 10 at most, one more set when that's
 *  not enough), so each finished set re-splits the rest. None once the total is reached. A box is only
 *  where the set starts: he can log more than what's left, or more than 10 (Nov 23). */
function withPending(sets: SetLog[], p: Prescription, bell: Bell | null): SetLog[] {
  const done = sets.filter((s) => s.done);
  const left = (p.total ?? 0) - repsDone(done);
  if (left <= 0) return done;
  const n = Math.max(1, p.sets - done.length, Math.ceil(left / MAX_REPS));
  return [...done, ...evenSplit(left, n).filter((r) => r > 0).map((r) => ({ target: r, actual: r, done: false, bell }))];
}

export function startDraft(session: PlannedSession, id: string, now: number): SessionDraft {
  return {
    id,
    startedAt: now,
    session,
    items: session.items.map((plan) => {
      // "More" is pre-picked; a heavier bell is his to pick (18 → 30 is a big jump), Nov 23
      const choice = plan.up && plan.offer !== 'heavier' ? 'up' : 'stay';
      const p = choice === 'up' ? plan.up! : plan.stay;
      return { plan, choice, bell: p.bell, sets: setsFor(p, p.bell) };
    }),
  };
}

/** Pick a bell (one or two) for a move. While sets are left, it's the bell for those sets; sets already
 *  done keep theirs (he can switch bells partway). Once every set is done, picking a bell corrects the
 *  sets done with the old one (James, Nov 24: he picked "2 bells" after finishing and the green boxes
 *  kept the single bell). */
export function pickBell(it: DraftItem, bell: Bell): DraftItem {
  const left = it.sets.some((s) => !s.done);
  const fix = (s: SetLog) => !s.done || (!left && s.bell === it.bell);
  return { ...it, bell, sets: it.sets.map((s) => (fix(s) ? { ...s, bell } : s)) };
}

/** Switch between "move up" and "stay". Sets already done are kept. */
export function setChoice(it: DraftItem, choice: 'stay' | 'up'): DraftItem {
  if (choice === it.choice || (choice === 'up' && !it.plan.up)) return it;
  const p = choice === 'up' ? it.plan.up! : it.plan.stay;
  const bell = p.bell;
  const done = it.sets.filter((s) => s.done);
  if (p.total !== undefined) return { ...it, choice, bell, sets: withPending(done, p, bell) };
  const fresh = setsFor(p, bell).slice(done.length);
  return { ...it, choice, bell, sets: [...done, ...fresh] };
}

/** Log the open set: Rest (or Done, when it reaches the total) in totals mode, else the next set. */
export function completeNext(it: DraftItem): DraftItem {
  const k = it.sets.findIndex((s) => !s.done);
  if (k < 0) return it;
  const p = chosen(it);
  if (p.total === undefined) return completeSetAt(it, k);
  const actual = Math.max(0, it.sets[k].actual);
  const done = [...it.sets.filter((s) => s.done), { ...it.sets[k], actual, done: true, bell: it.bell }];
  return { ...it, sets: withPending(done, p, it.bell) };
}

/** Moves that can take one more set than planned (Nov 23): counted work and holds. */
export const canAddSet = (it: DraftItem) => ['reps', 'time', 'circuit', 'flow'].includes(it.plan.kind);

/** One more set after the plan's work is done (James, Nov 23), sized like the last one he did. */
export function addSet(it: DraftItem): DraftItem {
  if (!canAddSet(it) || it.skipped || it.sets.some((s) => !s.done)) return it;
  const last = [...it.sets].reverse().find((s) => s.done);
  const size = last?.actual ?? chosen(it).target;
  const target = chosen(it).total !== undefined ? size : chosen(it).target;
  return { ...it, sets: [...it.sets, { target, actual: size, done: false, bell: it.bell, extra: true }] };
}

/** Take back an extra set that wasn't done. */
export const dropExtra = (it: DraftItem): DraftItem =>
  it.sets.some((s) => s.extra && !s.done) ? { ...it, sets: it.sets.filter((s) => s.done || !s.extra) } : it;

/** Undo a set: in totals mode it's taken out and its reps go back on what's left. */
export function undoSet(it: DraftItem, k: number): DraftItem {
  const p = chosen(it);
  if (p.total === undefined || it.plan.kind !== 'reps') {
    return { ...it, skipped: false, sets: it.sets.map((s, j) => (j === k ? { ...s, done: false } : s)) };
  }
  const kept = it.sets.filter((s, j) => s.done && j !== k);
  return { ...it, skipped: false, sets: withPending(kept, p, it.bell) };
}

/** Mark set k done with the item's bell. The sets after it start at what was just done,
 *  never below the plan's (James, Nov 9); their boxes show that as the planned number (Nov 24). */
export function completeSetAt(it: DraftItem, k: number): DraftItem {
  const done = { ...it.sets[k], done: true, bell: it.bell };
  const floor = chosen(it).target;
  return {
    ...it,
    sets: it.sets.map((s, j) => {
      if (j === k) return done;
      if (j < k || s.done) return s;
      const n = Math.max(floor, done.actual);
      return { ...s, target: n, actual: n };
    }),
  };
}

/** Which move a rest belongs to (an item without a move uses its own id). */
export const restKey = (it: DraftItem) => chosen(it).move ?? (it.plan.parts ? chosen(it).name : it.plan.itemId);

/** Rest after a set: the rest James last set for this move during a workout, else the default (Nov 13). */
export function restAfter(it: DraftItem, restByMove: Record<string, number>): number {
  const p = chosen(it);
  if (p.rest <= 0) return p.rest;
  return restByMove[restKey(it)] ?? p.rest;
}

export function isItemComplete(it: DraftItem): boolean {
  if (it.skipped) return true;
  const total = chosen(it).total;
  return total !== undefined ? repsDone(it.sets) >= total : it.sets.every((s) => s.done || s.extra);
}

// ---------- Move times (Nov 19) ----------

/** Moves that get a clock: counted and timed sets (not the breathing or guided routines). */
export const isTimedMove = (it: DraftItem) => ['reps', 'time', 'circuit', 'flow'].includes(it.plan.kind);

/** After a change to a move: newly logged sets get `now`; finishing the move stops its clock; undoing
 *  a set reopens it. A move logged without its clock running starts it at that first set. */
export function stampTimes(after: DraftItem, now: number): DraftItem {
  const sets = after.sets.map((s) => (s.done && s.at === undefined ? { ...s, at: now } : s));
  const next = { ...after, sets };
  const anyDone = sets.some((s) => s.done);
  const finished = !after.skipped && anyDone && isItemComplete(next);
  return {
    ...next,
    startedAt: after.startedAt ?? (anyDone ? now : undefined),
    endedAt: finished ? after.endedAt ?? now : undefined,
  };
}

/** How long the move took, in ms (its clock, rests between its sets included). */
export function moveTime(it: Pick<DraftItem, 'startedAt' | 'endedAt'>): number | undefined {
  if (it.startedAt === undefined || it.endedAt === undefined || it.endedAt < it.startedAt) return undefined;
  return it.endedAt - it.startedAt;
}

/** The work a time was for, so times are only compared like for like: "24 reps @45", "3 × 30 s @45". */
export function workOf(it: DraftItem): string {
  const p = chosen(it);
  const side = it.plan.perSide ? ` ${it.plan.sideLabel ?? 'per side'}` : '';
  const amount =
    p.total !== undefined
      ? `${p.total} reps${side}`
      : it.plan.kind === 'time'
        ? `${p.sets} × ${p.target} s${side}`
        : it.plan.kind === 'circuit'
          ? `${p.sets} rounds of ${p.target}`
          : it.plan.kind === 'flow'
            ? `${p.sets} × ${p.target} cycles${side}`
            : `${p.sets} × ${p.target}${side}`;
  const bell = it.bell === null ? '' : it.bell === 'BW' ? ' bodyweight' : ` @${it.bell}`;
  return amount + bell;
}

export interface MoveTime {
  date: string;
  startedAt: number;
  ms: number;
  work: string;
}

/** Every saved time for a move, newest first. */
export function timesFor(sessions: Pick<SessionLog, 'date' | 'startedAt' | 'items'>[], move: string): MoveTime[] {
  const out: MoveTime[] = [];
  for (const s of sessions) {
    for (const it of s.items) {
      const ms = moveTime(it);
      if (ms !== undefined && chosen(it).move === move) out.push({ date: s.date, startedAt: s.startedAt, ms, work: workOf(it) });
    }
  }
  return out.sort((a, b) => b.startedAt - a.startedAt);
}

/** Last and best time for the same work (bell and total) as this move today. */
export function lastAndBest(times: MoveTime[], work: string): { last?: MoveTime; best?: MoveTime; lastAny?: MoveTime } {
  const same = times.filter((t) => t.work === work);
  const best = same.reduce<MoveTime | undefined>((b, t) => (!b || t.ms < b.ms ? t : b), undefined);
  return { last: same[0], best, lastAny: times[0] };
}


export function kbReps(items: DraftItem[]): number {
  let total = 0;
  for (const it of items) {
    for (const s of it.sets) {
      if (!s.done) continue;
      if (it.plan.kind === 'reps' && hasBell(s.bell)) total += s.actual * (it.plan.perSide ? 2 : 1);
      // A circuit round: each move with a bell, at its own count or the round's
      if (it.plan.kind === 'circuit')
        for (const pt of it.plan.parts ?? []) if (hasBell(pt.bell)) total += (pt.reps ?? s.actual) * (pt.perSide ? 2 : 1);
      // A flow set: every move in the cycle, times the cycles
      if (it.plan.kind === 'flow' && hasBell(s.bell)) {
        const perCycle = (it.plan.parts ?? []).reduce((n, pt) => n + (pt.reps ?? 1), 0);
        total += s.actual * perCycle * (it.plan.perSide ? 2 : 1);
      }
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

/** What the workouts teach the plan (Nov 9–22): move-up steps, hold times and bell picks. */
interface Learned {
  progress: Record<string, ProgressEntry>;
  bellPrefs: Record<string, BellPref>;
  levels: Record<string, Level>;
}

/** Hold times are kept by move (James, Nov 22: "is the dead hang remembering my time preferences?"), so
 *  they carry over from routine to routine. A hold without a move of its own keeps its progress key. */
export const holdKey = (move: string | undefined, progressKey: string) => move ?? progressKey;

/** One logged workout's lessons, added to what was learned before it. */
function learn(before: Learned, items: DraftItem[], pain: boolean): Learned {
  const progress = { ...before.progress };
  const bellPrefs = { ...before.bellPrefs };
  const levels = { ...(before.levels ?? {}) };

  for (const it of items) {
    const p = chosen(it);
    const didAny = it.sets.some((s) => s.done);
    const key = it.plan.progressKey;
    // The plan's sets; extra sets (Nov 23) are more than it asked, so they never count against it
    const planned = it.sets.filter((s) => !s.extra);

    if (it.plan.section === 'main' && key && didAny) {
      // Move-up steps belong to a routine ("routine/item" keys, Nov 20). Older keys counted reps: skipped.
      if (key.includes('/')) {
        // Logs from before Nov 23 have no upStep: their offer was the next ladder step
        const step = it.choice === 'up' && it.plan.up ? it.plan.upStep ?? it.plan.step + 1 : it.plan.step;
        progress[key] = { step, ready: false };
        // Counted work (Nov 23, James: "If I do more reps in a particular set AND the total rep load
        // increases… next time we increase the total rep load"): the total done, with no joint pain. Past
        // the total → next time's offer is what he did; at 40 or more → a heavier bell or a harder move.
        if (isCounted(it.plan.kind)) {
          const asked = p.total ?? p.sets * p.target;
          const did = repsDone(it.sets);
          const finished = !it.skipped && did >= asked && (p.total !== undefined || planned.every((s) => s.done));
          const heavier = finished && !pain && did >= COUNT_GOAL;
          const more = finished && !pain && !heavier && did > asked;
          progress[key] = { step, ready: heavier || more, total: asked, ...(heavier ? { heavier } : more ? { next: did } : {}) };
        }
      }

      // Holds follow the time he held (Nov 9, Nov 23): every planned set done and no joint pain. More time
      // in all than he was asked for with the same bell (extra sets count), or a heavier bell: next time is
      // his total time evened out over his sets, 5 at most. 3 minutes in all (per side) → heavier or harder.
      if (it.plan.kind === 'time' && !pain && !it.skipped && planned.length > 0 && planned.every((s) => s.done)) {
        const lastBell = planned[planned.length - 1].bell;
        const withBell = it.sets.filter((s) => s.done && s.bell === lastBell);
        const held = withBell.reduce((sum, s) => sum + s.actual, 0);
        const sets = Math.min(MAX_SETS, withBell.length);
        const hk = holdKey(p.move, key);
        // The bar: what he was asked for, or the time he'd already reached with this bell (a log replayed
        // after a wipe was planned without it)
        const cur = levels[hk];
        const reached = cur && cur.bell === p.bell ? cur.amount * Math.min(MAX_SETS, cur.sets ?? p.sets) : 0;
        const beat = lastBell === p.bell && held > Math.max(p.sets * p.target, reached);
        const heavier = heft(lastBell) > heft(p.bell);
        if (beat || heavier) levels[hk] = { amount: Math.ceil(held / sets), bell: lastBell, sets };
        if (key.includes('/') && held >= HOLD_GOAL) progress[key] = { ...progress[key], ready: true, heavier: true };
      }
    }

    if (p.move && p.planBell !== null && didAny) {
      const lastDone = [...it.sets].reverse().find((s) => s.done);
      const usedBell = lastDone?.bell ?? it.bell;
      if (usedBell !== null && usedBell !== p.planBell) bellPrefs[p.move] = { bell: usedBell, planBell: p.planBell };
      else delete bellPrefs[p.move];
    }
  }

  // Joint pain: no offers; the total he was working at stays
  if (pain)
    for (const [k, e] of Object.entries(progress))
      progress[k] = { step: e.step, ready: false, ...(e.total !== undefined ? { total: e.total } : {}) };
  return { progress, bellPrefs, levels };
}

/** Everything the logs teach, oldest first (Nov 22): rebuilds hold times and move-up steps that a
 *  bug in the Nov 20 update could wipe. */
export function relearn(logs: SessionLog[]): Pick<Learned, 'progress' | 'levels'> {
  let acc: Learned = { progress: {}, bellPrefs: {}, levels: {} };
  for (const log of [...logs].sort((a, b) => a.startedAt - b.startedAt)) {
    if (log.status === 'done' || log.status === 'partial') acc = learn(acc, log.items ?? [], !!log.pain);
  }
  return { progress: acc.progress, levels: acc.levels };
}

/** The routine of the latest logged day, at the same week (Nov 22: a finished workout could drop it). */
export function routineFromLogs(data: AppData, logs: SessionLog[]): RoutinePick | undefined {
  const last = [...logs].sort((a, b) => b.startedAt - a.startedAt).find((l) => data.routineById.has(l.session?.phaseId));
  if (!last) return undefined;
  const r = data.routineById.get(last.session.phaseId)!;
  return { id: r.id, start: last.session.cycle - (last.session.week - r.weeks[0]) };
}

export function finishSession(
  plan: PlanFile,
  state: EngineState,
  draft: SessionDraft,
  answers: { effort: number; pain: boolean },
  now: number,
): FinishResult {
  // An extra set added but not done is dropped (Nov 23)
  draft = { ...draft, items: draft.items.map(dropExtra) };
  const trained = new Set<string>();
  for (const it of draft.items) {
    const p = chosen(it);
    if (p.move && it.sets.some((s) => s.done)) trained.add(p.move);
  }
  const { progress, bellPrefs, levels } = learn(state, draft.items, answers.pain);
  const hold = answers.pain ? { week: draft.session.effectiveWeek, since: localDate(now) } : null;

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
    // Everything else (the routine, the plan version) carries on as it was
    state: { ...state, pointer: advance(plan, state.pointer), hold, progress, bellPrefs, levels },
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
