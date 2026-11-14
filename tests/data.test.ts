import { describe, expect, it } from 'vitest';
import movementsJson from '../data/movements.json';
import planJson from '../data/plan.json';
import { crossCheck, loadData, parseMovements, parsePlan } from '../src/engine/data';

describe('data files', () => {
  it('movement library matches the schema', () => {
    const moves = parseMovements(movementsJson);
    expect(moves.length).toBeGreaterThanOrEqual(80);
  });

  it('plan matches the schema', () => {
    expect(() => parsePlan(planJson)).not.toThrow();
  });

  it('every move in the plan exists in the library, ids are unique', () => {
    const problems = crossCheck(parsePlan(planJson), parseMovements(movementsJson));
    expect(problems).toEqual([]);
  });

  it('every move used in the plan has form cues and starts unlocked', () => {
    const { plan, moveById } = loadData();
    const used = new Set<string>();
    for (const ph of plan.phases) {
      const items = [...ph.warmup, ...ph.cooldown, ...Object.values(ph.days).flatMap((d) => d.items ?? [])];
      for (const it of items) {
        if (it.move) used.add(it.move);
        for (const o of Object.values(it.byWeek ?? {})) if (o.move) used.add(o.move);
        for (const st of it.stations ?? []) if (st.move) used.add(st.move);
      }
      for (const s of [...(ph.morning?.stations ?? []), ...(ph.evening?.stations ?? [])]) if (s.move) used.add(s.move);
    }
    for (const id of used) {
      const m = moveById.get(id)!;
      expect(m.cues?.length, `${id} cues`).toBeGreaterThan(0);
      expect(m.unlocked, `${id} unlocked`).toBe(true);
    }
  });

  it('Frame of David additions (James, Nov 10): 14 moves + the supported row, with his flags and start bells', () => {
    const { moveById, movements } = loadData();
    const added = ['tactical-crossover', 'front-to-back-raise', 'gravedigger', 'uppercut', 'curl-to-press', 'woodchop', 'clean-to-squat',
      'side-to-front-raise', 'pullover-to-side-pull', 'hammer-curl', 'around-the-world-to-curl', 'curl-to-pullover', 'hand-to-hand-curl',
      'over-shoulder-pull', 'supported-row'];
    expect(movements).toHaveLength(109); // 107 + the standing push-out and the couch stretch (Nov 14)
    for (const id of added) expect(moveById.get(id)?.cues?.length, id).toBeGreaterThan(0);
    // Shoulder hold: the ⚠ moves from his notes
    expect(movements.filter((m) => m.shoulder).map((m) => m.id).sort()).toEqual(
      ['curl-to-press', 'curl-to-pullover', 'front-to-back-raise', 'over-shoulder-pull', 'pullover-to-side-pull', 'side-to-front-raise']);
    // Best guesses: the medium-confidence moves, so he can find and check them
    expect(movements.filter((m) => m.guess).map((m) => m.id).sort()).toEqual(
      ['curl-to-press', 'gravedigger', 'over-shoulder-pull', 'pullover-to-side-pull', 'side-to-front-raise', 'tactical-crossover']);
    // His pick: 35 lb for the leg-driven ones, 18 lb for the rest
    expect(added.filter((id) => moveById.get(id)!.startBell === 35).sort()).toEqual(['clean-to-squat', 'gravedigger', 'woodchop']);
    expect(added.filter((id) => moveById.get(id)!.startBell === 18)).toHaveLength(11);
    // None of them goes into the current plan: only the easier row variation starts unlocked
    expect(added.filter((id) => moveById.get(id)!.unlocked)).toEqual(['supported-row']);
  });

  it("standing push-out (James, Nov 14): in the library, not in the plan, light bell", () => {
    const m = loadData().moveById.get('standing-push-out')!;
    expect(m).toMatchObject({ name: 'Standing push-out', pattern: 'push', unlocked: false, startBell: 18 });
    expect(m.cues!.join(' ')).toContain('straight out at chest height');
  });

  it('flags an unknown related move', () => {
    const moves = parseMovements(structuredClone(movementsJson));
    moves[0].related = ['not-a-move'];
    expect(crossCheck(parsePlan(planJson), moves).join()).toContain('unknown related move not-a-move');
  });

  it('flags any set of more than 10 reps (James, Nov 13: add sets instead)', () => {
    const moves = parseMovements(movementsJson);
    for (const change of [
      (it: Record<string, unknown>) => (it.reps = 12),
      (it: Record<string, unknown>) => (it.reps = [8, 12]),
      (it: Record<string, unknown>) => (it.byWeek = { 3: { reps: [10, 15] } }),
    ]) {
      const plan = parsePlan(structuredClone(planJson));
      const dl = plan.phases[0].days.A.items!.find((i) => i.id === 'a-deadlift')!;
      change(dl as unknown as Record<string, unknown>);
      expect(crossCheck(plan, moves).join()).toContain('a-deadlift: ');
      expect(crossCheck(plan, moves).join()).toContain('add sets instead');
    }
  });

  it('flags an unknown move id', () => {
    const plan = parsePlan(structuredClone(planJson));
    plan.phases[0].days.A.items![0].move = 'not-a-move';
    expect(crossCheck(plan, parseMovements(movementsJson)).join()).toContain('not-a-move');
  });
});
