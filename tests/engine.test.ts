import { describe, expect, it } from 'vitest';
import { loadData } from '../src/engine/data';
import {
  advance, back, finishSession, initialState, kbReps, passDay, planSession, setChoice, startDraft,
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

  it('every day has three parts: warm-up, workout, evening holds (James, Nov 7)', () => {
    for (const day of ['A', 'B', 'C'] as const) {
      for (const week of [1, 4]) {
        const s = planSession(data, at(week, day));
        const labels = s.warmup!.stations.map((st) => st.label);
        expect(labels[0]).toBe('Jumping twists');
        expect(labels.at(-1)).toBe('Hindu push-ups'); // no burpees (James, Nov 7)
        expect(labels).toHaveLength(15);
        expect(s.warmup!.seconds).toBe(420); // 5 min wake-up + 4 × 30 s
        expect(s.items[0].section).toBe('main'); // the workout starts with the main work
        expect(s.items.some((i) => i.kind === 'routine')).toBe(false);
        expect(s.evening!.stations).toHaveLength(5);
        expect(s.evening!.seconds).toBe(5 * 120 + 4 * 10);
      }
    }
  });

  it('a rest day has the wake-up routine on its own, then the evening holds', () => {
    const s = planSession(data, at(1, 'REST'));
    expect(s.warmup!.title).toBe('Morning wake-up');
    expect(s.warmup!.stations).toHaveLength(11);
    expect(s.warmup!.seconds).toBe(300);
    expect(s.evening).toBeDefined();
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
