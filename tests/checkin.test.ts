import { describe, expect, it } from 'vitest';
import { weightTrend } from '../src/engine/body';
import type { SessionLog } from '../src/engine/engine';
import { buildReport, checkInDue, costOf, moveHistory, pickPhotoDates, type CheckIn, type ReportInput } from '../src/lib/checkin';
import { requestCheckIn } from '../src/lib/checkin-api';

const TODAY = '2026-11-14';

/** A Day A workout with one main move (deadlift) at the given sets × reps and bell. */
const session = (
  date: string,
  extra: Partial<SessionLog> = {},
  dl: { sets: number; target: number; bell: number } = { sets: 3, target: 8, bell: 45 },
): SessionLog =>
  ({
    id: date,
    date,
    startedAt: new Date(`${date}T07:00:00`).getTime(),
    endedAt: new Date(`${date}T07:34:00`).getTime(),
    status: 'done',
    session: { day: 'A', title: 'Hinge and press', week: 2 } as SessionLog['session'],
    items: [
      {
        plan: {
          itemId: 'a-deadlift',
          section: 'main',
          kind: 'reps',
          perSide: false,
          stay: { name: 'Deadlift', sets: dl.sets, target: dl.target, bell: dl.bell },
        },
        choice: 'stay',
        bell: dl.bell,
        skipped: false,
        sets: Array.from({ length: dl.sets }, (_, i) => ({
          target: dl.target,
          actual: dl.target + (i === dl.sets - 1 ? 1 : 0),
          done: true,
          bell: dl.bell,
        })),
      },
    ] as unknown as SessionLog['items'],
    kbReps: 25,
    effort: 6,
    pain: false,
    ...extra,
  }) as SessionLog;

const result = {
  headline: 'Training is steady; the scale has stalled.',
  bigPicture: 'Down 5 lb in 7 weeks, a realistic pace, but flat for the last 2 weeks.',
  patterns: ['5 full workouts this week', '7-day average flat at 232'],
  lever: 'diet',
  leverWhy: 'You are training consistently at the target effort.',
  actions: ['Protein at every meal'],
  photos: '',
  dataGaps: '',
};

const program = {
  name: 'Month 1: Wake up',
  week: 2,
  effort: '5–6 out of 10',
  rotation: ['A', 'B', 'C', 'REST'],
  phases: [{ name: 'Month 1: Wake up', weeks: [1, 4] as [number, number], effort: '5–6 out of 10' }],
};

function input(over: Partial<ReportInput> = {}): ReportInput {
  const weights = weightTrend([
    { date: '2026-11-07', weight: 233 },
    { date: '2026-11-14', weight: 232 },
  ]);
  return {
    today: TODAY,
    program,
    about: '',
    note: 'Ate out twice',
    streak: { current: 3, best: 5 },
    weights,
    body: [{ date: '2026-11-01', waist: 42.5 }],
    sessions: [session('2026-11-12'), session('2026-11-13', { status: 'partial', pain: true, effort: 8 })],
    daily: { '2026-11-12': { date: '2026-11-12', warmup: 1, evening: 1 } },
    checkins: [],
    photoSets: [{ label: 'Latest photo set', date: '2026-11-14', poses: ['front', 'side'] }],
    ...over,
  };
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

describe('check-in report', () => {
  it('lays out the program, recent weight, waist, training and photos', () => {
    const text = buildReport(input());
    expect(text).toContain('Program: now in "Month 1: Wake up", program week 2, target effort 5–6 out of 10');
    expect(text).toContain('Program phases loaded so far: Month 1: Wake up (weeks 1–4, effort 5–6 out of 10)');
    expect(text).toContain("User's note this week: Ate out twice");
    expect(text).toContain('About the user: not given');
    expect(text).toContain('- 2026-11-07: 233.0 / 233.0');
    expect(text).toContain('- 2026-11-14: 232.0 / 232.0');
    expect(text).toContain('2026-11-12 · Day A (Hinge and press) · done (every move) · effort 6/10 · 34 min');
    expect(text).toContain('warm-up done · evening holds done');
    expect(text).toContain('Deadlift 3/3 sets [8, 8, 9] planned 3×8 @45 lb');
    expect(text).toContain('ended early · effort 8/10 · 34 min · 25 kettlebell reps · JOINT PAIN reported');
    expect(text).toContain('Latest photo set (2026-11-14): front, side');
  });

  it('sums up the whole journey from day one, week by week (James, Nov 7)', () => {
    // 10 weeks: weight 240 → ~231, a waist each month, one workout a week with the deadlift moving up
    const days = Array.from({ length: 70 }, (_, i) => iso(new Date(2026, 8, 6 + i)));
    const weights = weightTrend(days.map((date, i) => ({ date, weight: Math.round((240 - i * 0.13) * 10) / 10 })));
    const sessions = days
      .filter((_, i) => i % 7 === 3)
      .map((d, k) => session(d, {}, { sets: k < 4 ? 2 : 3, target: 8, bell: 45 }));
    const text = buildReport(
      input({
        today: days[69],
        weights,
        sessions,
        body: [
          { date: days[0], waist: 44 },
          { date: days[35], waist: 43 },
        ],
      }),
    );
    expect(days[69]).toBe(TODAY);
    expect(text).toContain(`Journey started: ${days[0]} (week 10 of the journey).`);
    expect(text).toContain(`- Weight: first weigh-in 240.0 lb (${days[0]})`);
    expect(text).toContain(`- Waist: 44 in (${days[0]}) → 43 in (${days[35]}).`);
    expect(text).toMatch(/- Week 1 \(2026-09-06 to 2026-09-12\): weight avg 239\.6 \(7 weigh-ins/);
    expect(text).toMatch(/- Week 10 \(2026-11-08 to 2026-11-14\): weight avg/);
    expect(text).toContain(`- Deadlift: ${days[3]} 2×8 @45 lb → ${days[31]} 3×8 @45 lb (last done ${days[66]})`);
    // Only the last 4 weeks of weigh-ins are listed one by one
    expect(text).not.toContain(`- ${days[0]}: 240.0`);
    expect(text).toContain(`- ${days[69]}: `);
  });

  it('includes every earlier check-in, oldest first, so Claude can see what worked', () => {
    const c = (date: string, lever: string, note?: string) => ({ date, note, result: { ...result, lever } }) as CheckIn;
    const text = buildReport(input({ checkins: [c('2026-11-07', 'diet', 'busy week'), c('2026-10-31', 'intensity')] }));
    expect(text.indexOf('- 2026-10-31: lever "intensity"')).toBeGreaterThan(-1);
    expect(text.indexOf('- 2026-10-31: lever "intensity"')).toBeLessThan(text.indexOf('- 2026-11-07: lever "diet"'));
    expect(text).toContain("(user's note that week: busy week)");
    expect(buildReport(input())).toContain('- none: this is the first check-in');
  });

  it('says plainly when there is no data yet', () => {
    const text = buildReport(input({ weights: [], body: [], sessions: [], photoSets: [], note: '' }));
    expect(text).toContain('- Weight: no weigh-ins yet');
    expect(text).toContain('- no weigh-ins');
    expect(text).toContain('- nothing logged');
    expect(text).toContain('- none yet');
    expect(text).toContain("User's note this week: none");
  });

  it('the copy for pasting into a chat with Claude (James, Nov 10): rest setting, workout-only minutes, no pictures', () => {
    const text = buildReport(input({ photoSets: [], copyPhotoDates: ['2026-11-07', '2026-11-14'], restSeconds: 45 }));
    expect(text.split('\n')[0]).toBe(`Stats copied from the kettlebell app on ${TODAY}.`);
    expect(text).toContain('Rest between sets: 45 s');
    expect(text).toContain('warm-up not included');
    expect(text).toContain('- not included in this copy. Days with photos: 2026-11-07, 2026-11-14');
    expect(text).not.toContain('attached above');
  });
});

describe('long-run helpers', () => {
  it('lists each move only when its prescription changed', () => {
    const lines = moveHistory([
      session('2026-10-01', {}, { sets: 2, target: 8, bell: 45 }),
      session('2026-10-08', {}, { sets: 2, target: 8, bell: 45 }),
      session('2026-10-15', {}, { sets: 3, target: 8, bell: 45 }),
      session('2026-10-22', { status: 'skipped' }, { sets: 3, target: 10, bell: 45 }),
    ]);
    expect(lines).toEqual(['- Deadlift: 2026-10-01 2×8 @45 lb → 2026-10-15 3×8 @45 lb (last done 2026-10-15)']);
  });

  it('sends photos from the start, about a month ago, and now', () => {
    const dates = ['2026-09-06', '2026-09-13', '2026-10-11', '2026-10-18', '2026-11-08', '2026-11-14'];
    expect(pickPhotoDates(dates, TODAY).map((p) => p.date)).toEqual(['2026-09-06', '2026-10-18', '2026-11-14']);
    expect(pickPhotoDates(['2026-11-14'], TODAY)).toEqual([{ label: 'Photo set', date: '2026-11-14' }]);
    expect(pickPhotoDates([], TODAY)).toEqual([]);
  });
});

describe('check-in timing and cost', () => {
  it('is due a week after the last one', () => {
    expect(checkInDue([], TODAY)).toBe(true);
    expect(checkInDue([{ date: '2026-11-08' } as CheckIn], TODAY)).toBe(false);
    expect(checkInDue([{ date: '2026-11-07' } as CheckIn], TODAY)).toBe(true);
  });

  it('estimates the cost from the token counts', () => {
    expect(costOf({ input: 20_000, output: 3_000 })).toBeCloseTo(0.14);
  });
});

describe('asking Claude', () => {
  function fakeFetch(status: number, body: unknown, seen: { url?: string; headers?: Headers; body?: any }) {
    return (async (url: RequestInfo | URL, init?: RequestInit) => {
      seen.url = String(url);
      seen.headers = new Headers(init?.headers);
      seen.body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
  }

  const message = (text: string, stop = 'end_turn') => ({
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5-5',
    content: [{ type: 'text', text }],
    stop_reason: stop,
    usage: { input_tokens: 9000, output_tokens: 1200 },
  });

  it('sends the report and photos with the right settings, and reads the answer', async () => {
    const seen: { url?: string; headers?: Headers; body?: any } = {};
    const r = await requestCheckIn({
      apiKey: 'sk-test',
      report: 'REPORT',
      images: [{ label: 'Latest photo set (2026-11-14), front:', data: 'AAAA' }],
      fetchImpl: fakeFetch(200, message(JSON.stringify(result)), seen),
    });
    expect(seen.url).toMatch(/\/v1\/messages/);
    expect(seen.headers!.get('authorization')).toBe('Bearer sk-test'); // SDK 1.x sends the key this way
    expect(seen.headers!.get('anthropic-beta')).toContain('server-side-fallback-2026-07-01');
    expect(seen.headers!.get('anthropic-dangerous-direct-browser-access')).toBe('true');
    expect(seen.body).toMatchObject({ model: 'claude-opus-5-5', fallbacks: 'default' });
    expect(seen.body.output_config.format.type).toBe('json_schema');
    expect(seen.body.output_config.effort).toBe('high');
    const content = seen.body.messages[0].content;
    expect(content[1]).toMatchObject({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' } });
    expect(content.at(-1)).toEqual({ type: 'text', text: 'REPORT' });
    expect(r.result.lever).toBe('diet');
    expect(r.usage).toEqual({ input: 9000, output: 1200 });
  });

  it('explains a bad key in plain words', async () => {
    const err = { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } };
    await expect(
      requestCheckIn({ apiKey: 'bad', report: 'R', images: [], fetchImpl: fakeFetch(401, err, {}) }),
    ).rejects.toThrow(/API key didn't work/);
  });

  it('explains when the monthly credits are used up', async () => {
    const err = {
      type: 'error',
      error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API.' },
    };
    await expect(
      requestCheckIn({ apiKey: 'k', report: 'R', images: [], fetchImpl: fakeFetch(400, err, {}) }),
    ).rejects.toThrow(/credits are used up/);
  });

  it('rejects an answer that does not match the format', async () => {
    await expect(
      requestCheckIn({ apiKey: 'k', report: 'R', images: [], fetchImpl: fakeFetch(200, message('{"nope":1}'), {}) }),
    ).rejects.toThrow(/couldn't be read/);
  });
});
