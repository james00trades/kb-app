import { describe, expect, it } from 'vitest';
import { loadData } from '../src/engine/data';
import {
  addSet, advance, back, chosen, completeNext, completeSetAt, dropExtra, evenSplit, finishSession, firstRoutine, initialState, isItemComplete, kbReps,
  lastAndBest, lastTime, migrateState, moveTime, nextRoutine, passDay, PLAN_VERSION, planSession, repsDone, restAfter, restKey, routineAt, setChoice, splitSets, stampTimes,
  startDraft, startRoutine, timesFor, undoSet, upcoming, withLatestEvening, workOf,
  type DraftItem, type EngineState, type PlannedSession, type SessionDraft,
} from '../src/engine/engine';

const data = loadData();
const { plan } = data;
const NOW = new Date(2026, 10, 4, 7, 0).getTime();
const FOUNDATIONS = 'l1-foundations';

/** State positioned at a given week (1-based) and day letter's first slot, in a routine (Foundations by default). */
function at(week: number, day: 'A' | 'B' | 'C' | 'REST', base: EngineState = initialState(), routine?: string): EngineState {
  const pick = routine ? { id: routine, start: 0 } : base.routine;
  return { ...base, routine: pick, pointer: { cycle: week - 1, slot: plan.rotation.indexOf(day) } };
}

/** Progress keys belong to the routine (Nov 20). */
const key = (k: string, routine = FOUNDATIONS) => `${routine}/${k}`;

const item = (s: PlannedSession, id: string) => s.items.find((i) => i.itemId === id);

/** Every move done at the plan's own set size: holds, circuits and flows set by set; reps moves to their total. */
function completeAll(d: SessionDraft): SessionDraft {
  return { ...d, items: d.items.map(finishItem) };
}

function finishItem(it: DraftItem): DraftItem {
  if (chosen(it).total === undefined) return { ...it, sets: it.sets.map((s) => ({ ...s, done: true })) };
  let x = it;
  for (let n = 0; n < 100 && !isItemComplete(x); n++) x = completeNext(x);
  return x;
}

/** Log sets of these sizes on a reps move (Rest taps), in totals mode. Past the total, each one is an
 *  extra set ("Did more? Log another set", Nov 23). */
function logSets(it: DraftItem, sizes: number[]): DraftItem {
  let x = it;
  for (const n of sizes) {
    if (!x.sets.some((s) => !s.done)) x = addSet(x);
    x = { ...x, sets: x.sets.map((s) => (s.done ? s : { ...s, actual: n })) };
    x = completeNext(x);
  }
  return x;
}

const draftItem = (id: string, week = 2, day: 'A' | 'B' | 'C' = 'A', routine?: string) =>
  startDraft(planSession(data, at(week, day, initialState(), routine)), 'x', NOW).items.find((it) => it.plan.itemId === id)!;

function runSession(state: EngineState, pain = false, edit?: (d: SessionDraft) => SessionDraft) {
  const s = planSession(data, state);
  let d = completeAll(startDraft(s, 'x', NOW));
  if (edit) d = edit(d);
  return finishSession(plan, state, d, { effort: 6, pain }, NOW + 1_800_000);
}

/** Swap one item of a finished draft for a version of it. */
const withItem = (id: string, fn: (it: DraftItem) => DraftItem) => (d: SessionDraft) => ({
  ...d,
  items: d.items.map((it) => (it.plan.itemId === id ? fn(it) : it)),
});

/** Every planned workout day of every routine, weeks 1–4. */
function everyDay(): { routine: string; week: number; day: 'A' | 'B' | 'C'; s: PlannedSession }[] {
  const out = [];
  for (const r of data.routines)
    for (const week of [1, 2, 3, 4])
      for (const day of ['A', 'B', 'C'] as const) out.push({ routine: r.id, week, day, s: planSession(data, at(week, day, initialState(), r.id)) });
  return out;
}

describe('rotation pointer', () => {
  it('runs A B C A B C REST, then starts the next week', () => {
    let p = { cycle: 0, slot: 0 };
    const days: string[] = [];
    for (let i = 0; i < 8; i++) {
      days.push(plan.rotation[p.slot]);
      p = advance(plan, p);
    }
    expect(days).toEqual(['A', 'B', 'C', 'A', 'B', 'C', 'REST', 'A']);
    expect(p).toEqual({ cycle: 1, slot: 1 });
  });

  it('goes back one, across a week boundary, never below the start', () => {
    expect(back(plan, { cycle: 1, slot: 0 })).toEqual({ cycle: 0, slot: 6 });
    expect(back(plan, { cycle: 0, slot: 0 })).toEqual({ cycle: 0, slot: 0 });
  });

  it('skipping logs the day and moves on', () => {
    const st = at(1, 'A');
    const r = passDay(plan, st, planSession(data, st), 'skipped', 'id', NOW);
    expect(r.log.status).toBe('skipped');
    expect(r.state.pointer).toEqual({ cycle: 0, slot: 1 });
  });
});

describe('levels and routines (James, Nov 20)', () => {
  it('four levels, each with several 4-week routines; Level 1 starts with Foundations', () => {
    expect(plan.levels.map((l) => [l.n, l.name])).toEqual([[1, 'Beginner'], [2, 'Intermediate'], [3, 'Intermediate+'], [4, 'Advanced']]);
    for (const l of plan.levels) {
      const rs = data.routines.filter((r) => r.level === l.n);
      expect(rs.length, `level ${l.n}`).toBeGreaterThanOrEqual(3);
      for (const r of rs) expect(r.weeks).toEqual([1, 4]);
    }
    expect(firstRoutine(data).id).toBe(FOUNDATIONS);
    expect(planSession(data, initialState()).phaseId).toBe(FOUNDATIONS); // a new phone, before a routine is picked
  });

  it('after 4 weeks the next routine at the same level starts by itself, round and round', () => {
    const level1 = data.routines.filter((r) => r.level === 1).map((r) => r.id);
    const at4 = routineAt(data, undefined, 3);
    expect([at4.routine.id, at4.week]).toEqual([FOUNDATIONS, 4]);
    const at5 = routineAt(data, undefined, 4);
    expect([at5.routine.id, at5.week, at5.start]).toEqual([level1[1], 1, 4]);
    expect(routineAt(data, undefined, 4 * level1.length).routine.id).toBe(FOUNDATIONS); // back to the first
    expect(nextRoutine(data, data.routineById.get(level1.at(-1)!)!).id).toBe(FOUNDATIONS);
    const s = planSession(data, at(5, 'A'));
    expect([s.phaseId, s.week, s.level, s.routineWeeks, s.finalWeekOfPhase]).toEqual([level1[1], 1, 1, 4, false]);
    expect(planSession(data, at(4, 'C')).finalWeekOfPhase).toBe(true);
  });

  it('the next 7 days show the switch to the next routine', () => {
    const days = upcoming(data, at(4, 'C'), 7);
    expect(days.map((d) => [d.phaseId, d.week, d.day])).toEqual([
      [FOUNDATIONS, 4, 'C'], [FOUNDATIONS, 4, 'A'], [FOUNDATIONS, 4, 'B'], [FOUNDATIONS, 4, 'C'], [FOUNDATIONS, 4, 'REST'],
      ['l1-ironwood', 1, 'A'], ['l1-ironwood', 1, 'B'],
    ]);
  });

  it('picking a routine starts it at Week 1, Day A, even mid-week; nothing logged changes', () => {
    const mid = startRoutine(at(3, 'B'), 'l2-anvil');
    expect(mid.pointer).toEqual({ cycle: 3, slot: 0 });
    expect(mid.routine).toEqual({ id: 'l2-anvil', start: 3 });
    const s = planSession(data, mid);
    expect([s.phaseId, s.week, s.day, s.level]).toEqual(['l2-anvil', 1, 'A', 2]);
    // At the start of a rotation it begins right away
    expect(startRoutine(at(3, 'A'), 'l3-raider').pointer).toEqual({ cycle: 2, slot: 0 });
  });

  it('state saved before routines carries on in Foundations at the same week; old rep steps start over', () => {
    const old = {
      pointer: { cycle: 2, slot: 1 },
      hold: null,
      progress: { deadlift: { step: 2, ready: true } },
      bellPrefs: { deadlift: { bell: 35 as const, planBell: 45 } },
      levels: { deadlift: { amount: 10, bell: 45 as const, sets: 3 } },
    } as EngineState;
    const m = migrateState(old, data);
    expect(m).toMatchObject({ routine: { id: FOUNDATIONS, start: 0 }, progress: {}, levels: {}, planVersion: PLAN_VERSION });
    expect(m.bellPrefs).toEqual(old.bellPrefs); // his bell picks stay
    expect(planSession(data, m)).toMatchObject({ phaseId: FOUNDATIONS, week: 3, day: 'B' });
    expect(migrateState(m, data)).toBe(m); // once only
  });

  it('every routine keeps the rules: 10 reps a set at most, counted circuits and flows of 2+ moves', () => {
    for (const { routine, week, day, s } of everyDay()) {
      for (const it of s.items) {
        const where = `${routine} w${week} ${day} ${it.itemId}`;
        if (it.kind === 'reps' || it.kind === 'circuit' || it.kind === 'flow') expect(it.stay.target, where).toBeLessThanOrEqual(10);
        if (it.kind === 'circuit' || it.kind === 'flow') {
          expect(it.parts!.length, where).toBeGreaterThanOrEqual(2);
          expect(it.stay.total, where).toBeUndefined();
        }
      }
    }
  });

  it('Level 1 is straight sets with a few easy flows; 2 is circuits; 3 adds 3–4-move flows; 4 is mostly flows', () => {
    const count = (routine: string, kind: string, min = 0) =>
      everyDay()
        .filter((d) => d.routine === routine && d.week === 2)
        .flatMap((d) => d.s.items)
        .filter((i) => i.kind === kind && (i.parts?.length ?? 0) >= min).length;
    for (const r of data.routines) {
      if (r.level === 1) {
        expect(count(r.id, 'circuit'), r.id).toBe(0);
        expect(count(r.id, 'flow'), r.id).toBeGreaterThanOrEqual(1);
        expect(count(r.id, 'reps'), r.id).toBeGreaterThan(count(r.id, 'flow'));
      }
      if (r.level === 2) for (const day of ['A', 'B', 'C'] as const) expect(r.days[day].items!.some((i) => i.kind === 'circuit'), `${r.id} ${day}`).toBe(true);
      if (r.level === 3) expect(count(r.id, 'flow', 3), r.id).toBeGreaterThanOrEqual(4);
      if (r.level === 4) {
        expect(count(r.id, 'flow'), r.id).toBeGreaterThan(count(r.id, 'circuit'));
        expect(count(r.id, 'flow', 4), r.id).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("James's own flows are in: clean → swing → high pull → snatch, and swing → high pull → goblet squat → press", () => {
    const flows = data.routines.flatMap((r) => Object.values(r.days).flatMap((d) => d.items ?? [])).filter((i) => i.kind === 'flow');
    const chains = flows.map((f) => f.parts!.map((p) => p.move).join(' > '));
    expect(chains).toContain('clean > single-arm-swing > high-pull > snatch');
    expect(chains).toContain('single-arm-swing > high-pull > goblet-squat > single-arm-press');
  });

  it('volume never drops week to week, and nothing asks for more than 5 sets (Nov 23)', () => {
    const work = (x: PlannedSession['items'][number]) => x.stay.total ?? x.stay.sets * x.stay.target;
    for (const r of data.routines) {
      for (const day of ['A', 'B', 'C'] as const) {
        const byWeek = [2, 3, 4].map((w) => planSession(data, at(w, day, initialState(), r.id)).items.filter((i) => i.section === 'main'));
        for (const it of byWeek[0]) {
          if (it.kind === 'time') continue;
          const later = byWeek.slice(1).map((items) => items.find((x) => x.itemId === it.itemId && x.stay.move === it.stay.move));
          for (const x of later) if (x) expect(work(x), `${r.id} ${day} ${it.itemId}`).toBeGreaterThanOrEqual(work(it));
        }
      }
    }
    for (const { routine, s } of everyDay()) for (const i of s.items) expect(i.stay.sets, `${routine} ${i.itemId}`).toBeLessThanOrEqual(5);
  });
});

describe('Level 1 · Foundations', () => {
  it('week 1 day A: 2 sets of everything, hinge drill with the 45, no swings', () => {
    const s = planSession(data, at(1, 'A'));
    expect(s.title).toBe('Hinge and press');
    expect(item(s, 'a-hinge-drill')!.stay).toMatchObject({ sets: 2, bell: 45, planBell: 45, target: 10 }); // James does it with the 45 (Nov 16)
    expect(item(s, 'a-deadlift')!.stay).toMatchObject({ sets: 2, target: 6, bell: 45, total: 12 });
    expect(item(s, 'a-swing')).toBeUndefined();
    expect(s.items.filter((i) => i.section === 'warmup')).toHaveLength(0); // the warm-up is its own part
    expect(s.items.filter((i) => i.section === 'cooldown')[0].breath).toBeDefined();
  });

  it('every workout day has three parts: warm-up, workout, evening holds (James, Nov 7)', () => {
    for (const r of data.routines) {
      for (const day of ['A', 'B', 'C'] as const) {
        for (const week of [1, 4]) {
          const s = planSession(data, at(week, day, initialState(), r.id));
          const labels = s.warmup!.stations.map((st) => st.label);
          // Trevor's wake-up mixed in with the bodyweight moves, so the leg moves are spread out (James, Nov 14)
          expect(labels).toEqual([
            'Arm circles forward', 'Arm circles backward', 'Jumping twists', 'Arm swings', 'Lunge reaches', 'Elbow throws',
            'Monk squats', 'Push-ups (knees or bench OK)', 'Ragdoll twists', 'Cossack squats', 'Body waves', 'Plank (knees OK)',
            'Side bends', 'Hindu push-ups', 'Hip hinges (wall drill)',
          ]);
          const legs = ['Jumping twists', 'Lunge reaches', 'Monk squats', 'Cossack squats', 'Hip hinges (wall drill)'];
          labels.forEach((l, k) => expect(legs.includes(l) && legs.includes(labels[k + 1]), `${l} then ${labels[k + 1]}`).toBe(false));
          expect(labels.some((l) => /burpee/i.test(l))).toBe(false); // no burpees (James, Nov 7)
          expect(new Set(labels).size).toBe(labels.length); // no repeats (James, Nov 8)
          expect(s.warmup!.seconds).toBe(420); // 7 min: 5 min wake-up + 4 × 30 s
          expect(s.items[0].section).toBe('main'); // the workout starts with the main work
          expect(s.items.some((i) => i.kind === 'routine')).toBe(false);
          // James's 9 evening stretches (Nov 9) + a deep quad stretch (Nov 14); pigeon, couch and the lying twist on each side
          expect(s.evening!.stations.map((st) => st.label)).toEqual([
            'Reverse prayer pose', 'Deep twist squats', 'Downward dog pulses',
            'Pigeon pose, left leg forward', 'Pigeon pose, right leg forward',
            'Couch stretch, left leg back', 'Couch stretch, right leg back', 'Frog pose', 'Cobra', 'Straddle',
            'Lying spinal twist, knee to the left', 'Lying spinal twist, knee to the right', 'Bridge (regressed)', // lying, not seated (Nov 16)
          ]);
          expect(s.evening!.stations.every((st) => st.seconds === 60)).toBe(true); // 60 s holds (James, Nov 14)
          expect(s.evening!.seconds).toBe(13 * 60 + 12 * 10);
          expect(s.items.at(-1)!.breath).toBeDefined(); // the breathing stays at the end
        }
      }
    }
  });

  it('a walking day has no warm-up: just the walk, then the evening holds (James, Nov 14)', () => {
    for (const week of [1, 4]) {
      const s = planSession(data, at(week, 'REST'));
      expect(s.warmup).toBeUndefined();
      expect(s.evening).toBeDefined();
      expect(s.items).toEqual([]);
    }
  });

  it('a day already logged shows the latest evening holds, not the ones saved with it (James, Nov 14)', () => {
    const now = planSession(data, at(2, 'B'));
    const oldHolds = { ...now.evening!, stations: now.evening!.stations.slice(0, 11).map((st) => ({ ...st, seconds: 120 })), seconds: 1420 };
    const saved: PlannedSession = { ...now, evening: oldHolds, items: now.items.slice(0, 1) };
    const shown = withLatestEvening(data, saved);
    expect(shown.evening).toEqual(now.evening);
    expect(shown.items).toBe(saved.items); // the workout itself stays as saved
    // A day logged under the old Month 1 (before routines) gets the shared evening holds too
    expect(withLatestEvening(data, { ...saved, phaseId: 'm1' }).evening).toEqual(now.evening);
  });

  it('week 2: 3 sets, hike passes 5 × 5 on the 35', () => {
    const s = planSession(data, at(2, 'A'));
    expect(item(s, 'a-deadlift')!.stay).toMatchObject({ sets: 3, total: 18 });
    expect(item(s, 'a-swing')!.stay).toMatchObject({ move: 'hike-pass', sets: 5, target: 5, bell: 35 });
    expect(item(s, 'a-hinge-drill')).toBeDefined();
  });

  it('week 3: hinge drill gone, dead-stop swings, one more set instead of more reps (James, Nov 20)', () => {
    const a = planSession(data, at(3, 'A'));
    expect(item(a, 'a-hinge-drill')).toBeUndefined();
    expect(item(a, 'a-swing')!.stay).toMatchObject({ move: 'full-stop-swing', sets: 5, target: 6, total: 30 }); // the plan's 6 × 5, over 5 sets (Nov 23)
    expect(item(a, 'a-deadlift')!.stay).toMatchObject({ sets: 4, target: 6, total: 24 });
    expect(item(a, 'a-goblet-squat')!.stay).toMatchObject({ sets: 4, target: 6, total: 24 });
    expect(item(a, 'a-press')!.stay).toMatchObject({ sets: 4, target: 5, total: 20 });
    expect(item(planSession(data, at(3, 'B')), 'b-swing')!.stay.move).toBe('full-stop-swing');
  });

  it('week 4: two-hand swings 6 × 6 on the 45, done in 5 sets; deadlifts and goblet squats 5 × 6', () => {
    const s = planSession(data, at(4, 'A'));
    expect(item(s, 'a-swing')!.stay).toMatchObject({ move: 'two-hand-swing', sets: 5, target: 8, bell: 45, total: 36 });
    expect(item(s, 'a-deadlift')!.stay.total).toBe(30);
    expect(item(s, 'a-goblet-squat')!.stay.total).toBe(30);
  });

  it('breathwork rotates through the patterns', () => {
    const keys = new Set([1, 2, 3].map((w) => planSession(data, at(w, 'A')).items.at(-1)!.breath!.patternKey));
    expect(keys.size).toBe(3);
  });

  it('arm bar 10 per side; the mini-flow is a flow of 5 cycles a set on the 18', () => {
    const c = planSession(data, at(2, 'C'));
    expect(item(c, 'c-arm-bar')).toMatchObject({ kind: 'reps', perSide: true, stay: { total: 10, bell: 18 } });
    expect(item(c, 'c-mini-flow')).toMatchObject({ kind: 'flow', perSide: false, stay: { sets: 3, target: 5, bell: 18 } });
    expect(item(c, 'c-mini-flow')!.parts!.map((p) => p.move)).toEqual(['halo', 'goblet-squat', 'halo']);
  });
});

describe('beat the total and it goes up; 40 means heavier or harder (James, Nov 23)', () => {
  /** Week 2 Day A deadlift (3 × 6 = 18 on the 45), done in sets of these sizes. */
  const dl = (sizes: number[]) => withItem('a-deadlift', () => logSets(draftItem('a-deadlift'), sizes));
  const fresh = (st: EngineState, id: string) => startDraft(planSession(data, st), 'x', NOW).items.find((x) => x.plan.itemId === id)!;

  it('just the total, whatever the set sizes: nothing changes', () => {
    for (const sizes of [[6, 6, 6], [9, 9], [10, 8]]) {
      const r = runSession(at(2, 'A'), false, dl(sizes));
      expect(r.log.status).toBe('done');
      expect(r.state.progress[key('deadlift')], String(sizes)).toEqual({ step: 0, ready: false, total: 18 });
      expect(item(planSession(data, at(2, 'A', r.state)), 'a-deadlift')!.up).toBeUndefined();
    }
  });

  it('more than the total: next time offers what he did, evened out at about 8 a set', () => {
    const r = runSession(at(2, 'A'), false, dl([8, 8, 7])); // 23
    expect(r.state.progress[key('deadlift')]).toEqual({ step: 0, ready: true, total: 18, next: 23 });
    const next = item(planSession(data, at(2, 'A', r.state)), 'a-deadlift')!;
    expect(next.offer).toBe('more');
    expect(next.stay).toMatchObject({ total: 18, sets: 3, target: 6 });
    expect(next.up).toMatchObject({ total: 23, sets: 3, target: 8, bell: 45 });
    // Moving up is pre-selected; doing it makes 23 the total to start from
    const r2 = runSession(at(2, 'A', r.state));
    expect(r2.state.progress[key('deadlift')]).toEqual({ step: 0, ready: false, total: 23 });
    const after = item(planSession(data, at(2, 'A', r2.state)), 'a-deadlift')!;
    expect(after.stay).toMatchObject({ total: 23, sets: 3, target: 8, fromLast: true });
    expect(after.up).toBeUndefined();
    // The plan's own number wins when it's bigger: week 3 asks 4 × 6
    expect(item(planSession(data, at(3, 'A', r2.state)), 'a-deadlift')!.stay).toMatchObject({ total: 24, sets: 4, target: 6 });
  });

  it('splits: 3 to 5 sets at about 8 a set; 5 or fewer go one at a time', () => {
    expect([3, 4, 6, 11, 19, 23, 32, 36, 40, 50].map(splitSets)).toEqual([3, 4, 3, 3, 3, 3, 4, 5, 5, 5]);
    expect(evenSplit(23, 3)).toEqual([8, 8, 7]);
    expect(evenSplit(32, 4)).toEqual([8, 8, 8, 8]);
    expect(evenSplit(36, 5)).toEqual([8, 7, 7, 7, 7]);
  });

  it('choosing "stay" keeps the total where it was', () => {
    const r = runSession(at(2, 'A'), false, dl([8, 8, 7]));
    const stay = () => logSets(setChoice(fresh(at(2, 'A', r.state), 'a-deadlift'), 'stay'), [6, 6, 6]);
    const r2 = runSession(at(2, 'A', r.state), false, withItem('a-deadlift', stay));
    expect(r2.state.progress[key('deadlift')]).toEqual({ step: 0, ready: false, total: 18 });
  });

  it('falling short of the total: no offer, however big the sets', () => {
    const short = runSession(at(2, 'A'), false, dl([9, 7]));
    expect(short.log.status).toBe('partial');
    expect(short.state.progress[key('deadlift')]).toEqual({ step: 0, ready: false, total: 18 });
  });

  it('reaching 40: the next bell up, back to the plan\'s own total', () => {
    const gs = () => logSets(draftItem('a-goblet-squat'), [10, 10, 10, 10]); // 3 × 6 on the 35
    const r = runSession(at(2, 'A'), false, withItem('a-goblet-squat', gs));
    expect(r.state.progress[key('goblet-squat')]).toEqual({ step: 0, ready: true, total: 18, heavier: true });
    const next = item(planSession(data, at(2, 'A', r.state)), 'a-goblet-squat')!;
    expect(next.offer).toBe('heavier');
    expect(next.stay).toMatchObject({ bell: 35, total: 18 });
    expect(next.up).toMatchObject({ bell: 45, total: 18, sets: 3, target: 6 });
    // Not picked for him; taking it, the 45 sticks and the total starts from the plan's again
    expect(fresh(at(2, 'A', r.state), 'a-goblet-squat').choice).toBe('stay');
    const r2 = runSession(at(2, 'A', r.state), false, withItem('a-goblet-squat', () => logSets(setChoice(fresh(at(2, 'A', r.state), 'a-goblet-squat'), 'up'), [6, 6, 6])));
    expect(r2.state.bellPrefs['goblet-squat']).toEqual({ bell: 45, planBell: 35 });
    expect(r2.state.progress[key('goblet-squat')]).toEqual({ step: 0, ready: false, total: 18 });
    expect(item(planSession(data, at(2, 'A', r2.state)), 'a-goblet-squat')!.stay).toMatchObject({ bell: 45, total: 18 });
    // Only his own bells: with a 53 in Settings, that's the one after the 45
    const heavy = item(planSession(data, at(2, 'A', r2.state), [18, 35, 45, 53]), 'a-goblet-squat')!;
    expect(heavy.up).toBeUndefined();
  });

  it('reaching 40 on the heaviest bell: a harder move, as a note with nothing to pick', () => {
    const r = runSession(at(2, 'A'), false, dl([10, 10, 10, 10]));
    const next = item(planSession(data, at(2, 'A', r.state)), 'a-deadlift')!;
    expect(next.offer).toBe('harder');
    expect(next.up).toBeUndefined();
    const lighter = runSession(at(2, 'A'), false, dl([8, 8, 8, 8]));
    expect(lighter.state.progress[key('deadlift')]).toMatchObject({ next: 32 });
  });

  it("bodyweight → 18: the plan's own ladder bell is the heavier step", () => {
    const lunges = () => logSets(draftItem('b-reverse-lunge', 2, 'B'), [10, 10, 10, 10]);
    const r = runSession(at(2, 'B'), false, withItem('b-reverse-lunge', lunges));
    const lunge = item(planSession(data, at(2, 'B', r.state)), 'b-reverse-lunge')!;
    expect(lunge).toMatchObject({ offer: 'heavier', step: 0, upStep: 1 });
    expect(lunge.stay.bell).toBe('BW');
    expect(lunge.up!.bell).toBe(18);
    const take = () => logSets(setChoice(fresh(at(2, 'B', r.state), 'b-reverse-lunge'), 'up'), [10, 10]);
    const r2 = runSession(at(2, 'B', r.state), false, withItem('b-reverse-lunge', take));
    expect(r2.state.progress[key('reverse-lunge')].step).toBe(1);
    expect(item(planSession(data, at(2, 'B', r2.state)), 'b-reverse-lunge')!.stay.bell).toBe(18);
  });

  it('joint pain: no offers, and the total stays', () => {
    const r = runSession(at(2, 'A'), true, dl([8, 8, 7]));
    expect(r.state.progress[key('deadlift')]).toEqual({ step: 0, ready: false, total: 18 });
  });

  it('a new routine starts from its own plan, not the totals of the last one', () => {
    const r = runSession(at(2, 'A'), false, dl([8, 8, 7]));
    const ironwood = startRoutine(r.state, 'l1-ironwood');
    expect(item(planSession(data, { ...ironwood, pointer: { cycle: ironwood.pointer.cycle + 1, slot: 0 } }), 'a-goblet-squat')!.up).toBeUndefined();
    expect(Object.keys(r.state.progress).every((k) => k.startsWith(`${FOUNDATIONS}/`))).toBe(true);
  });

  it('warm-up moves never touch progression', () => {
    const r = runSession(at(1, 'A'));
    expect(Object.keys(r.state.progress).some((k) => k.includes('air-squat'))).toBe(false);
  });

  it("only uses James's bells: 18, 35 and 45 lb (Nov 7)", () => {
    const used = new Set<unknown>();
    for (const { s } of everyDay())
      for (const i of s.items) {
        used.add(i.stay.bell);
        if (i.up) used.add(i.up.bell);
        for (const p of i.parts ?? []) used.add(p.bell);
      }
    used.delete(null);
    used.delete('BW');
    expect([...used].sort()).toEqual([18, 35, 45]);
  });
});

describe('holds follow the seconds held (Nov 9); reps moves follow the plan (Nov 20)', () => {
  /** Finish week 2 day A with these seconds on the carry. */
  const held = (state: EngineState, actual: number[], pain = false) =>
    runSession(state, pain, withItem('a-suitcase-carry', (it) => ({ ...it, sets: it.sets.map((s, k) => ({ ...s, actual: actual[k] })) })));

  it('held longer than planned: next time is his total time, evened out over his sets (Nov 23)', () => {
    const r = held(at(2, 'A'), [40, 45, 40]); // 2:05 in all, against 3 × 30
    expect(item(planSession(data, at(2, 'A', r.state)), 'a-suitcase-carry')!.stay).toMatchObject({ sets: 3, target: 42, fromLast: true });
  });

  it('a session with joint pain changes nothing', () => {
    expect(held(at(2, 'A'), [45, 45, 45], true).state.levels['suitcase-carry']).toBeUndefined();
  });

  it('one short hold still counts: it is the total time that matters (Nov 23)', () => {
    const r = held(at(2, 'A'), [45, 45, 25]); // 1:55 in all
    expect(r.state.levels['suitcase-carry']).toMatchObject({ amount: 39, sets: 3 });
    const under = held(at(2, 'A'), [35, 30, 20]); // 1:25, under the 1:30 asked
    expect(under.state.levels['suitcase-carry']).toBeUndefined();
  });

  it('3 minutes in all (per side) is the goal: then heavier or harder', () => {
    const r = held(at(2, 'A'), [60, 60, 60]); // the carry is on the 45, the heaviest bell
    expect(r.state.progress[key('suitcase-carry')]).toMatchObject({ ready: true, heavier: true });
    expect(item(planSession(data, at(2, 'A', r.state)), 'a-suitcase-carry')).toMatchObject({ offer: 'harder', up: undefined });
    const almost = held(at(2, 'A'), [60, 60, 55]);
    expect(almost.state.progress[key('suitcase-carry')].ready).toBe(false);
  });

  it('works with state saved before levels existed', () => {
    const { levels: _, ...old } = at(2, 'A');
    expect(held(old as EngineState, [40, 40, 40]).state.levels['suitcase-carry']).toMatchObject({ amount: 40, sets: 3 });
  });

  /** Finish a week's Day B with the dead hang held this long on every set. */
  const hung = (state: EngineState, seconds: number) =>
    runSession(state, false, withItem('b-dead-hang', (it) => ({ ...it, sets: it.sets.map((s) => ({ ...s, actual: seconds })) })));

  it('a hold time belongs to the move, so it carries over to other routines (James, Nov 22: the dead hang)', () => {
    const r = hung(at(2, 'B'), 35);
    expect(r.state.levels['dead-hang']).toMatchObject({ amount: 35, bell: null });
    expect(item(planSession(data, at(2, 'B', r.state)), 'b-dead-hang')!.stay.target).toBe(35);
    const other = data.routines.find((x) => x.id !== FOUNDATIONS && x.days.B.items?.some((i) => i.id === 'b-dead-hang'))!;
    const moved = startRoutine(r.state, other.id);
    const dayB = { ...moved, pointer: { cycle: moved.routine!.start, slot: plan.rotation.indexOf('B') } };
    expect(planSession(data, dayB).phaseId).toBe(other.id);
    expect(item(planSession(data, dayB), 'b-dead-hang')!.stay.target).toBe(35);
  });

  it('a later, shorter hold never lowers the time', () => {
    const r = hung(at(2, 'B'), 35);
    const again = hung(at(3, 'B', r.state), 30);
    expect(again.state.levels['dead-hang']).toMatchObject({ amount: 35 });
  });

  it('during a workout, the next timed set starts at what was just done, never below the plan', () => {
    let sc = draftItem('a-suitcase-carry'); // 3 x 30 s
    sc = completeNext({ ...sc, sets: sc.sets.map((s, k) => (k === 0 ? { ...s, actual: 40 } : s)) });
    expect(sc.sets.map((s) => s.actual)).toEqual([40, 40, 40]);
  });

  it('reps moves never record a level, and an old one doesn’t change the plan’s set size', () => {
    const r = runSession(at(2, 'A'), false, withItem('a-deadlift', () => logSets(draftItem('a-deadlift'), [10, 8])));
    expect(Object.keys(r.state.levels)).toEqual([]);
    const st = { ...at(2, 'A'), levels: { [key('deadlift')]: { amount: 10, bell: 45 as const, sets: 3 } } };
    expect(item(planSession(data, st), 'a-deadlift')!.stay).toMatchObject({ target: 6, total: 18 });
  });
});

describe('nothing learned gets lost (Nov 22 fix)', () => {
  /** A finished workout's log, at its own time. */
  const logOf = (state: EngineState, startedAt: number, edit?: (d: SessionDraft) => SessionDraft) => ({
    ...runSession(state, false, edit).log,
    startedAt,
  });
  const deadHang = (seconds: number) => withItem('b-dead-hang', (it) => ({ ...it, sets: it.sets.map((s) => ({ ...s, actual: seconds })) }));

  it('a finished workout keeps the routine and the plan version', () => {
    const st = at(2, 'A', initialState(), 'l2-anvil');
    const r = runSession(st);
    expect(r.state.routine).toEqual(st.routine);
    expect(r.state.planVersion).toBe(PLAN_VERSION);
    expect(planSession(data, r.state).phaseId).toBe('l2-anvil');
  });

  it('state that lost its routine and version gets them, its steps and its hold times back from the logs', () => {
    const logs = [
      logOf(at(2, 'B'), NOW, deadHang(35)), // Foundations: the dead hang at 35 s
      logOf(at(2, 'A', initialState(), 'l2-anvil'), NOW + 864e5), // then a day of Anvil
    ];
    const lost = { ...at(2, 'B', initialState(), 'l2-anvil'), routine: undefined, planVersion: undefined, progress: {}, levels: {} };
    const m = migrateState(lost, data, logs);
    expect(m.routine).toEqual({ id: 'l2-anvil', start: 0 });
    expect(m.planVersion).toBe(PLAN_VERSION);
    expect(m.levels['dead-hang']).toMatchObject({ amount: 35 });
    expect(Object.keys(m.progress).some((k) => k.startsWith('l2-anvil/'))).toBe(true);
    expect(planSession(data, m)).toMatchObject({ phaseId: 'l2-anvil', week: 2, day: 'B' });
    expect(migrateState(m, data, logs)).toBe(m); // once only
  });

  it('a hold time wiped, then a short hold after it: the best time still comes back', () => {
    const logs = [logOf(at(2, 'B'), NOW, deadHang(35)), logOf(at(3, 'B'), NOW + 7 * 864e5, deadHang(20))];
    const m = migrateState({ ...at(4, 'A'), planVersion: undefined, levels: {} }, data, logs);
    expect(m.levels['dead-hang']).toMatchObject({ amount: 35 });
    expect(item(planSession(data, at(4, 'B', m)), 'b-dead-hang')!.stay.target).toBe(35);
  });

  it('state from before Nov 23 is rebuilt under the new rule, keeping the sets he had moved up to', () => {
    // An old-style move-up: one more set (4 × 6 = 24), with no upStep
    const old = runSession(at(2, 'A'), false, withItem('a-deadlift', (it) => {
      const up = { ...chosen(it), sets: 4, total: 24 };
      return logSets({ ...it, choice: 'up', plan: { ...it.plan, up, upStep: undefined }, sets: [{ target: 6, actual: 6, done: false, bell: 45 }] }, [6, 6, 6, 6]);
    })).log;
    const logs = [old, logOf(at(2, 'B'), NOW, deadHang(35))];
    const m = migrateState({ ...at(3, 'A'), planVersion: 3, progress: { [key('deadlift')]: { step: 1, ready: false } } }, data, logs);
    expect(m.planVersion).toBe(PLAN_VERSION);
    expect(m.progress[key('deadlift')]).toEqual({ step: 1, ready: false, total: 24 });
    expect(m.levels['dead-hang']).toEqual({ amount: 35, bell: null, sets: 3 });
    expect(item(planSession(data, at(2, 'A', m)), 'a-deadlift')!.stay).toMatchObject({ total: 24, sets: 3, target: 8 }); // his own total now, so about 8 a set
  });

  it('logs from before routines (steps that meant more reps) add no steps', () => {
    const old = logOf(at(2, 'A'), NOW);
    const pre = {
      ...old,
      session: { ...old.session, phaseId: 'm1' },
      items: old.items.map((it) => ({ ...it, plan: { ...it.plan, progressKey: it.plan.progressKey?.split('/')[1] } })),
    };
    const m = migrateState({ ...at(3, 'A'), routine: undefined, planVersion: undefined }, data, [pre]);
    expect(m.progress).toEqual({});
    expect(m.routine).toEqual({ id: FOUNDATIONS, start: 0 });
  });
});

describe('totals: reps moves are a total, done in sets ended by Rest (James, Nov 19)', () => {
  it("every reps move is the plan's sets x reps (per side for one-sided moves); holds stay timed sets", () => {
    const a = planSession(data, at(2, 'A'));
    expect(item(a, 'a-deadlift')!.stay.total).toBe(18); // 3 x 6
    expect(item(a, 'a-press')!.stay.total).toBe(15); // 3 x 5 per side
    expect(item(a, 'a-press')!.perSide).toBe(true);
    expect(item(a, 'a-hinge-drill')!.stay.total).toBe(20); // 2 x 10 on the 45
    expect(item(a, 'a-swing')!.stay.total).toBe(25); // 5 x 5 hike passes
    expect(item(a, 'a-suitcase-carry')!.stay.total).toBeUndefined();
    expect(item(planSession(data, at(2, 'C')), 'c-get-up')!.stay.total).toBe(3); // 3 x 1 per side
    expect(item(planSession(data, at(1, 'A')), 'a-deadlift')!.stay.total).toBe(12); // week 1: 2 sets
    for (const { s } of everyDay()) for (const it of s.items) if (it.kind === 'reps') expect(it.stay.total, it.itemId).toBeGreaterThan(0);
  });

  it('Rest logs a set; the next one starts at what was just done, never past what is left or 10', () => {
    let dl = draftItem('a-deadlift'); // 18
    expect(dl.sets).toEqual([{ target: 6, actual: 6, done: false, bell: 45 }]);
    dl = logSets(dl, [10]);
    expect(dl.sets.map((s) => [s.actual, s.done])).toEqual([[10, true], [8, false]]);
    dl = logSets(dl, [5]);
    expect(repsDone(dl.sets)).toBe(15);
    expect(dl.sets[dl.sets.length - 1]).toMatchObject({ actual: 3, done: false }); // 3 left
    dl = logSets(dl, [3]);
    expect(isItemComplete(dl)).toBe(true);
    expect(dl.sets.every((s) => s.done)).toBe(true);
  });

  it('a set can log more than 10, or more than what is left (James, Nov 23)', () => {
    let dl = logSets(draftItem('a-deadlift'), [12]); // 18
    expect(dl.sets.map((s) => [s.actual, s.done])).toEqual([[12, true], [6, false]]); // the next set starts at what's left
    dl = logSets(dl, [9]);
    expect(dl.sets.map((s) => s.actual)).toEqual([12, 9]);
    expect(repsDone(dl.sets)).toBe(21);
    expect(isItemComplete(dl)).toBe(true);
  });

  it('undoing a set puts its reps back on what is left', () => {
    let dl = logSets(draftItem('a-deadlift'), [10, 8]);
    dl = undoSet(dl, 1);
    expect(repsDone(dl.sets)).toBe(10);
    expect(isItemComplete(dl)).toBe(false);
    expect(dl.sets[dl.sets.length - 1]).toMatchObject({ actual: 8, done: false });
  });

  it('switching between move up and stay keeps the sets done and resizes what is left', () => {
    const r = runSession(at(2, 'A'), false, withItem('a-deadlift', () => logSets(draftItem('a-deadlift'), [8, 8, 7])));
    const d = startDraft(planSession(data, at(2, 'A', r.state)), 'x', NOW);
    let dl = d.items.find((it) => it.plan.itemId === 'a-deadlift')!;
    expect(dl.choice).toBe('up');
    expect(chosen(dl).total).toBe(23);
    dl = logSets(dl, [9]);
    dl = setChoice(dl, 'stay'); // 18: 9 done, 9 left, in sets of the plan's 6
    expect(dl.sets.map((s) => [s.actual, s.done])).toEqual([[9, true], [6, false]]);
    dl = setChoice(logSets(dl, [9]), 'up');
    expect(isItemComplete(dl)).toBe(false); // 18 of 23
  });
});

describe('logging more than prescribed (James, Nov 23: "that\'s feedback to the app")', () => {
  const getUp = () => draftItem('c-get-up', 2, 'C'); // 3 x 1 per side: a total of 3
  const day = (st: EngineState) => at(2, 'C', st);

  it('get-ups: 2 on the last set, past the total of 3', () => {
    const g = logSets(getUp(), [1, 1, 2]);
    expect(repsDone(g.sets)).toBe(4);
    expect(isItemComplete(g)).toBe(true);
  });

  it('one more set after the total: it starts at the size of the last one and is logged like any set', () => {
    let g = logSets(getUp(), [1, 1, 1]);
    expect(isItemComplete(g)).toBe(true);
    g = addSet(g);
    expect(g.sets.at(-1)).toMatchObject({ actual: 1, done: false, extra: true });
    expect(isItemComplete(g)).toBe(true); // an open extra set doesn't hold the move up
    g = completeNext(g);
    expect(g.sets.map((x) => [x.actual, x.done])).toEqual([[1, true], [1, true], [1, true], [1, true]]);
    expect(repsDone(g.sets)).toBe(4);
    // Only once the planned work is done, and only one open set at a time
    expect(addSet(getUp())).toEqual(getUp());
    expect(addSet(addSet(g)).sets).toHaveLength(5);
  });

  it('"never mind" takes back an extra set that was not done; an open one is dropped at the finish', () => {
    const g = addSet(logSets(getUp(), [1, 1, 1]));
    expect(dropExtra(g).sets).toHaveLength(3);
    const r = runSession(day(initialState()), false, withItem('c-get-up', () => g));
    expect(r.log.items.find((x) => x.plan.itemId === 'c-get-up')!.sets).toHaveLength(3);
    expect(r.log.status).toBe('done');
    expect(r.state.progress[key('get-up-pieces')]).toEqual({ step: 0, ready: false, total: 3 });
  });

  it('get-ups past the total: next time offers what he did, one at a time', () => {
    const r = runSession(day(initialState()), false, withItem('c-get-up', () => logSets(getUp(), [1, 1, 2])));
    expect(r.state.progress[key('get-up-pieces')]).toEqual({ step: 0, ready: true, total: 3, next: 4 });
    const next = item(planSession(data, day(r.state)), 'c-get-up')!;
    expect(next.offer).toBe('more');
    expect(next.up).toMatchObject({ total: 4, sets: 4, target: 1 });
    // Just the total: nothing offered
    const plain = runSession(day(initialState()));
    expect(plain.state.progress[key('get-up-pieces')].ready).toBe(false);
    expect(item(planSession(data, day(plain.state)), 'c-get-up')!.offer).toBeUndefined();
  });

  it('circuits: an extra round raises the total; flows: an extra set', () => {
    const st = at(2, 'A', initialState(), 'l2-anvil'); // 3 rounds of 5
    const r = runSession(st, false, withItem('a-c1', (it) => completeNext(addSet(it))));
    expect(r.state.progress[key('a-c1', 'l2-anvil')]).toEqual({ step: 0, ready: true, total: 15, next: 20 });
    expect(item(planSession(data, at(2, 'A', r.state, 'l2-anvil')), 'a-c1')!.up).toMatchObject({ sets: 3, target: 7 });
    const ft = at(2, 'A', initialState(), 'l3-raider');
    const f = runSession(ft, false, withItem('a-f1', (it) => completeNext(addSet(it))));
    expect(f.state.progress[key('a-f1', 'l3-raider')]).toMatchObject({ ready: true, next: 12 }); // 3 sets of 3, and a 4th
  });

  it('holds: an extra set counts toward the total time, evened out next time; a short one never spoils it', () => {
    const hang = (secs: number[]) => (it: DraftItem): DraftItem => {
      let x: DraftItem = { ...it, sets: it.sets.map((z, k) => ({ ...z, actual: secs[k], done: true })) };
      for (const extra of secs.slice(it.sets.length)) {
        x = addSet(x);
        x = completeNext({ ...x, sets: x.sets.map((z) => (z.done ? z : { ...z, actual: extra })) });
      }
      return x;
    };
    const b = at(2, 'B');
    const r = runSession(b, false, withItem('b-dead-hang', hang([35, 35, 35, 15]))); // 2:00 in all
    expect(r.state.levels['dead-hang']).toMatchObject({ amount: 30, sets: 4 });
    expect(item(planSession(data, at(2, 'B', r.state)), 'b-dead-hang')!.stay).toMatchObject({ sets: 4, target: 30 });
  });
});

describe('each set remembered: last time is the benchmark (James, Nov 23)', () => {
  const log = (date: string, startedAt: number, d: SessionDraft) => ({ date, startedAt, items: d.items });
  const dlWith = (sets: { actual: number; bell: number; rest?: number }[], extra: Partial<DraftItem> = {}) =>
    withItem('a-deadlift', (it) => ({ ...it, ...extra, sets: sets.map((x) => ({ target: 6, done: true, ...x })) }));

  it("gives the newest workout's sets for the same move, each with its count, bell and rest", () => {
    const base = completeAll(startDraft(planSession(data, at(2, 'A')), 'x', NOW));
    const older = log('2026-11-10', NOW - 2 * 86_400_000, dlWith([{ actual: 6, bell: 35 }])(base));
    const newer = log('2026-11-12', NOW - 86_400_000, dlWith([{ actual: 8, bell: 45, rest: 75 }, { actual: 7, bell: 45 }])(base));
    const today = draftItem('a-deadlift');
    expect(lastTime([newer, older], today)).toEqual({
      date: '2026-11-12',
      sets: [{ target: 6, actual: 8, done: true, bell: 45, rest: 75 }, { target: 6, actual: 7, done: true, bell: 45 }],
    });
    expect(lastTime([older, newer], today)!.date).toBe('2026-11-12'); // newest wins, whatever the order
    // A skipped move doesn't count; neither does a move never done
    const skipped = log('2026-11-13', NOW, dlWith([{ actual: 9, bell: 45 }], { skipped: true })(base));
    expect(lastTime([skipped, older], today)!.date).toBe('2026-11-10');
    expect(lastTime([], today)).toBeUndefined();
  });

  it('holds too; and only like for like (a hold never stands in for counted sets of the same move)', () => {
    const base = completeAll(startDraft(planSession(data, at(2, 'B')), 'x', NOW));
    const hang = base.items.find((x) => x.plan.itemId === 'b-dead-hang')!;
    expect(lastTime([log('2026-11-12', NOW, base)], hang)!.sets).toHaveLength(hang.sets.length);
    const counted = { ...hang, plan: { ...hang.plan, kind: 'reps' as const } };
    expect(lastTime([log('2026-11-12', NOW, base)], counted)).toBeUndefined();
  });

  it('circuits are matched by their place in the routine', () => {
    const st = at(2, 'A', initialState(), 'l2-anvil');
    const base = completeAll(startDraft(planSession(data, st), 'x', NOW));
    const c = base.items.find((x) => x.plan.itemId === 'a-c1')!;
    expect(lastTime([log('2026-11-12', NOW, base)], c)!.sets).toHaveLength(c.sets.length);
    const other = completeAll(startDraft(planSession(data, at(2, 'A', initialState(), 'l3-raider')), 'x', NOW));
    expect(lastTime([log('2026-11-12', NOW, other)], c)).toBeUndefined();
  });
});

describe('circuits and flows (James, Nov 20)', () => {
  const anvil = (week: number, day: 'A' | 'B' | 'C') => planSession(data, at(week, day, initialState(), 'l2-anvil'));

  it('a circuit is rounds of every move back to back, each with its own bell; rest comes after the round', () => {
    const c = item(anvil(1, 'A'), 'a-c1')!;
    expect(c).toMatchObject({ kind: 'circuit', stay: { sets: 2, target: 5, bell: null } });
    expect(c.stay.total).toBeUndefined();
    expect(c.parts!.map((p) => [p.move, p.bell, p.perSide])).toEqual([
      ['goblet-squat', 35, false], ['two-hand-swing', 45, false], ['single-arm-press', 18, true], ['bent-over-row', 35, true],
    ]);
    let d = startDraft(anvil(1, 'A'), 'x', NOW).items.find((x) => x.plan.itemId === 'a-c1')!;
    expect(d.sets).toHaveLength(2);
    d = completeNext(d);
    expect(isItemComplete(d)).toBe(false);
    d = completeNext(d);
    expect(isItemComplete(d)).toBe(true);
  });

  it('rounds go up each week: 2, 3, 4, 4', () => {
    expect([1, 2, 3, 4].map((w) => item(anvil(w, 'A'), 'a-c1')!.stay.sets)).toEqual([2, 3, 4, 4]);
  });

  it('a flow is sets of cycles on one bell, per side when one-handed', () => {
    const f = item(planSession(data, at(1, 'A', initialState(), 'l3-raider')), 'a-f1')!;
    expect(f).toMatchObject({ kind: 'flow', perSide: true, stay: { sets: 2, target: 3, bell: 18 } });
    expect(f.parts!.map((p) => p.name)).toEqual(['Single-arm swing', 'High pull', 'Goblet squat', 'Single-arm press']);
  });

  it('the count can be changed for a round; later rounds start at it', () => {
    let d = startDraft(anvil(3, 'A'), 'x', NOW).items.find((x) => x.plan.itemId === 'a-c1')!;
    d = completeSetAt({ ...d, sets: d.sets.map((s, k) => (k === 0 ? { ...s, actual: 6 } : s)) }, 0);
    expect(d.sets.map((s) => s.actual)).toEqual([6, 6, 6, 6]);
  });

  it('counts raised in the rounds raise the total: next time it is evened out (Nov 23)', () => {
    const st = at(2, 'A', initialState(), 'l2-anvil'); // 3 rounds of 5
    const done = runSession(st, false, withItem('a-c1', (it) => ({ ...it, sets: it.sets.map((s, k) => ({ ...s, actual: k ? 6 : 7, done: true })) })));
    expect(done.state.progress[key('a-c1', 'l2-anvil')]).toEqual({ step: 0, ready: true, total: 15, next: 19 });
    const next = item(planSession(data, at(2, 'A', done.state, 'l2-anvil')), 'a-c1')!;
    expect([next.stay.sets, next.stay.target, next.up!.sets, next.up!.target]).toEqual([3, 5, 3, 7]);
    // At the plan's count: no offer
    expect(runSession(st).state.progress[key('a-c1', 'l2-anvil')].ready).toBe(false);
    // 40 a move (5 rounds of 8): heavier bells or harder moves, as a note
    const big = runSession(st, false, withItem('a-c1', (it) => ({ ...it, sets: it.sets.map((s) => ({ ...s, actual: 14, done: true })) })));
    expect(item(planSession(data, at(2, 'A', big.state, 'l2-anvil')), 'a-c1')).toMatchObject({ offer: 'harder', up: undefined });
  });

  it('flows: 3 more cycles than planned is the sign', () => {
    const st = at(2, 'A', initialState(), 'l3-raider');
    const six = runSession(st, false, withItem('a-f1', (it) => ({ ...it, sets: it.sets.map((s) => ({ ...s, actual: 6, done: true })) })));
    expect(six.state.progress[key('a-f1', 'l3-raider')].ready).toBe(true);
  });

  it('counts kettlebell reps in circuits (each move with a bell) and flows (every move in a cycle)', () => {
    const d = completeAll(startDraft(anvil(1, 'A'), 'x', NOW));
    // c1: 2 rounds × (5 goblet + 5 swings + 5×2 press + 5×2 rows) = 60
    // c2: 2 rounds × (5×2 cleans + 5×2 lunges + push-ups (no bell) + 5×2 single-arm swings) = 60
    // mini-flow: 2 sets × 5 cycles × 3 moves = 30
    expect(kbReps(d.items)).toBe(60 + 60 + 30);
  });

  it('describes the work for times and the check-in', () => {
    const a = startDraft(anvil(1, 'A'), 'x', NOW).items;
    expect(workOf(a.find((x) => x.plan.itemId === 'a-c1')!)).toBe('2 rounds of 5');
    expect(workOf(a.find((x) => x.plan.itemId === 'a-flow')!)).toBe('2 × 5 cycles @18');
    expect(restKey(a.find((x) => x.plan.itemId === 'a-c1')!)).toBe('Squat, swing, press, row'); // its own remembered rest
  });
});

describe('rest between sets (James, Nov 9)', () => {
  it('the rest setting applies to every move, hinge drill and get-ups included', () => {
    const mine = { ...data, plan: { ...plan, defaultRest: 90 } };
    for (const day of ['A', 'B', 'C'] as const) {
      for (const it of planSession(mine, at(1, day)).items) {
        if (it.kind !== 'breath') expect([it.itemId, it.stay.rest]).toEqual([it.itemId, 90]);
      }
    }
    expect(item(planSession(mine, at(1, 'A')), 'a-hinge-drill')!.stay.rest).toBe(90);
    expect(item(planSession(mine, at(1, 'C')), 'c-get-up')!.stay.rest).toBe(90);
  });

  it('a rest James changed during a workout sticks to that exercise only (Nov 13)', () => {
    const d = startDraft(planSession(data, at(2, 'A')), 'x', NOW);
    const find = (id: string) => d.items.find((it) => it.plan.itemId === id)!;
    const [dl, gs] = [find('a-deadlift'), find('a-goblet-squat')];
    expect(restKey(dl)).toBe('deadlift');
    expect(restAfter(dl, {})).toBe(plan.defaultRest);
    const mine = { deadlift: 90 };
    expect(restAfter(dl, mine)).toBe(90);
    expect(restAfter(gs, mine)).toBe(plan.defaultRest);
    // Breathwork has no rest after it, whatever is saved
    const breath = d.items.find((it) => it.plan.kind === 'breath')!;
    expect(restAfter(breath, { [restKey(breath)]: 90 })).toBe(0);
  });
});

describe('joint pain hold', () => {
  it('freezes increases and the week until a pain-free session', () => {
    const ok = runSession(at(2, 'A'), false, withItem('a-deadlift', () => logSets(draftItem('a-deadlift'), [8, 8, 2])));
    const pain = runSession(at(2, 'A', ok.state), true, (d) => ({ ...d, items: d.items.map((it) => setChoice(it, 'stay')) }));
    expect(pain.state.hold).toMatchObject({ week: 2 });
    expect(pain.state.progress[key('deadlift')].ready).toBe(false);

    // Rotation moves into week 3, but the recipe stays at week 2 and nothing is offered
    const held = planSession(data, at(3, 'A', pain.state));
    expect(held.held).toBe(true);
    expect(held.effectiveWeek).toBe(2);
    expect(item(held, 'a-hinge-drill')).toBeDefined();
    expect(item(held, 'a-swing')!.stay.move).toBe('hike-pass');
    expect(held.items.some((i) => i.up)).toBe(false);

    const clear = runSession(at(3, 'A', pain.state), false);
    expect(clear.state.hold).toBeNull();
    expect(planSession(data, at(3, 'A', clear.state)).effectiveWeek).toBe(3);
  });
});

describe('bells', () => {
  it('remembers a bell the user switched to, until the plan changes that bell', () => {
    const r = runSession(at(2, 'A'), false, withItem('a-deadlift', (it) => ({ ...it, bell: 25, sets: it.sets.map((s) => ({ ...s, bell: 25 })) })));
    expect(r.state.bellPrefs['deadlift']).toEqual({ bell: 25, planBell: 45 });
    expect(item(planSession(data, at(2, 'A', r.state)), 'a-deadlift')!.stay.bell).toBe(25);

    const changed = { ...r.state, bellPrefs: { deadlift: { bell: 25 as const, planBell: 35 } } };
    expect(item(planSession(data, at(2, 'A', changed)), 'a-deadlift')!.stay.bell).toBe(45);
  });

  it('counts kettlebell reps, doubling per-side moves and skipping bodyweight', () => {
    const d = completeAll(startDraft(planSession(data, at(2, 'B')), 'x', NOW));
    // hike passes 5×5 @35 = 25; row 3×6×2 @45 = 36; floor press 3×6×2 = 36; halo 2×5×2 = 20; lunge is BW
    expect(kbReps(d.items)).toBe(25 + 36 + 36 + 20);
  });
});

describe('move times (James, Nov 19: "time them and keep track")', () => {
  const dl = () => startDraft(planSession(data, at(2, 'A')), 'x', NOW).items.find((it) => it.plan.itemId === 'a-deadlift')!; // 18 reps @45
  const logAt = (it: DraftItem, n: number, t: number) =>
    stampTimes(completeNext({ ...it, sets: it.sets.map((s) => (s.done ? s : { ...s, actual: n })) }), t);

  it('the clock stops when the total is reached, rests included; each set notes when it was logged', () => {
    let it: DraftItem = { ...dl(), startedAt: NOW };
    it = logAt(it, 10, NOW + 40_000);
    expect(it.endedAt).toBeUndefined();
    expect(moveTime(it)).toBeUndefined();
    it = logAt(it, 8, NOW + 110_000);
    expect(it.sets.map((s) => s.at)).toEqual([NOW + 40_000, NOW + 110_000]);
    expect(moveTime(it)).toBe(110_000);
  });

  it('undoing a set reopens the clock; a move logged without its clock starts at that first set', () => {
    let it: DraftItem = logAt(logAt({ ...dl(), startedAt: NOW }, 10, NOW + 1000), 8, NOW + 2000);
    it = stampTimes(undoSet(it, 1), NOW + 4000);
    expect(it.endedAt).toBeUndefined();
    expect(it.startedAt).toBe(NOW);
    const cold = logAt(dl(), 6, NOW + 5000);
    expect(cold.startedAt).toBe(NOW + 5000);
  });

  it('skipping a move gives it no time', () => {
    const it = stampTimes({ ...dl(), startedAt: NOW, skipped: true }, NOW + 9000);
    expect(moveTime(it)).toBeUndefined();
  });

  it('circuits and flows are timed too', () => {
    let c = startDraft(planSession(data, at(1, 'A', initialState(), 'l2-anvil')), 'x', NOW).items.find((x) => x.plan.itemId === 'a-c1')!;
    c = stampTimes(completeNext({ ...c, startedAt: NOW }), NOW + 100_000);
    c = stampTimes(completeNext(c), NOW + 250_000);
    expect(moveTime(c)).toBe(250_000);
  });

  it('keeps every time per move, newest first, and compares only the same work (total and bell)', () => {
    const day = (date: string, ms: number, bell: 35 | 45 = 45) => {
      const it = { ...dl(), bell, startedAt: 0, endedAt: ms };
      return { date, startedAt: new Date(`${date}T07:00:00`).getTime(), items: [it] };
    };
    const times = timesFor([day('2026-11-10', 160_000), day('2026-11-14', 140_000), day('2026-11-18', 150_000), day('2026-11-19', 90_000, 35)], 'deadlift');
    expect(times.map((t) => [t.date, t.ms, t.work])).toEqual([
      ['2026-11-19', 90_000, '18 reps @35'],
      ['2026-11-18', 150_000, '18 reps @45'],
      ['2026-11-14', 140_000, '18 reps @45'],
      ['2026-11-10', 160_000, '18 reps @45'],
    ]);
    const { last, best, lastAny } = lastAndBest(times, '18 reps @45');
    expect([last!.ms, best!.ms, lastAny!.ms]).toEqual([150_000, 140_000, 90_000]);
    expect(workOf({ ...draftItem('a-press') })).toBe('15 reps per side @18');
    expect(workOf(draftItem('a-suitcase-carry'))).toBe('3 × 30 s per side @45');
  });
});

describe('counted vs timed (James, Nov 19: "Anything that requires me to move in a rep-like fashion is NOT a timed exercise")', () => {
  it('in every routine only holds, hangs and carries are timed; everything that moves is counted', () => {
    const timed = new Set<string>();
    for (const { s } of everyDay()) for (const it of s.items) if (it.kind === 'time') timed.add(it.stay.move!);
    expect([...timed].sort()).toEqual(['dead-hang', 'overhead-carry', 'plank', 'rack-hold', 'suitcase-carry']);
  });

  it('old timed records (most seconds held) never become a rep count', () => {
    const st = { ...at(2, 'C'), levels: { [key('arm-bar-reps')]: { amount: 40, bell: 18 as const, sets: 2 }, [key('arm-bar')]: { amount: 40, bell: 18 as const, sets: 2 } } };
    expect(item(planSession(data, st), 'c-arm-bar')!.stay.total).toBe(10);
  });
});
