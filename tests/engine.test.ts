import { describe, expect, it } from 'vitest';
import { loadData } from '../src/engine/data';
import {
  advance, back, completeSetAt, finishSession, initialState, kbReps, passDay, planSession, restAfter, restKey, setChoice, startDraft,
  type EngineState, type PlannedSession, type SessionDraft,
} from '../src/engine/engine';

const data = loadData();
const { plan } = data;
const NOW = new Date(2026, 10, 4, 7, 0).getTime();

/** State positioned at a given week (1-based) and day letter's first slot. */
function at(week: number, day: 'A' | 'B' | 'C' | 'REST', base: EngineState = initialState()): EngineState {
  return { ...base, pointer: { cycle: week - 1, slot: plan.rotation.indexOf(day) } };
}

const item = (s: PlannedSession, id: string) => s.items.find((i) => i.itemId === id);

function completeAll(d: SessionDraft): SessionDraft {
  return { ...d, items: d.items.map((it) => ({ ...it, sets: it.sets.map((s) => ({ ...s, done: true })) })) };
}

function runSession(state: EngineState, pain = false, edit?: (d: SessionDraft) => SessionDraft) {
  const s = planSession(data, state);
  let d = completeAll(startDraft(s, 'x', NOW));
  if (edit) d = edit(d);
  return finishSession(plan, state, d, { effort: 6, pain }, NOW + 1_800_000);
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

describe('Month 1 recipes', () => {
  it('week 1 day A: 2 sets of everything, hinge drill, no swings', () => {
    const s = planSession(data, at(1, 'A'));
    expect(s.title).toBe('Hinge and press');
    expect(item(s, 'a-hinge-drill')!.stay.sets).toBe(2);
    expect(item(s, 'a-deadlift')!.stay).toMatchObject({ sets: 2, target: 8, bell: 45, range: [8, 10] });
    expect(item(s, 'a-swing')).toBeUndefined();
    expect(s.items.filter((i) => i.section === 'warmup')).toHaveLength(0); // the warm-up is its own part
    expect(s.items.filter((i) => i.section === 'cooldown')[0].breath).toBeDefined();
  });

  it('every workout day has three parts: warm-up, workout, evening holds (James, Nov 7)', () => {
    for (const day of ['A', 'B', 'C'] as const) {
      for (const week of [1, 4]) {
        const s = planSession(data, at(week, day));
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
        // James's 9 evening stretches (Nov 9) + a deep quad stretch (Nov 14); pigeon, couch and the seated twist on each side
        expect(s.evening!.stations.map((st) => st.label)).toEqual([
          'Reverse prayer pose', 'Deep twist squats', 'Downward dog pulses',
          'Pigeon pose, left leg forward', 'Pigeon pose, right leg forward',
          'Couch stretch, left leg back', 'Couch stretch, right leg back', 'Frog pose', 'Cobra', 'Straddle',
          'Seated spinal twist, turn left', 'Seated spinal twist, turn right', 'Bridge (regressed)',
        ]);
        expect(s.evening!.stations.every((st) => st.seconds === 60)).toBe(true); // 60 s holds (James, Nov 14)
        expect(s.evening!.seconds).toBe(13 * 60 + 12 * 10);
      }
    }
  });

  it('a walking day has no warm-up: just the walk, then the evening holds (James, Nov 14)', () => {
    for (const week of [1, 4]) {
      const s = planSession(data, at(week, 'REST'));
      expect(s.warmup).toBeUndefined();
      expect(s.evening).toBeDefined();
    }
  });

  it('the breathing stays at the end of the workout', () => {
    const s = planSession(data, at(1, 'A'));
    expect(s.items.at(-1)!.section).toBe('cooldown');
    expect(s.items.at(-1)!.breath).toBeDefined();
  });

  it('week 2: 3 sets, hike passes 5 × 5 on the 35', () => {
    const s = planSession(data, at(2, 'A'));
    expect(item(s, 'a-deadlift')!.stay.sets).toBe(3);
    expect(item(s, 'a-swing')!.stay).toMatchObject({ move: 'hike-pass', sets: 5, target: 5, bell: 35 });
    expect(item(s, 'a-hinge-drill')).toBeDefined();
  });

  it('week 3: hinge drill gone, dead-stop swings, goblet squat gets a rep range', () => {
    const s = planSession(data, at(3, 'B'));
    expect(item(s, 'b-swing')!.stay.move).toBe('full-stop-swing');
    const a = planSession(data, at(3, 'A'));
    expect(item(a, 'a-hinge-drill')).toBeUndefined();
    expect(item(a, 'a-goblet-squat')!.stay).toMatchObject({ target: 8, range: [8, 10] });
  });

  it('week 4: continuous two-hand swings on the 45', () => {
    const s = planSession(data, at(4, 'A'));
    expect(item(s, 'a-swing')!.stay).toMatchObject({ move: 'two-hand-swing', target: 8, bell: 45 });
  });

  it('rest day has no items', () => {
    const s = planSession(data, at(1, 'REST'));
    expect(s.day).toBe('REST');
    expect(s.items).toEqual([]);
  });

  it('past the end of the plan, repeats the final week', () => {
    const s = planSession(data, at(6, 'A'));
    expect(s.week).toBe(6);
    expect(s.effectiveWeek).toBe(4);
    expect(s.beyondPlan).toBe(true);
  });

  it('breathwork rotates through the patterns', () => {
    const keys = new Set([1, 2, 3].map((w) => planSession(data, at(w, 'A')).items.at(-1)!.breath!.patternKey));
    expect(keys.size).toBe(3);
  });
});

describe('moving up', () => {
  it('offers the next step after a session done to plan with no pain', () => {
    const r = runSession(at(2, 'A'));
    expect(r.state.progress['deadlift']).toEqual({ step: 0, ready: true });
    const next = planSession(data, at(2, 'A', r.state));
    const dl = item(next, 'a-deadlift')!;
    expect(dl.up).toMatchObject({ target: 9 });
    // Moving up is pre-selected; finishing records the new step
    const r2 = runSession(at(2, 'A', r.state));
    expect(r2.state.progress['deadlift'].step).toBe(1);
  });

  it('choosing "stay" keeps the step', () => {
    const r = runSession(at(2, 'A'));
    const r2 = runSession(at(2, 'A', r.state), false, (d) => ({
      ...d,
      items: d.items.map((it) => (it.plan.itemId === 'a-deadlift' ? setChoice(it, 'stay') : it)),
    }));
    expect(r2.state.progress['deadlift'].step).toBe(0);
  });

  it('a short set means no offer next time', () => {
    const r = runSession(at(2, 'A'), false, (d) => ({
      ...d,
      items: d.items.map((it) =>
        it.plan.itemId === 'a-deadlift' ? { ...it, sets: it.sets.map((s, i) => (i === 2 ? { ...s, actual: 6 } : s)) } : it,
      ),
    }));
    expect(r.state.progress['deadlift'].ready).toBe(false);
    expect(item(planSession(data, at(2, 'A', r.state)), 'a-deadlift')!.up).toBeUndefined();
  });

  it('bodyweight → 18 ladder offers the bell', () => {
    const r = runSession(at(1, 'B'));
    const lunge = item(planSession(data, at(1, 'B', r.state)), 'b-reverse-lunge')!;
    expect(lunge.stay.bell).toBe('BW');
    expect(lunge.up!.bell).toBe(18);
  });

  it("only uses James's bells: 18, 35 and 45 lb (Nov 7)", () => {
    const used = new Set<unknown>();
    for (const week of [1, 2, 3, 4]) {
      for (const day of ['A', 'B', 'C'] as const) {
        for (const i of planSession(data, at(week, day)).items) {
          used.add(i.stay.bell);
          if (i.up) used.add(i.up.bell);
        }
      }
    }
    used.delete(null);
    used.delete('BW');
    expect([...used].sort()).toEqual([18, 35, 45]);
    expect(item(planSession(data, at(1, 'A')), 'a-press')!.stay.bell).toBe(18);
    expect(item(planSession(data, at(1, 'A')), 'a-goblet-squat')!.stay.bell).toBe(35);
  });

  it('warm-up moves never touch progression', () => {
    const r = runSession(at(1, 'A'));
    expect(r.state.progress['air-squat']).toBeUndefined();
  });

  it('a top-of-range step offers nothing more', () => {
    let st = at(2, 'A');
    for (let i = 0; i < 4; i++) st = { ...runSession(st).state, pointer: st.pointer };
    const dl = item(planSession(data, st), 'a-deadlift')!;
    expect(dl.stay.target).toBe(10);
    expect(dl.up).toBeUndefined();
  });
});

describe('adapting to what James did (Nov 9)', () => {
  /** Finish week 2 day A with these reps (or seconds) and bell on one item. */
  const did = (state: EngineState, id: string, actual: number[], bell?: 18 | 35 | 45, pain = false) =>
    runSession(state, pain, (d) => ({
      ...d,
      items: d.items.map((it) =>
        it.plan.itemId === id
          ? { ...it, bell: bell ?? it.bell, sets: it.sets.map((s, k) => ({ ...s, actual: actual[k], bell: bell ?? s.bell })) }
          : it,
      ),
    }));

  it('beating the target on every set: next time asks for the most hit on every set', () => {
    const r = did(at(2, 'A'), 'a-deadlift', [10, 10, 10]); // plan: 3 × 8
    expect(r.state.levels['deadlift']).toEqual({ amount: 10, bell: 45, sets: 3 });
    const dl = item(planSession(data, at(2, 'A', r.state)), 'a-deadlift')!;
    expect(dl.stay).toMatchObject({ sets: 3, target: 10, bell: 45, fromLast: true });
    expect(dl.stay.moreSets).toBeFalsy();
    expect(dl.up).toBeUndefined(); // already past the plan's next step (9)
  });

  it('never more than 10 reps a set: past 10, the extra work comes as extra sets (Nov 13)', () => {
    const r = did(at(2, 'A'), 'a-deadlift', [12, 12, 11]); // 33 reps
    expect(r.state.levels['deadlift']).toEqual({ amount: 11, bell: 45, sets: 3 });
    const dl = item(planSession(data, at(2, 'A', r.state)), 'a-deadlift')!;
    expect(dl.stay).toMatchObject({ sets: 4, target: 10, bell: 45, fromLast: true, moreSets: true });
    expect(dl.up).toBeUndefined();
  });

  it('beating it again adds sets again; doing less never lowers it', () => {
    let st = did(at(2, 'A'), 'a-deadlift', [11, 11, 11]).state;
    expect(item(planSession(data, at(2, 'A', st)), 'a-deadlift')!.stay).toMatchObject({ sets: 4, target: 10 });
    st = did(at(2, 'A', st), 'a-deadlift', [13, 12, 12, 12]).state; // 48 reps
    expect(item(planSession(data, at(2, 'A', st)), 'a-deadlift')!.stay).toMatchObject({ sets: 5, target: 10 });
    st = did(at(2, 'A', st), 'a-deadlift', [10, 10, 10, 10, 9]).state;
    expect(item(planSession(data, at(2, 'A', st)), 'a-deadlift')!.stay).toMatchObject({ sets: 5, target: 10 });
  });

  it('no prescription ever asks for more than 10 reps a set', () => {
    let st = at(2, 'A');
    for (const reps of [[15, 15, 15], [20, 20, 20, 20, 20]]) {
      st = did(at(2, 'A', st), 'a-deadlift', reps).state;
      for (const it of planSession(data, at(2, 'A', st)).items) {
        if (it.kind === 'reps') expect(Math.max(it.stay.target, it.up?.target ?? 0)).toBeLessThanOrEqual(10);
      }
    }
  });

  it('one short set means no change', () => {
    const r = did(at(2, 'A'), 'a-deadlift', [12, 12, 7]);
    expect(r.state.levels['deadlift']).toBeUndefined();
    expect(item(planSession(data, at(2, 'A', r.state)), 'a-deadlift')!.stay.target).toBe(8);
  });

  it('a heavier bell: next time asks for what was managed with it, then builds from there', () => {
    let st = did(at(2, 'A'), 'a-goblet-squat', [6, 6, 6], 45).state; // plan: 3 × 8 on the 35
    let gs = item(planSession(data, at(2, 'A', st)), 'a-goblet-squat')!;
    expect(gs.stay).toMatchObject({ target: 6, bell: 45, fromLast: true });
    st = did(at(2, 'A', st), 'a-goblet-squat', [8, 7, 7]).state;
    gs = item(planSession(data, at(2, 'A', st)), 'a-goblet-squat')!;
    expect(gs.stay).toMatchObject({ target: 7, bell: 45 });
  });

  it('holds work the same, in seconds', () => {
    const r = did(at(2, 'A'), 'a-suitcase-carry', [40, 45, 40]);
    expect(item(planSession(data, at(2, 'A', r.state)), 'a-suitcase-carry')!.stay.target).toBe(40);
  });

  it('a session with joint pain changes nothing', () => {
    const r = did(at(2, 'A'), 'a-deadlift', [12, 12, 12], undefined, true);
    expect(r.state.levels['deadlift']).toBeUndefined();
  });

  it('works with state saved before levels existed', () => {
    const { levels: _, ...old } = at(2, 'A');
    const r = did(old as EngineState, 'a-deadlift', [10, 10, 10]);
    expect(r.state.levels['deadlift']).toEqual({ amount: 10, bell: 45, sets: 3 });
  });

  it('during a workout, the next sets start at what was just done, never below the plan', () => {
    const d = startDraft(planSession(data, at(2, 'A')), 'x', NOW);
    let dl = d.items.find((it) => it.plan.itemId === 'a-deadlift')!; // 3 × 8
    dl = completeSetAt({ ...dl, sets: dl.sets.map((s, k) => (k === 0 ? { ...s, actual: 10 } : s)) }, 0);
    expect(dl.sets.map((s) => s.actual)).toEqual([10, 10, 10]);
    dl = completeSetAt({ ...dl, sets: dl.sets.map((s, k) => (k === 1 ? { ...s, actual: 7 } : s)) }, 1);
    expect(dl.sets.map((s) => s.actual)).toEqual([10, 7, 8]);
    expect(dl.sets.map((s) => s.done)).toEqual([true, true, false]);
  });
});

describe('rest between sets (James, Nov 9)', () => {
  it('the rest setting applies to every move, hinge drill and get-ups included', () => {
    const mine = { ...data, plan: { ...plan, defaultRest: 90 } };
    for (const day of ['A', 'B', 'C'] as const) {
      for (const it of planSession(mine, at(1, day)).items) {
        if (it.kind === 'reps' || it.kind === 'time') expect([it.itemId, it.stay.rest]).toEqual([it.itemId, 90]);
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
    const ok = runSession(at(2, 'A'));
    const pain = runSession(at(2, 'A', ok.state), true, (d) => ({
      ...d,
      items: d.items.map((it) => setChoice(it, 'stay')),
    }));
    expect(pain.state.hold).toMatchObject({ week: 2 });
    expect(pain.state.progress['deadlift'].ready).toBe(false);

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
    const r = runSession(at(2, 'A'), false, (d) => ({
      ...d,
      items: d.items.map((it) =>
        it.plan.itemId === 'a-deadlift' ? { ...it, bell: 25, sets: it.sets.map((s) => ({ ...s, bell: 25 })) } : it,
      ),
    }));
    expect(r.state.bellPrefs['deadlift']).toEqual({ bell: 25, planBell: 45 });
    expect(item(planSession(data, at(2, 'A', r.state)), 'a-deadlift')!.stay.bell).toBe(25);

    const changed = { ...r.state, bellPrefs: { deadlift: { bell: 25 as const, planBell: 35 } } };
    expect(item(planSession(data, at(2, 'A', changed)), 'a-deadlift')!.stay.bell).toBe(45);
  });

  it('counts kettlebell reps, doubling per-side moves and skipping bodyweight', () => {
    const s = planSession(data, at(2, 'B'));
    const d = completeAll(startDraft(s, 'x', NOW));
    // swing 5×5 @25 = 25; row 3×8×2 @45 = 48; floor press 3×8×2 = 48; halo 2×5×2 = 20; lunge is BW
    expect(kbReps(d.items)).toBe(25 + 48 + 48 + 20);
  });
});
