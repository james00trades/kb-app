import { addRound, adjust, clock, fmtClock, secondsLeft, skipPhase, skipRest, stopTimer, timer, togglePause } from '../lib/timer';
import type { ComponentChildren } from 'preact';
import { breathProgress, type TPhase } from '../lib/timer';
import { Icon } from './common';

/** A ring that fills over the whole breathwork, with one marker per breath cycle, evenly spaced;
 *  each marker sits where the ring will be when that cycle ends, and fills in when it does. */
function BreathRing({ pct, sets, done, children }: { pct: number; sets: number; done: number; children: ComponentChildren }) {
  const R = 46;
  const marks = Array.from({ length: sets }, (_, k) => {
    const a = ((k + 1) / sets) * 2 * Math.PI - Math.PI / 2;
    return { x: 50 + R * Math.cos(a), y: 50 + R * Math.sin(a), on: k < done };
  });
  return (
    <div class="breath-stage">
      <svg class="breath-ring" viewBox="0 0 100 100" role="img" aria-label={`${done} of ${sets} breath sets done`}>
        <circle class="ring-track" cx="50" cy="50" r={R} />
        <circle class="ring-fill" cx="50" cy="50" r={R} pathLength={1} transform="rotate(-90 50 50)" style={{ strokeDashoffset: 1 - pct }} />
        {marks.map((m, k) => (
          <circle key={k} class={`ring-mark ${m.on ? 'on' : ''}`} cx={m.x} cy={m.y} r={m.on ? 3.4 : 2.6} />
        ))}
      </svg>
      {children}
    </div>
  );
}

/** Breathing circle: grows on "in", shrinks on "out", stays put on "hold". */
function breathClass(phases: TPhase[], index: number): string {
  const kind = phases[index].kind;
  if (kind === 'in' || kind === 'out') return kind;
  if (kind === 'hold') return phases[index - 1]?.kind === 'in' ? 'hold-big' : 'hold-small';
  return 'hold-small';
}

/** Slim rest bar above the tab bar. */
export function RestBar() {
  const t = timer.value;
  if (!t || t.spec.view !== 'bar') return null;
  const left = secondsLeft(t, clock.value);
  const total = t.spec.phases[t.index].seconds;
  const pct = t.done ? 0 : Math.min(100, (left / total) * 100);
  return (
    <div class="rest-bar">
      <div class="rest-fill" style={{ width: `${pct}%` }} />
      <div class="rest-content">
        <span class="rest-label">{t.done ? 'Go!' : 'Rest'}</span>
        <span class="rest-time">{fmtClock(left)}</span>
        <button class="rest-btn" onClick={() => adjust(-15)}>−15</button>
        <button class="rest-btn" onClick={() => adjust(15)}>+15</button>
        <button class="rest-btn" onClick={skipRest}>Skip</button>
      </div>
    </div>
  );
}

/** Full-screen timer for holds, intervals, EMOM, AMRAP and breathwork. */
export function TimerOverlay() {
  const t = timer.value;
  if (!t || t.spec.view !== 'full') return null;
  const ph = t.spec.phases[t.index];
  const left = secondsLeft(t, clock.value);
  const paused = t.pausedLeft !== null;
  const isBreath = t.spec.mode === 'breath';
  const totalLeft =
    left + t.spec.phases.slice(t.index + 1).reduce((sum, p) => sum + p.seconds, 0);
  const workPhases = t.spec.phases.filter((p) => p.kind === 'work');
  const workIndex = t.spec.phases.slice(0, t.index + 1).filter((p) => p.kind === 'work').length;

  return (
    <div class={`timer-overlay kind-${t.done ? 'done' : ph.kind}`}>
      <header class="timer-head">
        <span class="timer-title">{t.spec.title}</span>
        <button class="icon-btn" aria-label="Close timer" onClick={stopTimer}>
          <Icon name="close" />
        </button>
      </header>

      {t.done ? (
        <div class="timer-body">
          <div class="timer-phase">Done</div>
          {isBreath ? (
            <BreathRing {...breathProgress(t, 0)}>
              <div class="breath-wrap">
                <Icon name="check" size={96} />
              </div>
            </BreathRing>
          ) : (
            <div class="timer-big">
              <Icon name="check" size={96} />
            </div>
          )}
          {t.spec.mode === 'amrap' && <div class="timer-sub">{t.rounds} rounds</div>}
          <button class="big-btn primary" onClick={stopTimer}>Close</button>
        </div>
      ) : (
        <div class="timer-body">
          <div class="timer-phase">{ph.label}</div>
          {isBreath ? (
            <BreathRing {...breathProgress(t, left)}>
              <div class="breath-wrap">
                <div
                  key={t.index}
                  class={`breath-circle b-${breathClass(t.spec.phases, t.index)}`}
                  style={{ animationDuration: `${ph.seconds}s`, animationPlayState: paused ? 'paused' : 'running' }}
                />
                <div class="breath-count">{Math.ceil(left)}</div>
              </div>
            </BreathRing>
          ) : (
            <div class="timer-big">{fmtClock(left)}</div>
          )}
          {ph.sub && <div class="timer-sub">{ph.sub}</div>}
          {/* Breathwork shows the ring instead of the total time left (James, Nov 9) */}
          {!isBreath && (
            <div class="timer-meta muted">
              {t.spec.mode === 'interval' && workPhases.length > 1 && `${workIndex} of ${workPhases.length} · `}
              {fmtClock(totalLeft)} left
            </div>
          )}

          {t.spec.mode === 'amrap' && ph.kind === 'work' && (
            <button class="amrap-btn" onClick={addRound}>
              <span class="amrap-count">{t.rounds}</span>
              <span>Tap: +1 round</span>
            </button>
          )}

          <div class="timer-controls">
            <button class="round-btn big" aria-label={paused ? 'Resume' : 'Pause'} onClick={togglePause}>
              <Icon name={paused ? 'play' : 'pause'} size={32} />
            </button>
            <button class="pill-btn" onClick={skipPhase}>
              Next ›
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
