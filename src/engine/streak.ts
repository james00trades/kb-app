// The streak: calendar days in a row that were "kept".
// James's rule (Nov 10, 2026; walking days changed Nov 14):
//   - a workout day is kept when the warm-up and a full workout (every move done) are both done;
//   - a walking (rest) day is kept when it's marked done. No warm-up needed.
// Stretching doesn't count toward the streak: not the evening holds (since Nov 10),
// and not the wake-up routine (since Nov 14). A workout ended early, a skipped day,
// or a missing part breaks it. Today doesn't break it until the day is over.
import type { SessionLog } from './engine';

/** The day's warm-up and evening parts (see Daily in lib/db.ts). */
export interface DayExtras {
  date: string;
  morning?: number;
  warmup?: number;
  evening?: number;
}

type Log = Pick<SessionLog, 'date' | 'status'> & { items?: { plan: { section: string } }[] };

export interface DayParts {
  /** A walking (rest) day: only the walk counts. */
  rest: boolean;
  warmup: boolean;
  main: boolean;
  evening: boolean;
}

export interface Streak {
  /** Kept days in a row, ending today (if kept) or yesterday (today isn't over yet). */
  current: number;
  /** The longest run ever. */
  best: number;
  todayKept: boolean;
  today: DayParts;
}

export const keeps = (s: Pick<SessionLog, 'status'>) => s.status === 'done' || s.status === 'rest';

/** `restDay`: what today's plan is, until something is logged (the plan moves on once a day is done). */
export function dayParts(logs: Log[], extras: DayExtras | undefined, restDay = false): DayParts {
  // Before Nov 7, 2026 the warm-up was inside the workout, so a full workout then included it.
  const oldWarmup = logs.some((l) => l.status === 'done' && l.items?.some((i) => i.plan.section === 'warmup'));
  return {
    rest: logs.length ? logs.some((l) => l.status === 'rest') : restDay,
    warmup: !!extras?.warmup || oldWarmup,
    main: logs.some(keeps),
    evening: !!extras?.evening,
  };
}

/** The parts that count toward the streak: warm-up and workout, or just the walk. */
export const streakParts = (p: DayParts) => (p.rest ? 1 : 2);
/** How many of them are done. */
export const streakPartsDone = (p: DayParts) => (p.rest ? Number(p.main) : Number(p.warmup) + Number(p.main));
export const dayKept = (p: DayParts) => streakPartsDone(p) === streakParts(p);

/** James's own correction (Nov 10): "as of `through`, I'd kept `count` days in a row".
 *  Days the app didn't see (or saw wrongly) before then don't matter. */
export interface StreakFix {
  through: string;
  count: number;
}

/** A correction shipped in an update and applied once. Skipped if James has since set a later one himself. */
export const seededFix = (saved: StreakFix | null, seed: StreakFix): StreakFix =>
  saved && saved.through > seed.through ? saved : seed;

/** "2026-11-07" + 1 → "2026-11-08", in local calendar days. */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(y, m - 1, d + n);
  const pad = (v: number) => String(v).padStart(2, '0');
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
}

export function streak(
  sessions: Log[],
  daily: Record<string, DayExtras>,
  today: string,
  fix?: StreakFix | null,
  todayRest = false,
): Streak {
  const byDate = new Map<string, Log[]>();
  for (const s of sessions) {
    const list = byDate.get(s.date);
    if (list) list.push(s);
    else byDate.set(s.date, [s]);
  }
  const kept = new Set<string>();
  for (const [date, logs] of byDate) if (dayKept(dayParts(logs, daily[date]))) kept.add(date);
  if (fix) kept.add(fix.through); // James's count includes that day, so it was kept

  const todayKept = kept.has(today);
  let current = 0;
  for (let d = todayKept ? today : addDays(today, -1); ; d = addDays(d, -1)) {
    if (fix && d === fix.through) {
      current += fix.count; // James's own count up to that day; nothing before it matters
      break;
    }
    if (!kept.has(d)) break;
    current++;
  }
  let best = 0;
  let run = 0;
  let prev = '';
  const days = new Set(kept);
  if (fix) days.add(fix.through);
  for (const d of [...days].sort()) {
    run = fix && d === fix.through ? fix.count : prev && addDays(prev, 1) === d ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  return { current, best, todayKept, today: dayParts(byDate.get(today) ?? [], daily[today], todayRest) };
}
