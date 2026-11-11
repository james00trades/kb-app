// The streak: calendar days in a row that were "kept".
// James's rule (Nov 10, 2026): a day is kept when both of these are done:
//   1. the warm-up (workout days) or wake-up routine (rest days),
//   2. a full workout (every move done) or the rest day marked done.
// The evening holds are still part of the day but no longer count toward the streak
// (until Nov 10 they did). A workout ended early, a skipped day, or a missing part breaks it.
// Today doesn't break it until the day is over.
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

export function dayParts(logs: Log[], extras: DayExtras | undefined): DayParts {
  // Before Nov 7, 2026 the warm-up was inside the workout, so a full workout then included it.
  const oldWarmup = logs.some((l) => l.status === 'done' && l.items?.some((i) => i.plan.section === 'warmup'));
  return {
    warmup: !!(extras?.warmup || extras?.morning) || oldWarmup,
    main: logs.some(keeps),
    evening: !!extras?.evening,
  };
}

/** How many of the day's streak parts (warm-up, workout) are done: 0, 1 or 2. */
export const streakPartsDone = (p: DayParts) => Number(p.warmup) + Number(p.main);
export const STREAK_PARTS = 2;

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

export function streak(sessions: Log[], daily: Record<string, DayExtras>, today: string, fix?: StreakFix | null): Streak {
  const byDate = new Map<string, Log[]>();
  for (const s of sessions) {
    const list = byDate.get(s.date);
    if (list) list.push(s);
    else byDate.set(s.date, [s]);
  }
  const kept = new Set<string>();
  for (const [date, logs] of byDate) if (streakPartsDone(dayParts(logs, daily[date])) === STREAK_PARTS) kept.add(date);
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
  return { current, best, todayKept, today: dayParts(byDate.get(today) ?? [], daily[today]) };
}
