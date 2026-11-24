// Shapes of the data files (data/movements.json, data/plan.json).
// Validated by the tests on every build, and again when the app starts.
import { z } from 'zod';

/** Two bells at once, heavier first: "45+30" (James, Nov 24: deadlifts holding his 45 and 30 together). */
export type BellPair = `${number}+${number}`;
const PAIR = /^\d+(\.\d+)?\+\d+(\.\d+)?$/;
const Pair = z.custom<BellPair>((v) => typeof v === 'string' && PAIR.test(v), 'Two bells, like "45+30"');

export const Bell = z.union([z.literal('BW'), z.number().positive(), Pair]);
export type Bell = z.infer<typeof Bell>;

export const isPair = (b: Bell | null | undefined): b is BellPair => typeof b === 'string' && PAIR.test(b);

/** The bells in hand: one, two, or none for bodyweight and no-bell work. */
export function bellsIn(b: Bell | null | undefined): number[] {
  if (typeof b === 'number') return [b];
  return isPair(b) ? b.split('+').map(Number) : [];
}

/** Bell weight for comparing: a pair counts both bells; bodyweight and no bell count as 0. */
export const heft = (b: Bell | null | undefined) => bellsIn(b).reduce((n, x) => n + x, 0);

/** Kettlebell work: one bell or two, not bodyweight. */
export const hasBell = (b: Bell | null | undefined) => heft(b) > 0;

/** A pair, written heavier first so the same two bells always match. */
export const pairOf = (a: number, b: number): BellPair => `${Math.max(a, b)}+${Math.min(a, b)}`;

/** Every two of his bells together, lightest pair first. One of each bell, so no doubles. */
export function pairsFrom(bells: number[]): BellPair[] {
  const own = [...new Set(bells)].sort((a, b) => a - b);
  const out: BellPair[] = [];
  for (let i = 0; i < own.length; i++) for (let j = i + 1; j < own.length; j++) out.push(pairOf(own[i], own[j]));
  return out.sort((a, b) => heft(a) - heft(b) || bellsIn(a)[0] - bellsIn(b)[0]);
}

const Range = z.tuple([z.number().positive(), z.number().positive()]);
const NumOrRange = z.union([z.number().positive(), Range]);

/** The most reps the app asks for in one set. More work means more sets, not more reps (James, Nov 13, 2026). */
export const MAX_REPS = 10;

/** The most sets the app asks for on one exercise, circuit or flow (James, Nov 23: "I never want more than
 *  5 sets per exercise"). */
export const MAX_SETS = 5;

/** A total this big (5 sets of 8–10) means a heavier bell or a harder move next, not more reps (James,
 *  Nov 23: "if we hit that 40-50 rep range then that's our trigger"). Flows count cycles. */
export const COUNT_GOAL = 40;

/** Holds: 3 minutes in all (per side for one-sided holds) is the goal, then heavier or harder (Nov 23). */
export const HOLD_GOAL = 180;

export const Pattern = z.enum([
  'hinge', 'squat', 'lunge', 'push', 'pull', 'carry', 'rotation', 'mobility', 'compound',
]);
export type Pattern = z.infer<typeof Pattern>;

/** Difficulty, easiest first: roughly Month 1, Months 2–3, Month 4 and on (James, Nov 18, 2026). */
export const LEVELS = ['beginner', 'intermediate', 'advanced'] as const;
export const Level = z.enum(LEVELS);
export type Level = z.infer<typeof Level>;

export const Movement = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string(),
  tier: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  level: Level,
  pattern: Pattern,
  bell: z.boolean(),
  unlocked: z.boolean(),
  firstClips: z.boolean().optional(),
  cues: z.array(z.string()).optional(),
  prereqs: z.array(z.string()).optional(),
  unlockNote: z.string().optional(),
  /** Bell (lb) to start the move with when it first goes into a routine. */
  startBell: z.number().positive().optional(),
  /** Hard on the shoulders: shows a "Shoulder hold" label (good arm only, or skip). */
  shoulder: z.boolean().optional(),
  /** Path and cues are a best guess from a video; James to check them. */
  guess: z.boolean().optional(),
  /** Variations and close cousins (shown both ways in the library). */
  related: z.array(z.string()).optional(),
});
export type Movement = z.infer<typeof Movement>;

export const MovementFile = z.object({
  version: z.number(),
  movements: z.array(Movement),
});

/** One timed move in a guided routine. */
export const Station = z.object({
  label: z.string(),
  seconds: z.number().positive(),
  move: z.string().optional(),
});
export type Station = z.infer<typeof Station>;

/** One move inside a circuit (one round = each part once) or a flow (one cycle = each part in order). */
export const Part = z.object({
  move: z.string(),
  /** Circuits: this move's own count, when it differs from the round's (flows: times through in a cycle). */
  reps: z.number().int().positive().optional(),
  perSide: z.boolean().optional(),
  sideLabel: z.string().optional(),
  /** Circuits: this move's bell (a flow uses one bell, the item's). */
  bell: Bell.optional(),
});
export type Part = z.infer<typeof Part>;

/** Fields that can change week to week, or step to step on a progression ladder. */
const Override = z.object({
  move: z.string(),
  label: z.string(),
  sets: z.number().int().positive(),
  reps: NumOrRange,
  seconds: NumOrRange,
  bell: Bell,
  rest: z.number().min(0),
  notes: z.string(),
  parts: z.array(Part),
}).partial();

export const LadderStep = Override.pick({ sets: true, reps: true, seconds: true, bell: true });
export type LadderStep = z.infer<typeof LadderStep>;

export const Item = Override.extend({
  id: z.string(),
  /** reps: straight sets of one move, done as a total. time: a hold or carry. circuit: several moves back
   *  to back, then rest; `sets` = rounds, `reps` = the count for each move. flow: moves chained without
   *  putting the bell down; `sets` = sets, `reps` = cycles a set (per side when perSide). (Nov 20, 2026) */
  kind: z.enum(['reps', 'time', 'breath', 'routine', 'circuit', 'flow']),
  /** Routine items only: a guided timer that runs this phase routine (e.g. the morning wake-up) first… */
  routine: z.enum(['morning', 'evening']).optional(),
  /** …then these stations. */
  stations: z.array(Station).optional(),
  /** Seconds between stations. Defaults to the phase routine's, else 0. */
  transition: z.number().min(0).optional(),
  perSide: z.boolean().optional(),
  sideLabel: z.string().optional(),
  /** Only appears in these weeks (inclusive). */
  weeks: Range.optional(),
  /** Overrides that apply from the given week onward. */
  byWeek: z.record(z.string(), Override).optional(),
  /** Progression steps. Without one, a rep or seconds range becomes the ladder. */
  ladder: z.array(LadderStep).optional(),
  /** Items sharing a key share progression. Defaults to the move id. */
  progressKey: z.string().optional(),
  /** Breathwork only. */
  minutes: z.number().positive().optional(),
  patterns: z.array(z.string()).optional(),
});
export type Item = z.infer<typeof Item>;

export const Extra = z.object({
  title: z.string(),
  transition: z.number().min(0),
  stations: z.array(Station).min(1),
});
export type Extra = z.infer<typeof Extra>;

const Day = z.object({
  title: z.string(),
  notes: z.string().optional(),
  items: z.array(Item).optional(),
});

export const DayKey = z.enum(['A', 'B', 'C', 'REST']);
export type DayKey = z.infer<typeof DayKey>;

/** A difficulty level (James, Nov 20): 1 straight sets, 2 circuits, 3 circuits and flows, 4 mostly flows. */
export const LevelInfo = z.object({
  n: z.number().int().min(1),
  name: z.string(),
  summary: z.string(),
});
export type LevelInfo = z.infer<typeof LevelInfo>;

/** A 4-week routine at one level. The warm-up, breathing and evening holds come from the plan's
 *  `base` unless the routine has its own. */
export const RoutineFile = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string(),
  level: z.number().int().min(1),
  summary: z.string(),
  weeks: Range,
  effort: z.string().optional(),
  minutes: z.string().optional(),
  setCapInWeek: z.record(z.string(), z.number().int().positive()).optional(),
  warmup: z.array(Item).optional(),
  cooldown: z.array(Item).optional(),
  days: z.object({ A: Day, B: Day, C: Day, REST: Day }),
  morning: Extra.optional(),
  evening: Extra.optional(),
  checks: z.array(z.string()).optional(),
});
export type RoutineFile = z.infer<typeof RoutineFile>;

/** A routine with the shared parts filled in: what the engine plans from. */
export type Phase = Omit<RoutineFile, 'warmup' | 'cooldown'> & { warmup: Item[]; cooldown: Item[] };

const Base = z.object({
  warmup: z.array(Item),
  cooldown: z.array(Item),
  morning: Extra.optional(),
  evening: Extra.optional(),
});

export const BreathPattern = z.object({
  name: z.string(),
  steps: z.array(z.tuple([z.enum(['in', 'hold', 'out']), z.number().positive()])),
});
export type BreathPattern = z.infer<typeof BreathPattern>;

export const PlanFile = z.object({
  version: z.number(),
  name: z.string(),
  rotation: z.array(DayKey).min(1),
  defaultRest: z.number().min(0),
  breathPatterns: z.record(z.string(), BreathPattern),
  levels: z.array(LevelInfo).min(1),
  base: Base,
  routines: z.array(RoutineFile).min(1),
});
export type PlanFile = z.infer<typeof PlanFile>;
