// Shapes of the data files (data/movements.json, data/plan.json).
// Validated by the tests on every build, and again when the app starts.
import { z } from 'zod';

export const Bell = z.union([z.literal('BW'), z.number().positive()]);
export type Bell = z.infer<typeof Bell>;

const Range = z.tuple([z.number().positive(), z.number().positive()]);
const NumOrRange = z.union([z.number().positive(), Range]);

export const Pattern = z.enum([
  'hinge', 'squat', 'lunge', 'push', 'pull', 'carry', 'rotation', 'mobility', 'compound',
]);
export type Pattern = z.infer<typeof Pattern>;

export const Movement = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string(),
  tier: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
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
}).partial();

export const LadderStep = Override.pick({ sets: true, reps: true, seconds: true, bell: true });
export type LadderStep = z.infer<typeof LadderStep>;

export const Item = Override.extend({
  id: z.string(),
  kind: z.enum(['reps', 'time', 'breath', 'routine']),
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

export const Phase = z.object({
  id: z.string(),
  name: z.string(),
  weeks: Range,
  effort: z.string().optional(),
  minutes: z.string().optional(),
  setCapInWeek: z.record(z.string(), z.number().int().positive()).optional(),
  warmup: z.array(Item),
  cooldown: z.array(Item),
  days: z.object({ A: Day, B: Day, C: Day, REST: Day }),
  morning: Extra.optional(),
  evening: Extra.optional(),
  checks: z.array(z.string()).optional(),
});
export type Phase = z.infer<typeof Phase>;

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
  phases: z.array(Phase).min(1),
});
export type PlanFile = z.infer<typeof PlanFile>;
