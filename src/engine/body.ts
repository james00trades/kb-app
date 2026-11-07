// Weight trend and body check-in timing. Pure functions (no storage), so they're easy to test.
import { addDays } from './streak';

/** Photos every week, waist every 4 weeks (planning, Nov 2026). */
export const PHOTO_EVERY_DAYS = 7;
export const WAIST_EVERY_DAYS = 28;

export interface WeightPoint {
  date: string;
  weight: number;
  /** Average of the weigh-ins in the 7 days ending on this date. Smooths out day-to-day water swings. */
  avg: number;
}

export interface WeightSummary {
  first: WeightPoint;
  latest: WeightPoint;
  /** Change in the 7-day average over about a week (null until there's a week of data). */
  weekChange: number | null;
  /** Change from the first weigh-in to the current 7-day average (null with one weigh-in). */
  sinceStart: number | null;
}

export const round1 = (n: number) => Math.round(n * 10) / 10;

/** Whole days from date a to date b (both YYYY-MM-DD). */
export function daysBetween(a: string, b: string): number {
  const t = (s: string) => {
    const [y, m, d] = s.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((t(b) - t(a)) / 86_400_000);
}

/** Every logged weight, oldest first, with its 7-day average. */
export function weightTrend(entries: { date: string; weight?: number; waist?: number }[]): WeightPoint[] {
  const pts = entries
    .filter((e): e is { date: string; weight: number } => typeof e.weight === 'number')
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return pts.map((p) => {
    const from = addDays(p.date, -6);
    const win = pts.filter((q) => q.date >= from && q.date <= p.date);
    return { date: p.date, weight: p.weight, avg: round1(win.reduce((s, q) => s + q.weight, 0) / win.length) };
  });
}

export function weightSummary(trend: WeightPoint[]): WeightSummary | null {
  if (!trend.length) return null;
  const first = trend[0];
  const latest = trend[trend.length - 1];
  // The most recent average from 7–13 days before the latest weigh-in
  const weekAgo = [...trend].reverse().find((p) => {
    const gap = daysBetween(p.date, latest.date);
    return gap >= 7 && gap <= 13;
  });
  return {
    first,
    latest,
    weekChange: weekAgo ? round1(latest.avg - weekAgo.avg) : null,
    sinceStart: trend.length > 1 ? round1(latest.avg - first.weight) : null,
  };
}

export interface BodyDue {
  weight: boolean;
  photos: boolean;
  waist: boolean;
  lastPhoto: string | null;
  lastWaist: string | null;
}

/** What's due today: today's weight, photos once a week, waist once every 4 weeks. */
export function bodyDue(
  entries: { date: string; weight?: number; waist?: number }[],
  photoDates: string[],
  today: string,
): BodyDue {
  const latest = (dates: string[]) => (dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : null);
  const lastPhoto = latest(photoDates);
  const lastWaist = latest(entries.filter((e) => typeof e.waist === 'number').map((e) => e.date));
  return {
    weight: !entries.some((e) => e.date === today && typeof e.weight === 'number'),
    photos: !lastPhoto || daysBetween(lastPhoto, today) >= PHOTO_EVERY_DAYS,
    waist: !lastWaist || daysBetween(lastWaist, today) >= WAIST_EVERY_DAYS,
    lastPhoto,
    lastWaist,
  };
}
