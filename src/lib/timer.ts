// One timer engine for every timer type. Driven by clock timestamps, not tick counting,
// so it stays accurate if the phone stutters or the app is briefly in the background.
import { signal } from '@preact/signals';
import { beep, say, stopVoice } from './sound';
import type { BreathPattern } from '../engine/schema';

export type PhaseKind = 'prep' | 'work' | 'rest' | 'switch' | 'in' | 'hold' | 'out';

export interface TPhase {
  label: string;
  seconds: number;
  kind: PhaseKind;
  /** Spoken at the start of the phase (defaults to the label). Empty string = silent. */
  say?: string;
  /** Small text under the label, e.g. "Next: Arm swings". */
  sub?: string;
}

export type TimerMode = 'rest' | 'hold' | 'interval' | 'emom' | 'amrap' | 'breath';

export interface TimerSpec {
  title: string;
  mode: TimerMode;
  phases: TPhase[];
  /** 'bar' = slim rest bar; 'full' = full-screen timer. */
  view: 'bar' | 'full';
  /** Close automatically when finished. */
  autoClose?: boolean;
  onDone?: () => void;
  /** A timer to start as soon as this one ends (a timed set after its rest).
   *  `skipped` is true when the rest was cut short with Skip. Return null for none. */
  then?: (skipped: boolean) => TimerSpec | null;
  /** Breathwork: phases in one full breath cycle (e.g. 4 for box: in, hold, out, hold). */
  cycle?: number;
}

export interface TimerState {
  spec: TimerSpec;
  index: number;
  endsAt: number;
  /** Seconds left when paused; null while running. */
  pausedLeft: number | null;
  startedAt: number;
  done: boolean;
  rounds: number;
}

export const timer = signal<TimerState | null>(null);
export const clock = signal(Date.now());

let interval: ReturnType<typeof setInterval> | null = null;
let lastCue = { index: -1, second: -1 };

const COUNTDOWN_KINDS: PhaseKind[] = ['prep', 'work', 'rest', 'switch'];

function startPhase(t: TimerState, index: number, at: number, announce: boolean): TimerState {
  const ph = t.spec.phases[index];
  if (announce) {
    const words = ph.say ?? ph.label;
    if (ph.kind === 'work') beep('go');
    else if (ph.kind === 'rest') beep('rest');
    else if (ph.kind === 'in' || ph.kind === 'out' || ph.kind === 'hold') beep('soft');
    say(words);
  }
  lastCue = { index, second: -1 };
  return { ...t, index, endsAt: at + ph.seconds * 1000 };
}

function finish(t: TimerState) {
  const next = t.spec.then?.(false);
  if (next) {
    // Straight into the next timer; its own "Go" replaces this one's end cue
    stopLoop();
    t.spec.onDone?.();
    startTimer(next);
    return;
  }
  beep('end');
  say(t.spec.mode === 'rest' ? 'Go' : 'Done');
  const done = { ...t, done: true, pausedLeft: 0 };
  timer.value = done;
  stopLoop();
  t.spec.onDone?.();
  if (t.spec.autoClose) {
    setTimeout(() => {
      if (timer.value === done) timer.value = null;
    }, 1200);
  }
}

function tick() {
  const now = Date.now();
  clock.value = now;
  let t = timer.value;
  if (!t || t.done || t.pausedLeft !== null) return;

  // Catch up on any phases that ended while we weren't looking
  let caughtUp = false;
  while (now >= t.endsAt) {
    const next = t.index + 1;
    if (next >= t.spec.phases.length) {
      finish(t);
      return;
    }
    const lateBy = now - t.endsAt;
    const announce = lateBy < 1500;
    t = startPhase(t, next, t.endsAt, announce);
    caughtUp = true;
  }
  if (caughtUp) timer.value = t;

  const ph = t.spec.phases[t.index];
  const left = Math.ceil((t.endsAt - now) / 1000);
  // "Get ready" with 10 s left on a rest longer than 20 s, then the usual 3-2-1 (James, Nov 9)
  if (ph.kind === 'rest' && ph.seconds > 20 && left === 10 && (lastCue.index !== t.index || lastCue.second !== left)) {
    lastCue = { index: t.index, second: left };
    say('Get ready');
  }
  if (COUNTDOWN_KINDS.includes(ph.kind) && ph.seconds >= 5 && left >= 1 && left <= 3) {
    if (lastCue.index !== t.index || lastCue.second !== left) {
      lastCue = { index: t.index, second: left };
      beep('tick');
      say(String(left));
    }
  }
}

function startLoop() {
  stopLoop();
  interval = setInterval(tick, 200);
}

function stopLoop() {
  if (interval) clearInterval(interval);
  interval = null;
}

export function startTimer(spec: TimerSpec) {
  const now = Date.now();
  const base: TimerState = { spec, index: 0, endsAt: now, pausedLeft: null, startedAt: now, done: false, rounds: 0 };
  timer.value = startPhase(base, 0, now, true);
  clock.value = now;
  startLoop();
}

export function stopTimer() {
  stopLoop();
  stopVoice();
  timer.value = null;
}

/** Rest bar "Skip": end the rest now. A timed set waiting on it starts right away. */
export function skipRest() {
  const t = timer.value;
  const next = t && !t.done ? t.spec.then?.(true) : null;
  if (next) startTimer(next);
  else stopTimer();
}

export function togglePause() {
  const t = timer.value;
  if (!t || t.done) return;
  const now = Date.now();
  if (t.pausedLeft === null) {
    timer.value = { ...t, pausedLeft: Math.max(0, t.endsAt - now) };
    stopLoop();
  } else {
    timer.value = { ...t, endsAt: now + t.pausedLeft, pausedLeft: null };
    startLoop();
  }
}

/** Add or remove time from the current phase (rest timer ±15 s). */
export function adjust(seconds: number) {
  const t = timer.value;
  if (!t || t.done) return;
  if (t.pausedLeft !== null) {
    timer.value = { ...t, pausedLeft: Math.max(1000, t.pausedLeft + seconds * 1000) };
  } else {
    timer.value = { ...t, endsAt: Math.max(Date.now() + 1000, t.endsAt + seconds * 1000) };
  }
}

/** Jump to the next phase (or finish). */
export function skipPhase() {
  const t = timer.value;
  if (!t || t.done) return;
  const next = t.index + 1;
  if (next >= t.spec.phases.length) {
    finish(t);
    return;
  }
  timer.value = startPhase({ ...t, pausedLeft: null }, next, Date.now(), true);
  startLoop();
}

export function addRound() {
  const t = timer.value;
  if (t) timer.value = { ...t, rounds: t.rounds + 1 };
}

export function secondsLeft(t: TimerState, now: number): number {
  if (t.pausedLeft !== null) return t.pausedLeft / 1000;
  return Math.max(0, (t.endsAt - now) / 1000);
}

/** Breathwork progress (James, Nov 9): how far through the whole session (0–1), how many full
 *  breath cycles there are (one in-hold-out-hold for box), and how many are done.
 *  "Get ready" counts as not started. */
export function breathProgress(t: TimerState, left: number): { pct: number; sets: number; done: number } {
  const phases = t.spec.phases.slice(1);
  const per = t.spec.cycle ?? phases.length;
  const sets = Math.max(1, Math.round(phases.length / per));
  const total = phases.reduce((s, p) => s + p.seconds, 0);
  const i = t.index - 1;
  if (t.done) return { pct: 1, sets, done: sets };
  if (i < 0) return { pct: 0, sets, done: 0 };
  const elapsed = phases.slice(0, i).reduce((s, p) => s + p.seconds, 0) + Math.max(0, phases[i].seconds - left);
  return { pct: Math.min(1, elapsed / total), sets, done: Math.floor(i / per) };
}

export function fmtClock(sec: number): string {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ---------- Timer recipes ----------

export function restSpec(seconds: number, onDone?: () => void, then?: TimerSpec['then']): TimerSpec {
  return {
    title: 'Rest',
    mode: 'rest',
    view: 'bar',
    autoClose: true,
    onDone,
    then,
    phases: [{ label: 'Rest', seconds, kind: 'rest', say: '' }],
  };
}

/** `prep: false` leaves out the 5 s "Get ready" (the rest before it already counted down). */
export function holdSpec(
  title: string,
  seconds: number,
  perSide: boolean,
  onDone?: () => void,
  autoClose = false,
  prep = true,
): TimerSpec {
  const phases: TPhase[] = prep ? [{ label: 'Get ready', seconds: 5, kind: 'prep', say: 'Get ready' }] : [];
  if (perSide) {
    phases.push({ label: 'Left side', seconds, kind: 'work', say: 'Left side, go', sub: 'Then right side' });
    phases.push({ label: 'Switch sides', seconds: 5, kind: 'switch', say: 'Switch sides' });
    phases.push({ label: 'Right side', seconds, kind: 'work', say: 'Right side, go' });
  } else {
    phases.push({ label: 'Hold', seconds, kind: 'work', say: 'Go' });
  }
  return { title, mode: 'hold', view: 'full', phases, onDone, autoClose };
}

export function intervalSpec(
  title: string,
  stations: { label: string; seconds: number }[],
  transition: number,
  onDone?: () => void,
  autoClose = false,
): TimerSpec {
  const phases: TPhase[] = [{ label: 'Get ready', seconds: 5, kind: 'prep', say: `Get ready. First, ${stations[0].label}`, sub: `First: ${stations[0].label}` }];
  stations.forEach((s, i) => {
    const next = stations[i + 1];
    phases.push({ label: s.label, seconds: s.seconds, kind: 'work', sub: next ? `Next: ${next.label}` : 'Last one' });
    if (next && transition > 0) {
      phases.push({ label: 'Change', seconds: transition, kind: 'switch', say: `Next, ${next.label}`, sub: `Next: ${next.label}` });
    }
  });
  return { title, mode: 'interval', view: 'full', phases, onDone, autoClose };
}

export function roundsSpec(title: string, rounds: number, work: number, rest: number, onDone?: () => void, autoClose = false): TimerSpec {
  const phases: TPhase[] = [{ label: 'Get ready', seconds: 5, kind: 'prep', say: 'Get ready' }];
  for (let i = 1; i <= rounds; i++) {
    phases.push({ label: `Round ${i} of ${rounds}`, seconds: work, kind: 'work', say: `Round ${i}` });
    if (i < rounds && rest > 0) phases.push({ label: 'Rest', seconds: rest, kind: 'rest', say: 'Rest', sub: `Next: round ${i + 1}` });
  }
  return { title, mode: 'interval', view: 'full', phases, onDone, autoClose };
}

export function emomSpec(minutes: number): TimerSpec {
  const phases: TPhase[] = [{ label: 'Get ready', seconds: 5, kind: 'prep', say: 'Get ready' }];
  for (let i = 1; i <= minutes; i++) phases.push({ label: `Minute ${i} of ${minutes}`, seconds: 60, kind: 'work', say: `Minute ${i}` });
  return { title: `EMOM ${minutes} min`, mode: 'emom', view: 'full', phases };
}

export function amrapSpec(minutes: number): TimerSpec {
  const phases: TPhase[] = [{ label: 'Get ready', seconds: 5, kind: 'prep', say: 'Get ready' }];
  phases.push({ label: 'As many rounds as possible', seconds: minutes * 60, kind: 'work', say: 'Go' });
  return { title: `AMRAP ${minutes} min`, mode: 'amrap', view: 'full', phases };
}

const BREATH_WORDS = { in: 'Breathe in', hold: 'Hold', out: 'Breathe out' } as const;

export function breathSpec(pattern: BreathPattern, minutes: number, onDone?: () => void, autoClose = false): TimerSpec {
  const phases: TPhase[] = [{ label: 'Get ready', seconds: 5, kind: 'prep', say: `${pattern.name}. Get ready` }];
  const cycle = pattern.steps.reduce((sum, [, s]) => sum + s, 0);
  const cycles = Math.max(1, Math.round((minutes * 60) / cycle));
  for (let c = 0; c < cycles; c++) {
    for (const [kind, seconds] of pattern.steps) {
      phases.push({ label: BREATH_WORDS[kind], seconds, kind, say: kind === 'hold' ? 'hold' : kind });
    }
  }
  return { title: pattern.name, mode: 'breath', view: 'full', phases, onDone, autoClose, cycle: pattern.steps.length };
}
