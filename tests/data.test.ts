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
      }
      for (const s of [...(ph.morning?.stations ?? []), ...(ph.evening?.stations ?? [])]) if (s.move) used.add(s.move);
    }
    for (const id of used) {
      const m = moveById.get(id)!;
      expect(m.cues?.length, `${id} cues`).toBeGreaterThan(0);
      expect(m.unlocked, `${id} unlocked`).toBe(true);
    }
  });

  it('flags an unknown move id', () => {
    const plan = parsePlan(structuredClone(planJson));
    plan.phases[0].days.A.items![0].move = 'not-a-move';
    expect(crossCheck(plan, parseMovements(movementsJson)).join()).toContain('not-a-move');
  });
});
