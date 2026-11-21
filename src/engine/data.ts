// Loads and validates the bundled data files, plus cross-file checks.
import movementsJson from '../../data/movements.json';
import planJson from '../../data/plan.json';
import { LEVELS, MAX_REPS, MovementFile, PlanFile, type Item, type Movement, type Phase } from './schema';

export function parseMovements(raw: unknown): Movement[] {
  return MovementFile.parse(raw).movements;
}

export function parsePlan(raw: unknown): PlanFile {
  return PlanFile.parse(raw);
}

/** Each routine with the shared warm-up, breathing and evening holds filled in. */
export function expandRoutines(plan: PlanFile): Phase[] {
  return plan.routines.map((r) => ({
    ...r,
    warmup: r.warmup ?? plan.base.warmup,
    cooldown: r.cooldown ?? plan.base.cooldown,
    morning: r.morning ?? plan.base.morning,
    evening: r.evening ?? plan.base.evening,
  }));
}

/** Problems that the schema alone can't catch (unknown move ids, duplicate ids, …). */
export function crossCheck(plan: PlanFile, movements: Movement[]): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const m of movements) {
    if (ids.has(m.id)) problems.push(`Duplicate movement id: ${m.id}`);
    ids.add(m.id);
  }
  const levelOf = new Map(movements.map((m) => [m.id, LEVELS.indexOf(m.level)]));
  for (const m of movements) {
    for (const p of m.prereqs ?? []) {
      if (!ids.has(p)) problems.push(`${m.id}: unknown prerequisite ${p}`);
      else if (levelOf.get(p)! > levelOf.get(m.id)!) problems.push(`${m.id}: easier level than its prerequisite ${p}`);
    }
    for (const r of m.related ?? []) if (!ids.has(r)) problems.push(`${m.id}: unknown related move ${r}`);
  }

  const routineIds = new Set<string>();
  const levelNs = new Set(plan.levels.map((l) => l.n));
  for (const l of plan.levels) if (!plan.routines.some((r) => r.level === l.n)) problems.push(`Level ${l.n} has no routines`);
  for (const phase of expandRoutines(plan)) {
    if (routineIds.has(phase.id)) problems.push(`Duplicate routine id: ${phase.id}`);
    routineIds.add(phase.id);
    if (!levelNs.has(phase.level)) problems.push(`${phase.id}: unknown level ${phase.level}`);
    if (phase.weeks[0] !== 1 || phase.weeks[1] < 1) problems.push(`${phase.id}: weeks must start at 1`);
    const itemIds = new Set<string>();
    const checkItem = (item: Item, where: string) => {
      if (itemIds.has(item.id)) problems.push(`${phase.id}: duplicate item id ${item.id}`);
      itemIds.add(item.id);
      const moves = [item.move, ...Object.values(item.byWeek ?? {}).map((o) => o.move)];
      for (const mv of moves) if (mv && !ids.has(mv)) problems.push(`${where} ${item.id}: unknown move ${mv}`);
      if (item.kind !== 'breath' && item.kind !== 'routine' && !item.move && !item.label) problems.push(`${where} ${item.id}: needs a move or a label`);
      if (item.kind === 'routine') {
        if (item.routine && !phase[item.routine]) problems.push(`${where} ${item.id}: no ${item.routine} routine in this phase`);
        if (!item.routine && !item.stations?.length) problems.push(`${where} ${item.id}: routine has no stations`);
        for (const s of item.stations ?? []) if (s.move && !ids.has(s.move)) problems.push(`${where} ${item.id}: unknown station move ${s.move}`);
      }
      if ((item.kind === 'reps' || item.kind === 'circuit' || item.kind === 'flow') && item.reps === undefined)
        problems.push(`${where} ${item.id}: reps missing`);
      if (item.kind === 'reps' || item.kind === 'circuit' || item.kind === 'flow') {
        const partReps = [item.parts, ...Object.values(item.byWeek ?? {}).map((o) => o.parts)].flatMap((ps) => (ps ?? []).map((pt) => pt.reps));
        const reps = [item.reps, ...Object.values(item.byWeek ?? {}).map((o) => o.reps), ...(item.ladder ?? []).map((s) => s.reps), ...partReps];
        const most = Math.max(0, ...reps.flat().filter((n): n is number => typeof n === 'number'));
        if (most > MAX_REPS) problems.push(`${where} ${item.id}: ${most} reps in a set (most is ${MAX_REPS}; add sets instead)`);
      }
      if (item.kind === 'circuit' || item.kind === 'flow') {
        for (const parts of [item.parts, ...Object.values(item.byWeek ?? {}).map((o) => o.parts)]) {
          if (parts === undefined) continue;
          if (parts.length < 2) problems.push(`${where} ${item.id}: a ${item.kind} needs at least 2 moves`);
          for (const pt of parts) if (!ids.has(pt.move)) problems.push(`${where} ${item.id}: unknown move ${pt.move}`);
        }
        if (!item.parts?.length) problems.push(`${where} ${item.id}: ${item.kind} has no moves`);
        if (!item.label) problems.push(`${where} ${item.id}: ${item.kind} needs a label`);
        if (item.kind === 'flow' && item.parts?.some((pt) => pt.bell !== undefined)) problems.push(`${where} ${item.id}: a flow uses one bell (the item's)`);
      }
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
  /** Every routine, ready to plan from, in file order (Nov 20). */
  routines: Phase[];
  routineById: Map<string, Phase>;
  movements: Movement[];
  moveById: Map<string, Movement>;
}

export function buildData(plan: PlanFile, movements: Movement[]): AppData {
  const routines = expandRoutines(plan);
  return {
    plan,
    routines,
    routineById: new Map(routines.map((r) => [r.id, r])),
    movements,
    moveById: new Map(movements.map((m) => [m.id, m])),
  };
}

export function loadData(): AppData {
  const movements = parseMovements(movementsJson);
  const plan = parsePlan(planJson);
  const problems = crossCheck(plan, movements);
  if (problems.length) throw new Error('Plan data problems:\n' + problems.join('\n'));
  return buildData(plan, movements);
}
