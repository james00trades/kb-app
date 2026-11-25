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

  it('every move used in any routine has form cues; the first routine (Foundations) starts all unlocked', () => {
    const { routines, moveById } = loadData();
    const usedIn = (ph: (typeof routines)[number]) => {
      const used = new Set<string>();
      const items = [...ph.warmup, ...ph.cooldown, ...Object.values(ph.days).flatMap((d) => d.items ?? [])];
      for (const it of items) {
        if (it.move) used.add(it.move);
        for (const o of Object.values(it.byWeek ?? {})) if (o.move) used.add(o.move);
        for (const st of it.stations ?? []) if (st.move) used.add(st.move);
        for (const pt of it.parts ?? []) used.add(pt.move);
      }
      for (const s of [...(ph.morning?.stations ?? []), ...(ph.evening?.stations ?? [])]) if (s.move) used.add(s.move);
      return used;
    };
    for (const r of routines) for (const id of usedIn(r)) expect(moveById.get(id)!.cues?.length, `${r.id}: ${id} cues`).toBeGreaterThan(0);
    // Moves in later routines unlock in the library once they're trained
    for (const id of usedIn(routines[0])) expect(moveById.get(id)!.unlocked, `${id} unlocked`).toBe(true);
  });

  it('Frame of David additions (James, Nov 10): 14 moves + the supported row, with his flags and start bells', () => {
    const { moveById, movements } = loadData();
    const added = ['tactical-crossover', 'front-to-back-raise', 'gravedigger', 'uppercut', 'curl-to-press', 'woodchop', 'clean-to-squat',
      'side-to-front-raise', 'pullover-to-side-pull', 'hammer-curl', 'around-the-world-to-curl', 'curl-to-pullover', 'hand-to-hand-curl',
      'over-shoulder-pull', 'supported-row'];
    expect(movements).toHaveLength(126); // 107 + standing push-out, couch stretch (Nov 14), lying spinal twist (Nov 16), 10 on Nov 23, 6 on Nov 24
    for (const id of added) expect(moveById.get(id)?.cues?.length, id).toBeGreaterThan(0);
    // Shoulder hold: the ⚠ moves from his notes
    expect(added.filter((id) => moveById.get(id)!.shoulder).sort()).toEqual(
      ['curl-to-press', 'curl-to-pullover', 'front-to-back-raise', 'over-shoulder-pull', 'pullover-to-side-pull', 'side-to-front-raise']);
    // Best guesses: the medium-confidence moves, so he can find and check them (more joined on Nov 20: the
    // cues written for moves the new routines use)
    expect(movements.filter((m) => m.guess).map((m) => m.id)).toEqual(expect.arrayContaining(
      ['curl-to-press', 'gravedigger', 'over-shoulder-pull', 'pullover-to-side-pull', 'side-to-front-raise', 'tactical-crossover']));
    // His pick: 35 lb for the leg-driven ones (his 30 since Nov 24: no 35 lb bell), 18 lb for the rest
    expect(added.filter((id) => moveById.get(id)!.startBell === 30).sort()).toEqual(['clean-to-squat', 'gravedigger', 'woodchop']);
    expect(added.filter((id) => moveById.get(id)!.startBell === 18)).toHaveLength(11);
    // Only the easier row variation starts unlocked
    expect(added.filter((id) => moveById.get(id)!.unlocked)).toEqual(['supported-row']);
  });

  it('Deee_Fit and Savage rotational additions (James, Nov 23): 10 moves for the pool, none in the plan', () => {
    const { moveById, routines } = loadData();
    const deee = ['clean-to-halo', 'rotation-pullover', 'gorilla-swing', 'over-shoulder-toss', 'curl-to-goblet-press'];
    const savage = ['alternating-rotational-clean', 'side-toss-to-rotational-snatch', 'cross-body-drop-to-pull', 'held-figure-8',
      'extended-figure-8-chop'];
    const added = [...deee, ...savage];
    for (const id of added) {
      const m = moveById.get(id)!;
      expect(m.cues!.length, id).toBeGreaterThan(3);
      expect(m.unlocked, id).toBe(false);
      expect(m.guess, id).toBeUndefined(); // high confidence or confirmed by James
    }
    // Shoulder hold: the ⚠ moves from his notes, each with its swap as the last cue
    const held = added.filter((id) => moveById.get(id)!.shoulder);
    expect(held.sort()).toEqual(['clean-to-halo', 'curl-to-goblet-press', 'extended-figure-8-chop', 'over-shoulder-toss',
      'rotation-pullover', 'side-toss-to-rotational-snatch']);
    for (const id of held) expect(moveById.get(id)!.cues!.at(-1), id).toMatch(/^Shoulder hold: /);
    // Same start-bell rule as Nov 10: the 30 (was 35) for the leg-driven ones, 18 lb for the rest
    expect(added.filter((id) => moveById.get(id)!.startBell === 30).sort()).toEqual(['gorilla-swing', 'over-shoulder-toss']);
    expect(added.filter((id) => moveById.get(id)!.startBell === 18)).toHaveLength(8);
    // The Savage five are Month 9+
    for (const id of savage) expect(moveById.get(id)!.level, id).toBe('advanced');
    // The links his notes give
    expect(moveById.get('over-shoulder-toss')!.related).toEqual(['gravedigger']);
    expect(moveById.get('curl-to-goblet-press')!.related).toEqual(['curl-to-press']);
    expect(moveById.get('extended-figure-8-chop')!.prereqs).toEqual(['held-figure-8']);
    // A pool only: no routine uses them yet
    const used = JSON.stringify(routines);
    for (const id of added) expect(used, id).not.toContain(`"${id}"`);
  });

  it("standing push-out (James, Nov 14): in the library, not in the plan, light bell", () => {
    const m = loadData().moveById.get('standing-push-out')!;
    expect(m).toMatchObject({ name: 'Standing push-out', pattern: 'push', unlocked: false, startBell: 18 });
    expect(m.cues!.join(' ')).toContain('straight out at chest height');
  });

  it('every move has a difficulty level (James, Nov 18) that matches the routines and the unlock order', () => {
    const { moveById, movements, routines } = loadData();
    const count = (l: string) => movements.filter((m) => m.level === l).length;
    expect([count('beginner'), count('intermediate'), count('advanced')]).toEqual([61, 44, 21]);
    const movesOf = (level: number) =>
      routines.filter((r) => r.level === level).flatMap((r) => [...JSON.stringify(r).matchAll(/"move":"([a-z0-9-]+)"/g)].map((x) => x[1]));
    // Everything in Level 1 (warm-up, days, flows, evening holds) is Beginner
    expect(movesOf(1).length).toBeGreaterThan(30);
    for (const id of movesOf(1)) expect(moveById.get(id)!.level, id).toBe('beginner');
    // Level 2 brings in Intermediate moves but nothing Advanced yet
    expect(movesOf(2).some((id) => moveById.get(id)!.level === 'intermediate')).toBe(true);
    for (const id of movesOf(2)) expect(moveById.get(id)!.level, id).not.toBe('advanced');
    expect(movesOf(4).some((id) => moveById.get(id)!.level === 'advanced')).toBe(true);
    // Month 2 new moves land in Intermediate; the Month 4+ ones in Advanced
    for (const id of ['single-arm-swing', 'clean', 'push-press', 'figure-8', 'transfers', 'full-get-up', 'clean-and-press'])
      expect(moveById.get(id)!.level, id).toBe('intermediate');
    for (const id of ['windmill', 'wtf-mfer', 'snatch']) expect(moveById.get(id)!.level, id).toBe('advanced');
  });

  it('flags a move rated easier than a move it requires', () => {
    const moves = parseMovements(structuredClone(movementsJson));
    moves.find((m) => m.id === 'snatch')!.level = 'beginner';
    expect(crossCheck(parsePlan(planJson), moves).join()).toContain('snatch: easier level than its prerequisite');
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
      const dl = plan.routines[0].days.A.items!.find((i) => i.id === 'a-deadlift')!;
      change(dl as unknown as Record<string, unknown>);
      expect(crossCheck(plan, moves).join()).toContain('a-deadlift: ');
      expect(crossCheck(plan, moves).join()).toContain('add sets instead');
    }
  });

  it('flags an unknown move id', () => {
    const plan = parsePlan(structuredClone(planJson));
    plan.routines[0].days.A.items![0].move = 'not-a-move';
    expect(crossCheck(plan, parseMovements(movementsJson)).join()).toContain('not-a-move');
  });

  it('flags circuits and flows that break the rules (Nov 20)', () => {
    const moves = parseMovements(movementsJson);
    const anvil = () => {
      const plan = parsePlan(structuredClone(planJson));
      return { plan, c1: plan.routines.find((r) => r.id === 'l2-anvil')!.days.A.items!.find((i) => i.id === 'a-c1')! };
    };
    let t = anvil();
    t.c1.parts![0].move = 'not-a-move';
    expect(crossCheck(t.plan, moves).join()).toContain('a-c1: unknown move not-a-move');
    t = anvil();
    t.c1.parts = t.c1.parts!.slice(0, 1);
    expect(crossCheck(t.plan, moves).join()).toContain('needs at least 2 moves');
    t = anvil();
    t.c1.parts![1].reps = 12;
    expect(crossCheck(t.plan, moves).join()).toContain('add sets instead');
    const plan = parsePlan(structuredClone(planJson));
    const flow = plan.routines.find((r) => r.id === 'l3-raider')!.days.A.items!.find((i) => i.id === 'a-f1')!;
    flow.parts![0].bell = 35;
    expect(crossCheck(plan, moves).join()).toContain('a flow uses one bell');
    const noLevel = parsePlan(structuredClone(planJson));
    noLevel.routines = noLevel.routines.filter((r) => r.level !== 3);
    expect(crossCheck(noLevel, moves).join()).toContain('Level 3 has no routines');
  });
});
