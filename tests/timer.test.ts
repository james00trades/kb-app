import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { say } from '../src/lib/sound';
import {
  adjust, breathProgress, breathSpec, holdSpec, intervalSpec, restSpec, roundsSpec, secondsLeft, skipPhase, skipRest, startTimer, stopTimer, timer, togglePause,
} from '../src/lib/timer';

vi.mock('../src/lib/sound', () => ({ beep: vi.fn(), say: vi.fn(), stopVoice: vi.fn() }));

beforeEach(() => {
  vi.mocked(say).mockClear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 10, 4, 7, 0, 0));
});
afterEach(() => {
  stopTimer();
  vi.useRealTimers();
});

const label = () => timer.value!.spec.phases[timer.value!.index].label;

describe('timer engine', () => {
  it('rest timer counts down and finishes', () => {
    const done = vi.fn();
    startTimer(restSpec(60, done));
    vi.advanceTimersByTime(30_000);
    expect(Math.round(secondsLeft(timer.value!, Date.now()))).toBe(30);
    vi.advanceTimersByTime(30_500);
    expect(done).toHaveBeenCalledOnce();
    expect(timer.value!.done).toBe(true);
  });

  it('+15 / −15 changes the time left', () => {
    startTimer(restSpec(60));
    adjust(15);
    expect(Math.round(secondsLeft(timer.value!, Date.now()))).toBe(75);
    adjust(-30);
    expect(Math.round(secondsLeft(timer.value!, Date.now()))).toBe(45);
  });

  it('per-side hold runs get ready → left → switch → right', () => {
    const done = vi.fn();
    startTimer(holdSpec('Carry', 30, true, done));
    expect(label()).toBe('Get ready');
    vi.advanceTimersByTime(5_200);
    expect(label()).toBe('Left side');
    vi.advanceTimersByTime(30_000);
    expect(label()).toBe('Switch sides');
    vi.advanceTimersByTime(5_000);
    expect(label()).toBe('Right side');
    vi.advanceTimersByTime(30_000);
    expect(done).toHaveBeenCalledOnce();
  });

  it('"Next" skips one phase at a time', () => {
    const done = vi.fn();
    startTimer(holdSpec('Carry', 30, true, done));
    skipPhase();
    expect(label()).toBe('Left side');
    skipPhase();
    expect(label()).toBe('Switch sides');
    skipPhase();
    expect(label()).toBe('Right side');
    skipPhase();
    expect(done).toHaveBeenCalledOnce();
  });

  it('pause freezes the clock', () => {
    startTimer(restSpec(60));
    vi.advanceTimersByTime(10_000);
    togglePause();
    vi.advanceTimersByTime(60_000);
    expect(Math.round(secondsLeft(timer.value!, Date.now()))).toBe(50);
    expect(timer.value!.done).toBe(false);
    togglePause();
    vi.advanceTimersByTime(50_500);
    expect(timer.value!.done).toBe(true);
  });

  it('catches up after the app was in the background', () => {
    const done = vi.fn();
    startTimer(intervalSpec('Morning', [{ label: 'A', seconds: 30 }, { label: 'B', seconds: 30 }], 0, done));
    // Phone sleeps: no ticks for 50 s, then one tick
    vi.setSystemTime(Date.now() + 50_000);
    vi.advanceTimersByTime(200);
    expect(label()).toBe('B');
  });

  it('breathwork ring: one marker per full box cycle, filling as each cycle ends (James, Nov 9)', () => {
    const box = breathSpec({ name: 'Box', steps: [['in', 4], ['hold', 4], ['out', 4], ['hold', 4]] }, 4);
    startTimer(box);
    const now = () => breathProgress(timer.value!, secondsLeft(timer.value!, Date.now()));
    expect(now()).toEqual({ pct: 0, sets: 15, done: 0 }); // 4 min of 16 s cycles; "Get ready" not counted
    vi.advanceTimersByTime(5_000 + 15_800); // most of the way through the first cycle
    expect(now().done).toBe(0);
    vi.advanceTimersByTime(400); // first cycle complete
    expect(now().done).toBe(1);
    expect(now().pct).toBeCloseTo(1 / 15, 2);
    vi.advanceTimersByTime(224_000);
    expect(timer.value!.done).toBe(true);
    expect(now()).toEqual({ pct: 1, sets: 15, done: 15 });
  });

  it('breathwork ring counts 3-step cycles for 4-7-8', () => {
    const s = breathSpec({ name: '4-7-8', steps: [['in', 4], ['hold', 7], ['out', 8]] }, 4);
    expect(s.cycle).toBe(3);
    expect(s.phases.length - 1).toBe(13 * 3);
  });

  it('breathwork fills the minutes with whole breaths', () => {
    const spec = breathSpec({ name: 'Box', steps: [['in', 4], ['hold', 4], ['out', 4], ['hold', 4]] }, 4);
    const total = spec.phases.slice(1).reduce((s, p) => s + p.seconds, 0);
    expect(total).toBe(240);
  });
});

describe('"Get ready" near the end of a rest (James, Nov 9)', () => {
  const spoken = () => vi.mocked(say).mock.calls.map(([w]) => w).filter(Boolean);

  it('a rest longer than 20 s says "Get ready" at 10 s left, then 3, 2, 1, go', () => {
    startTimer(restSpec(60));
    vi.advanceTimersByTime(49_000);
    expect(spoken()).toEqual([]);
    vi.advanceTimersByTime(1_200); // 10 s left
    expect(spoken()).toEqual(['Get ready']);
    vi.advanceTimersByTime(10_000);
    expect(spoken()).toEqual(['Get ready', '3', '2', '1', 'Go']);
  });

  it('a rest of 20 s or less only counts 3, 2, 1', () => {
    startTimer(restSpec(20));
    vi.advanceTimersByTime(20_500);
    expect(spoken()).toEqual(['3', '2', '1', 'Go']);
  });

  it('works on the rests in the rounds timer too', () => {
    startTimer(roundsSpec('Rounds', 2, 30, 30));
    vi.advanceTimersByTime(5_000 + 30_000 + 20_200); // into the rest, 10 s left
    expect(spoken().slice(-2)).toEqual(['Rest', 'Get ready']);
  });

  it('says it once, even with ticks five times a second', () => {
    startTimer(restSpec(45));
    vi.advanceTimersByTime(36_000);
    expect(spoken().filter((w) => w === 'Get ready')).toHaveLength(1);
  });
});

describe('timed set after rest (James, Nov 7)', () => {
  const hold = (prep: boolean) => holdSpec('Carry', 30, true, undefined, true, prep);

  it('starts the timed set as soon as the rest ends, without a second get-ready', () => {
    const rested = vi.fn();
    startTimer(restSpec(60, rested, (skipped) => hold(skipped)));
    vi.advanceTimersByTime(60_300);
    expect(rested).toHaveBeenCalledOnce();
    expect(timer.value!.spec.title).toBe('Carry');
    expect(timer.value!.done).toBe(false);
    expect(label()).toBe('Left side');
  });

  it('Skip on the rest bar starts it right away, with the 5 s get-ready', () => {
    startTimer(restSpec(60, undefined, (skipped) => hold(skipped)));
    vi.advanceTimersByTime(10_000);
    skipRest();
    expect(timer.value!.spec.title).toBe('Carry');
    expect(label()).toBe('Get ready');
  });

  it('a rest with nothing timed next just ends as before', () => {
    startTimer(restSpec(60, undefined, () => null));
    vi.advanceTimersByTime(60_300);
    expect(timer.value!.done).toBe(true);
    startTimer(restSpec(60, undefined, () => null));
    skipRest();
    expect(timer.value).toBeNull();
  });
});
