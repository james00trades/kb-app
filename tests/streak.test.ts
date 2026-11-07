import { describe, expect, it } from 'vitest';
import { loadData } from '../src/engine/data';
import { initialState, upcoming, type SessionStatus } from '../src/engine/engine';
import { addDays, streak, type DayExtras } from '../src/engine/streak';

const log = (date: string, status: SessionStatus) => ({ date, status });
const TODAY = '2026-11-07';

/** Days with all three parts done: warm-up, the workout (or rest day), and evening holds. */
function full(dates: string[], status: SessionStatus = 'done') {
  const sessions = dates.map((d) => log(d, status));
  const daily: Record<string, DayExtras> = Object.fromEntries(dates.map((d) => [d, { date: d, warmup: 1, evening: 1 }]));
  return { sessions, daily };
}

describe('streak', () => {
  it('starts at zero', () => {
    expect(streak([], {}, TODAY)).toMatchObject({ current: 0, best: 0, todayKept: false });
  });

  it('counts days where all three parts were done, including today', () => {
    const { sessions, daily } = full(['2026-11-05', '2026-11-06', TODAY]);
    expect(streak(sessions, daily, TODAY)).toMatchObject({ current: 3, best: 3, todayKept: true });
  });

  it('a rest day counts with the wake-up, Done, and evening holds', () => {
    const daily = { [TODAY]: { date: TODAY, morning: 1, evening: 1 } };
    expect(streak([log(TODAY, 'rest')], daily, TODAY).todayKept).toBe(true);
  });

  it('a missing part means the day does not count (James: all three)', () => {
    const noEvening = { [TODAY]: { date: TODAY, warmup: 1 } };
    const noWarmup = { [TODAY]: { date: TODAY, evening: 1 } };
    expect(streak([log(TODAY, 'done')], noEvening, TODAY).todayKept).toBe(false);
    expect(streak([log(TODAY, 'done')], noWarmup, TODAY).todayKept).toBe(false);
    expect(streak([], { [TODAY]: { date: TODAY, warmup: 1, evening: 1 } }, TODAY).todayKept).toBe(false);
  });

  it('reports what is done today', () => {
    const s = streak([log(TODAY, 'done')], { [TODAY]: { date: TODAY, warmup: 1 } }, TODAY);
    expect(s.today).toEqual({ warmup: true, main: true, evening: false });
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
