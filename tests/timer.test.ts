import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  adjust, breathSpec, holdSpec, intervalSpec, restSpec, secondsLeft, skipPhase, skipRest, startTimer, stopTimer, timer, togglePause,
} from '../src/lib/timer';

beforeEach(() => {
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

  it('breathwork fills the minutes with whole breaths', () => {
    const spec = breathSpec({ name: 'Box', steps: [['in', 4], ['hold', 4], ['out', 4], ['hold', 4]] }, 4);
    const total = spec.phases.slice(1).reduce((s, p) => s + p.seconds, 0);
    expect(total).toBe(240);
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
