// Loads and validates the bundled data files, plus cross-file checks.
import movementsJson from '../../data/movements.json';
import planJson from '../../data/plan.json';
import { MovementFile, PlanFile, type Movement, type Item } from './schema';

export function parseMovements(raw: unknown): Movement[] {
  return MovementFile.parse(raw).movements;
}

export function parsePlan(raw: unknown): PlanFile {
  return PlanFile.parse(raw);
}

/** Problems that the schema alone can't catch (unknown move ids, duplicate ids, …). */
export function crossCheck(plan: PlanFile, movements: Movement[]): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const m of movements) {
    if (ids.has(m.id)) problems.push(`Duplicate movement id: ${m.id}`);
    ids.add(m.id);
  }
  for (const m of movements) {
    for (const p of m.prereqs ?? []) if (!ids.has(p)) problems.push(`${m.id}: unknown prerequisite ${p}`);
  }

  for (const phase of plan.phases) {
    const itemIds = new Set<string>();
    const checkItem = (item: Item, where: string) => {
      if (itemIds.has(item.id)) problems.push(`${phase.id}: duplicate item id ${item.id}`);
      itemIds.add(item.id);
      const moves = [item.move, ...Object.values(item.byWeek ?? {}).map((o) => o.move)];
      for (const mv of moves) if (mv && !ids.has(mv)) problems.push(`${where} ${item.id}: unknown move ${mv}`);
      if (item.kind !== 'breath' && !item.move && !item.label) problems.push(`${where} ${item.id}: needs a move or a label`);
      if (item.kind === 'reps' && item.reps === undefined) problems.push(`${where} ${item.id}: reps missing`);
      if (item.kind === 'time' && item.seconds === undefined) problems.push(`${where} ${item.id}: seconds missing`);
      if (item.kind === 'breath') {
        if (!item.minutes) problems.push(`${where} ${item.id}: minutes missing`);
        for (const p of item.patterns ?? []) if (!plan.breathPatterns[p]) problems.push(`${where} ${item.id}: unknown breath pattern ${p}`);
      }
    };
    phase.warmup.forEach((i) => checkItem(i, `${phase.id} warmup`));
    phase.cooldown.forEach((i) => checkItem(i, `${phase.id} cooldown`));
    for (const [day, d] of Object.entries(phase.days)) (d.items ?? []).forEach((i) => checkItem(i, `${phase.id} day ${day}`));
    for (const extra of [phase.morning, phase.evening]) {
      for (const s of extra?.stations ?? []) if (s.move && !ids.has(s.move)) problems.push(`${phase.id}: unknown station move ${s.move}`);
    }
  }
  return problems;
}

export interface AppData {
  plan: PlanFile;
  movements: Movement[];
  moveById: Map<string, Movement>;
}

export function loadData(): AppData {
  const movements = parseMovements(movementsJson);
  const plan = parsePlan(planJson);
  const problems = crossCheck(plan, movements);
  if (problems.length) throw new Error('Plan data problems:\n' + problems.join('\n'));
  return { plan, movements, moveById: new Map(movements.map((m) => [m.id, m])) };
}
