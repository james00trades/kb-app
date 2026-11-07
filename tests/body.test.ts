import { describe, expect, it } from 'vitest';
import { bodyDue, daysBetween, weightSummary, weightTrend } from '../src/engine/body';

const TODAY = '2026-11-07';

describe('weight trend', () => {
  it('averages the weigh-ins from the 7 days ending on each date', () => {
    const t = weightTrend([
      { date: '2026-11-03', weight: 232 },
      { date: '2026-11-01', weight: 234 },
      { date: '2026-11-02', weight: 233 },
      { date: '2026-11-09', weight: 230 }, // 11-03 is in its window, 11-01/02 are not
      { date: '2026-11-05', waist: 40 }, // waist only: ignored
    ]);
    expect(t.map((p) => p.date)).toEqual(['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-09']);
    expect(t.map((p) => p.avg)).toEqual([234, 233.5, 233, 231]);
  });

  it('sums up the change over a week and since the start', () => {
    const days = ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-08', '2026-11-09', '2026-11-10'];
    const weights = [234, 234, 234, 232, 232, 232];
    const s = weightSummary(weightTrend(days.map((date, i) => ({ date, weight: weights[i] }))))!;
    expect(s.latest.avg).toBe(232);
    expect(s.weekChange).toBe(-2); // vs. the 7-day average on Nov 3
    expect(s.sinceStart).toBe(-2);
  });

  it('has no weekly change until there is a week of data', () => {
    const s = weightSummary(weightTrend([{ date: TODAY, weight: 230 }]))!;
    expect(s.weekChange).toBeNull();
    expect(s.sinceStart).toBeNull();
    expect(weightSummary([])).toBeNull();
  });
});

describe('body check-ins', () => {
  it('counts days across month ends', () => {
    expect(daysBetween('2026-10-31', '2026-11-07')).toBe(7);
    expect(daysBetween('2026-11-07', '2026-11-07')).toBe(0);
  });

  it('everything is due on day one', () => {
    expect(bodyDue([], [], TODAY)).toMatchObject({ weight: true, photos: true, waist: true });
  });

  it("weight is due until today's is logged", () => {
    expect(bodyDue([{ date: TODAY, weight: 230 }], [], TODAY).weight).toBe(false);
    expect(bodyDue([{ date: '2026-11-06', weight: 230 }], [], TODAY).weight).toBe(true);
    expect(bodyDue([{ date: TODAY, waist: 40 }], [], TODAY).weight).toBe(true);
  });

  it('photos come due 7 days after the last ones', () => {
    expect(bodyDue([], ['2026-11-01'], TODAY).photos).toBe(false);
    expect(bodyDue([], ['2026-10-25', '2026-10-31'], TODAY)).toMatchObject({ photos: true, lastPhoto: '2026-10-31' });
  });

  it('waist comes due 4 weeks after the last measurement', () => {
    expect(bodyDue([{ date: '2026-10-10', waist: 40 }], [], TODAY).waist).toBe(true); // 28 days
    expect(bodyDue([{ date: '2026-10-11', waist: 40 }], [], TODAY)).toMatchObject({ waist: false, lastWaist: '2026-10-11' });
  });
});
