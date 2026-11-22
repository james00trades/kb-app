import { describe, expect, it } from 'vitest';
import { loadData } from '../src/engine/data';
import { initialState, upcoming, type SessionStatus } from '../src/engine/engine';
import { addDays, heatReached, seededFix, seedApplies, streak, streakHeat, streakParts, streakPartsDone, type DayExtras } from '../src/engine/streak';

describe('the flame heats up with the streak (James, Nov 19)', () => {
  it('steps at 2, 4, 6, 8, 10, 12, 14 and 16 days, and stays at the top after 16', () => {
    const at = (days: number[]) => days.map(streakHeat);
    expect(at([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 40])).toEqual([0, 0, 2, 2, 4, 4, 6, 6, 8, 8, 10, 10, 12, 12, 14, 14, 16, 16, 16]);
  });
});

const log = (date: string, status: SessionStatus) => ({ date, status });
const TODAY = '2026-11-07';

/** Kept days: warm-up and the workout done. The evening holds don't count (Nov 10). */
function full(dates: string[], status: SessionStatus = 'done') {
  const sessions = dates.map((d) => log(d, status));
  const daily: Record<string, DayExtras> = Object.fromEntries(dates.map((d) => [d, { date: d, warmup: 1 }]));
  return { sessions, daily };
}

describe('streak', () => {
  it('starts at zero', () => {
    expect(streak([], {}, TODAY)).toMatchObject({ current: 0, best: 0, todayKept: false });
  });

  it('counts days where the warm-up and full workout were done, including today', () => {
    const { sessions, daily } = full(['2026-11-05', '2026-11-06', TODAY]);
    expect(streak(sessions, daily, TODAY)).toMatchObject({ current: 3, best: 3, todayKept: true });
  });

  it('a walking day counts with just Done: no warm-up needed (James, Nov 14)', () => {
    expect(streak([log(TODAY, 'rest')], {}, TODAY).todayKept).toBe(true);
    const { sessions, daily } = full(['2026-11-05', '2026-11-06']);
    expect(streak([...sessions, log(TODAY, 'rest')], daily, TODAY)).toMatchObject({ current: 3, todayKept: true });
  });

  it('stretching never counts: the wake-up and evening holds alone keep nothing (James, Nov 14)', () => {
    const stretched = { [TODAY]: { date: TODAY, morning: 1, evening: 1 } };
    expect(streak([], stretched, TODAY, null, true).todayKept).toBe(false);
    expect(streak([], stretched, TODAY).todayKept).toBe(false);
    // On a workout day the wake-up isn't the warm-up
    expect(streak([log(TODAY, 'done')], stretched, TODAY).todayKept).toBe(false);
  });

  it('a walking day shows 0 of 1 done until it is marked done', () => {
    const s = streak([], {}, TODAY, null, true);
    expect(s.today).toEqual({ rest: true, warmup: false, main: false, evening: false });
    expect(streakParts(s.today)).toBe(1);
    expect(streakPartsDone(s.today)).toBe(0);
  });

  it("finishing a workout keeps workout-day rules, even when tomorrow's plan is a walking day", () => {
    // After Day C the plan moves on to the walking day, but today was still a workout day.
    const s = streak([log(TODAY, 'done')], {}, TODAY, null, true);
    expect(s.today.rest).toBe(false);
    expect(s.todayKept).toBe(false); // the warm-up is still needed
    expect(streakPartsDone(s.today)).toBe(1);
    expect(streakParts(s.today)).toBe(2);
  });

  it('the evening holds no longer count toward it (James, Nov 10)', () => {
    expect(streak([log(TODAY, 'done')], { [TODAY]: { date: TODAY, warmup: 1 } }, TODAY).todayKept).toBe(true);
  });

  it('a missing warm-up or workout means the day does not count', () => {
    const noWarmup = { [TODAY]: { date: TODAY, evening: 1 } };
    expect(streak([log(TODAY, 'done')], noWarmup, TODAY).todayKept).toBe(false);
    expect(streak([], { [TODAY]: { date: TODAY, warmup: 1, evening: 1 } }, TODAY).todayKept).toBe(false);
  });

  it('reports what is done today', () => {
    const s = streak([log(TODAY, 'done')], { [TODAY]: { date: TODAY, warmup: 1 } }, TODAY);
    expect(s.today).toEqual({ rest: false, warmup: true, main: true, evening: false });
  });

  it('does not break before today is over', () => {
    const { sessions, daily } = full(['2026-11-05', '2026-11-06']);
    expect(streak(sessions, daily, TODAY)).toMatchObject({ current: 2, best: 2, todayKept: false });
  });

  it('a missed day resets it, but the best run is remembered', () => {
    const { sessions, daily } = full(['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-05']);
    const s = streak(sessions, daily, TODAY);
    expect(s.current).toBe(0);
    expect(s.best).toBe(3);
  });

  it('a workout ended early or a skipped day does not count (James: full workouts only)', () => {
    const { daily } = full(['2026-11-05', '2026-11-06', TODAY]);
    expect(streak([log('2026-11-06', 'done'), log(TODAY, 'partial')], daily, TODAY)).toMatchObject({ current: 1, todayKept: false });
    expect(streak([log('2026-11-05', 'done'), log('2026-11-06', 'skipped')], daily, TODAY).current).toBe(0);
  });

  it('workouts from before the warm-up became its own part still count their warm-up', () => {
    const old = { date: '2026-11-06', status: 'done' as const, items: [{ plan: { section: 'warmup' } }] };
    const daily = { '2026-11-06': { date: '2026-11-06', evening: 1 } };
    expect(streak([old], daily, TODAY).current).toBe(1);
  });

  it('counts across month ends', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    const { sessions, daily } = full(['2026-10-31', '2026-11-01']);
    expect(streak(sessions, daily, '2026-11-01').current).toBe(2);
  });
});

describe("James's own streak count (Nov 10)", () => {
  const YESTERDAY = addDays(TODAY, -1);
  const done = full([TODAY]);

  it('4 days before today: shows 4, then 5 once today is done', () => {
    const fix = { through: YESTERDAY, count: 4 };
    expect(streak([], {}, TODAY, fix)).toMatchObject({ current: 4, best: 4, todayKept: false });
    expect(streak(done.sessions, done.daily, TODAY, fix)).toMatchObject({ current: 5, best: 5, todayKept: true });
  });

  it('replaces whatever the app had recorded up to that day', () => {
    const { sessions, daily } = full(['2026-10-30', '2026-10-31', '2026-11-04', '2026-11-05', YESTERDAY, TODAY]);
    expect(streak(sessions, daily, TODAY, { through: YESTERDAY, count: 4 }).current).toBe(5);
    expect(streak(sessions, daily, TODAY, { through: YESTERDAY, count: 0 }).current).toBe(1);
  });

  it('keeps counting on later days, and a missed day still breaks it', () => {
    const fix = { through: '2026-11-04', count: 4 };
    const { sessions, daily } = full(['2026-11-05', '2026-11-06']);
    expect(streak(sessions, daily, TODAY, fix)).toMatchObject({ current: 6, best: 6 });
    const missed = full(['2026-11-06']);
    expect(streak(missed.sessions, missed.daily, TODAY, fix)).toMatchObject({ current: 1, best: 4 });
  });

  it('a count through today shows today as done, even if the app missed part of it', () => {
    const fix = { through: TODAY, count: 5 };
    expect(streak([], {}, TODAY, fix)).toMatchObject({ current: 5, best: 5, todayKept: true });
    expect(streak(done.sessions, done.daily, TODAY, fix)).toMatchObject({ current: 5, best: 5, todayKept: true });
    // The next day: 5 while it's pending, 6 once it's done.
    const next = addDays(TODAY, 1);
    expect(streak([], {}, next, fix)).toMatchObject({ current: 5, todayKept: false });
    const nextDone = full([next]);
    expect(streak(nextDone.sessions, nextDone.daily, next, fix)).toMatchObject({ current: 6, best: 6 });
  });

  it('the count set in an update replaces an older one, not one James set later', () => {
    const seed = { through: '2026-11-10', count: 5 };
    expect(seededFix(null, seed)).toBe(seed);
    expect(seededFix({ through: '2026-11-09', count: 4 }, seed)).toBe(seed);
    const later = { through: '2026-11-11', count: 6 };
    expect(seededFix(later, seed)).toBe(later);
  });

  it("only a phone in use by Nov 10 gets James's count; a new install starts clean (Nov 20)", () => {
    const seed = { through: '2026-11-10', count: 5 };
    expect(seedApplies(undefined, seed)).toBe(false);
    expect(seedApplies(new Date(2026, 10, 6, 9, 0).getTime(), seed)).toBe(true);
    expect(seedApplies(new Date(2026, 10, 10, 23, 0).getTime(), seed)).toBe(true);
    expect(seedApplies(new Date(2026, 10, 11, 0, 5).getTime(), seed)).toBe(false);
    expect(seedApplies(new Date(2026, 10, 20, 12, 0).getTime(), seed)).toBe(false);
  });
});

describe('next 7 days', () => {
  const data = loadData();

  it('follows the rotation from the current day and rolls into the next week', () => {
    const state = { ...initialState(), pointer: { cycle: 0, slot: 4 } }; // Week 1, second Day B
    const days = upcoming(data, state, 7);
    expect(days.map((s) => s.day)).toEqual(['B', 'C', 'REST', 'A', 'B', 'C', 'A']);
    expect(days.map((s) => s.week)).toEqual([1, 1, 1, 2, 2, 2, 2]);
  });

  it('starts with the same session the Workout tab would start', () => {
    const [first] = upcoming(data, initialState(), 1);
    expect(first.day).toBe('A');
    expect(first.week).toBe(1);
  });
});

describe('sparks off the flame (James, Nov 19)', () => {
  it('none below 6 days; campfire embers that grow in number and speed up to 12; welding sparks at 14', async () => {
    const { SPARKS, sparkVars } = await import('../src/ui/Sparks');
    expect(Object.keys(SPARKS).map(Number)).toEqual([6, 8, 10, 12, 14, 16]);
    expect(SPARKS[16]).toEqual(SPARKS[14]); // 16 keeps the welding sparks and adds the supernova
    expect([6, 8, 10, 12].map((h) => SPARKS[h].kind)).toEqual(['ember', 'ember', 'ember', 'ember']);
    expect(SPARKS[14].kind).toBe('weld');
    const counts = [6, 8, 10, 12, 14].map((h) => SPARKS[h].count);
    expect(counts).toEqual([...counts].sort((a, b) => a - b));
    expect(SPARKS[14].dur[1]).toBeLessThan(SPARKS[12].dur[0]); // welding is the fastest
    expect(SPARKS[12].dur[1]).toBeLessThan(SPARKS[10].dur[1]); // 12 is the most intense campfire
    // Each spark gets its own path, and the same one every time
    const a = sparkVars(SPARKS[14], 3);
    expect(a).toEqual(sparkVars(SPARKS[14], 3));
    expect(a).not.toEqual(sparkVars(SPARKS[14], 4));
    expect(parseFloat(a['--dy'])).toBeLessThan(0); // shoots upward first
  });

  it('a new streak level fills the screen only when the flame steps up (Nov 22)', () => {
    expect(heatReached(1, 2)).toBe(2); // first flame
    expect(heatReached(7, 8)).toBe(8);
    expect(heatReached(15, 16)).toBe(16); // the supernova
    expect(heatReached(8, 9)).toBe(0); // same step
    expect(heatReached(16, 17)).toBe(0); // nothing past the top step
    expect(heatReached(8, 8)).toBe(0); // nothing new today
    expect(heatReached(9, 4)).toBe(0); // a lower count (e.g. a correction) never celebrates
    expect(heatReached(0, 1)).toBe(0);
  });
});
