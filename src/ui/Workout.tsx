import { useEffect, useRef, useState } from 'preact/hooks';
import {
  chosen, completeNext, isItemComplete, isTimedMove, lastAndBest, moveTime, repsDone, restAfter, restKey, setCap, setChoice, stampTimes, timesFor,
  undoSet as undoSetAt, workOf, type DraftItem, type SessionDraft,
} from '../engine/engine';
import type { Bell } from '../engine/schema';
import { discardWorkout, draft, finishWorkout, moveSheet, sessions, setMoveRest, settings, updateDraft, workoutOpen } from '../lib/store';
import { breathSpec, fmtClock, holdSpec, intervalSpec, restSpec, startTimer, stopTimer, timer, type TimerSpec } from '../lib/timer';
import { Icon, Sheet, Stepper, bellShort, fmtSeconds, fmtTime, prescText, sideText, upText } from './common';

const SECTION_TITLES = { warmup: 'Warm-up', main: 'Main work', cooldown: 'Breathwork' } as const;

const nextIncomplete = (d: SessionDraft, from: number): number => {
  for (let k = 1; k <= d.items.length; k++) {
    const i = (from + k) % d.items.length;
    if (!isItemComplete(d.items[i])) return i;
  }
  return -1;
};

const firstIncomplete = (d: SessionDraft) => d.items.findIndex((it) => !isItemComplete(it));

function patchItem(i: number, fn: (it: DraftItem) => DraftItem) {
  return updateDraft((d) => ({ ...d, items: d.items.map((it, k) => (k === i ? fn(it) : it)) }));
}

export function Workout() {
  const d = draft.value!;
  const [active, setActive] = useState(() => Math.max(0, firstIncomplete(d)));
  const activeRef = useRef(active);
  activeRef.current = active;
  const [finishing, setFinishing] = useState(false);
  const [, setNow] = useState(Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Keep the active move in view
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      if (active === 0) {
        window.scrollTo(0, 0);
        return;
      }
    }
    document.querySelector('.item-card.active')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [active]);

  // Each move's clock (James, Nov 19): it starts when the move is the one open and no rest is running;
  // a move left before any of it was done starts over the next time.
  const resting = !!timer.value && timer.value.spec.mode === 'rest' && !timer.value.done;
  useEffect(() => {
    const cur = draft.value;
    if (!cur) return;
    const now = Date.now();
    const needs = cur.items.some((it, k) =>
      k === active
        ? !resting && isTimedMove(it) && it.startedAt === undefined && !isItemComplete(it)
        : it.startedAt !== undefined && !it.sets.some((x) => x.done),
    );
    if (!needs) return;
    void updateDraft((dd) => ({
      ...dd,
      items: dd.items.map((it, k) => {
        if (k === active) return !resting && isTimedMove(it) && it.startedAt === undefined && !isItemComplete(it) ? { ...it, startedAt: now } : it;
        return it.startedAt !== undefined && !it.sets.some((x) => x.done) ? { ...it, startedAt: undefined } : it;
      }),
    }));
  }, [active, resting]);

  /** Mark the current set of item i done, then rest and move along. */
  const completeSet = async (i: number) => {
    const before = draft.value;
    if (!before) return;
    const it = before.items[i];
    if (!it.sets.some((x) => !x.done)) return;
    await patchItem(i, (x) => stampTimes(completeNext(x), Date.now()));
    const after = draft.value!;
    const itemDone = isItemComplete(after.items[i]);
    const workoutDone = after.items.every(isItemComplete);
    const rest = restAfter(it, settings.value.restByMove);
    const n = itemDone ? nextIncomplete(after, i) : i;
    if (!workoutDone && rest > 0) {
      // A ±15 tap on this rest is remembered for this move (James, Nov 13)
      const key = restKey(it);
      const spec = restSpec(rest, undefined, (skipped) => timedSetAfterRest(n, skipped));
      startTimer({ ...spec, onAdjust: (s) => void setMoveRest(key, s) });
    }
    if (itemDone && n >= 0) setActive(n);
  };

  /** When the rest ends and the next set is a timed one, start its timer (James, Nov 7). */
  const timedSetAfterRest = (n: number, skipped: boolean): TimerSpec | null => {
    const x = n >= 0 ? draft.value?.items[n] : undefined;
    // Only if that move is still the one open (not if another move was opened during the rest)
    if (!x || x.plan.kind !== 'time' || activeRef.current !== n) return null;
    const set = x.sets.find((s) => !s.done);
    if (!set) return null;
    return holdSpec(chosen(x).name, set.actual, x.plan.perSide, () => completeSet(n), true, skipped);
  };

  const doneCount = d.items.filter(isItemComplete).length;
  const allDone = doneCount === d.items.length;
  const elapsed = (Date.now() - d.startedAt) / 1000;
  let lastSection = '';

  return (
    <div class="screen workout">
      <header class="workout-head">
        <button
          class="back-btn"
          aria-label="Back to today. The workout stays in progress."
          onClick={() => {
            workoutOpen.value = false;
            window.scrollTo(0, 0);
          }}
        >
          <Icon name="back" size={22} />
          Back
        </button>
        <div class="workout-head-text">
          <div class="eyebrow">
            Week {d.session.week} · Day {d.session.day} <span class="workout-clock">{fmtClock(elapsed)}</span>
          </div>
          <div class="workout-title">{d.session.title}</div>
        </div>
        <button class="pill-btn" onClick={() => setFinishing(true)}>
          Finish
        </button>
      </header>

      {d.items.map((it, i) => {
        const heading = it.plan.section !== lastSection ? SECTION_TITLES[it.plan.section] : null;
        lastSection = it.plan.section;
        return (
          <div key={it.plan.itemId}>
            {heading && <h3 class="section-title">{heading}</h3>}
            {i === active ? (
              <ActiveItem it={it} i={i} onComplete={() => completeSet(i)} />
            ) : (
              <CollapsedItem it={it} onOpen={() => setActive(i)} />
            )}
          </div>
        );
      })}

      <button class={`big-btn ${allDone ? 'primary' : ''}`} onClick={() => setFinishing(true)}>
        {allDone ? 'Finish workout' : `Finish early (${doneCount} of ${d.items.length} moves done)`}
      </button>

      {finishing && <FinishSheet onClose={() => setFinishing(false)} />}
    </div>
  );
}

function CollapsedItem({ it, onOpen }: { it: DraftItem; onOpen: () => void }) {
  const p = chosen(it);
  const complete = isItemComplete(it);
  const took = moveTime(it);
  return (
    <button class={`item-card ${complete ? 'complete' : ''}`} onClick={onOpen}>
      <div class="item-top">
        <span class="item-name">
          {complete && !it.skipped && <Icon name="check" size={18} />} {p.name}
        </span>
        <span class="dots">
          {it.skipped ? (
            <span class="muted small">skipped</span>
          ) : took !== undefined ? (
            <span class="muted small move-time-done">{fmtTime(took)}</span>
          ) : p.total !== undefined ? (
            <span class="muted small">
              {repsDone(it.sets)}/{p.total}
            </span>
          ) : (
            it.sets.map((s, k) => <i key={k} class={s.done ? 'dot done' : 'dot'} />)
          )}
        </span>
      </div>
      <div class="item-presc">{prescText(it.plan, { ...p, bell: it.bell })}</div>
    </button>
  );
}

function ActiveItem({ it, i, onComplete }: { it: DraftItem; i: number; onComplete: () => void }) {
  const p = chosen(it);
  const cur = it.sets.findIndex((s) => !s.done);
  const complete = cur < 0;
  const bells: Bell[] = [];
  if (it.bell !== null) {
    if (it.plan.stay.planBell === 'BW' || it.plan.up?.planBell === 'BW' || it.bell === 'BW') bells.push('BW');
    for (const b of settings.value.bells) bells.push(b);
    if (typeof it.bell === 'number' && !bells.includes(it.bell)) bells.push(it.bell);
  }

  const setActual = (v: number) =>
    patchItem(i, (x) => ({ ...x, sets: x.sets.map((s, k) => (k === cur ? { ...s, actual: v } : s)) }));

  const undoSet = (k: number) => patchItem(i, (x) => stampTimes(undoSetAt(x, k), Date.now()));
  const total = p.total;

  const setBell = (b: Bell) =>
    patchItem(i, (x) => ({ ...x, bell: b, sets: x.sets.map((s) => (s.done ? s : { ...s, bell: b })) }));

  return (
    <section class="item-card active">
      <div class="item-top">
        <button class="item-name big" disabled={!p.move} onClick={() => p.move && (moveSheet.value = p.move)}>
          {p.name} {p.move && <Icon name="info" size={18} />}
        </button>
        {isTimedMove(it) && <MoveClock it={it} />}
      </div>
      <div class="item-presc">{prescText(it.plan, { ...p, bell: it.bell }, false)}</div>
      {isTimedMove(it) && p.move && <PastTimes it={it} move={p.move} />}
      {p.fromLast && (
        <div class="muted small">
          {total !== undefined
            ? 'Total set from what you did last time'
            : p.moreSets
              ? 'Set from what you did last time: 10 reps a set at most, so extra sets instead'
              : 'Set from what you did last time'}
        </div>
      )}
      {p.notes && <div class="muted small">{p.notes}</div>}

      {it.plan.up && (
        <div class="offer">
          <div class="small">
            <Icon name="up" size={14} /> Last time went to plan. Move up: {upText(it.plan)}?
          </div>
          <div class="seg">
            <button class={it.choice === 'up' ? 'selected' : ''} onClick={() => patchItem(i, (x) => setChoice(x, 'up'))}>
              Move up
            </button>
            <button class={it.choice === 'stay' ? 'selected' : ''} onClick={() => patchItem(i, (x) => setChoice(x, 'stay'))}>
              Stay
            </button>
          </div>
        </div>
      )}

      {bells.length > 0 && (
        <div class="bells">
          {bells.map((b) => (
            <button key={String(b)} class={`bell-chip ${it.bell === b ? 'selected' : ''}`} onClick={() => setBell(b)}>
              {bellShort(b)}
            </button>
          ))}
        </div>
      )}

      {total !== undefined && !it.skipped && <TotalLine it={it} total={total} />}

      {it.plan.kind !== 'breath' && it.plan.kind !== 'routine' && (total !== undefined ? it.sets.some((s) => s.done) : it.sets.length > 1 || complete) && (
        <div class="set-chips">
          {it.sets.map((s, k) => (total !== undefined && !s.done ? null :
            <button
              key={k}
              class={`set-chip ${s.done ? 'done' : ''} ${k === cur ? 'current' : ''}`}
              onClick={() => s.done && undoSet(k)}
              aria-label={s.done ? `Set ${k + 1} done, tap to undo` : `Set ${k + 1}`}
            >
              <span class="set-n">Set {k + 1}</span>
              <span class="set-v">
                {s.done ? `✓ ${s.actual}` : s.actual}
                {it.plan.kind === 'time' ? 's' : ''}
              </span>
            </button>
          ))}
        </div>
      )}

      {!complete && it.plan.kind === 'reps' && total !== undefined && cur >= 0 && (
        <>
          <Stepper value={it.sets[cur].actual} onChange={setActual} min={1} max={setCap(it)} unit={sideText(it.plan) ? ' / side' : ''} />
          <div class="muted small center">Reps before you rest: aim for 5–10, 10 at most.</div>
          <button class="big-btn primary" onClick={onComplete}>
            {it.sets[cur].actual + repsDone(it.sets) >= total ? (
              <>
                <Icon name="check" /> Done
              </>
            ) : (
              'Rest'
            )}
          </button>
        </>
      )}

      {!complete && it.plan.kind === 'reps' && total === undefined && (
        <>
          <Stepper value={it.sets[cur].actual} onChange={setActual} unit={sideText(it.plan) ? ' / side' : ''} />
          <button class="big-btn primary" onClick={onComplete}>
            <Icon name="check" /> {it.sets.length > 1 ? `Set ${cur + 1} of ${it.sets.length} done` : 'Done'}
          </button>
        </>
      )}

      {!complete && it.plan.kind === 'time' && (
        <>
          <Stepper value={it.sets[cur].actual} onChange={setActual} step={5} min={5} unit=" s" />
          <button
            class="big-btn primary"
            onClick={() => startTimer(holdSpec(p.name, it.sets[cur].actual, it.plan.perSide, onComplete, true))}
          >
            <Icon name="play" /> Start {it.sets[cur].actual} s{it.plan.perSide ? ', left then right' : ''}
          </button>
          {timer.value?.spec.then && !timer.value.done && (
            <div class="muted small center">Starts by itself when the rest ends.</div>
          )}
          <button class="link-btn" onClick={onComplete}>
            Mark set done without the timer
          </button>
        </>
      )}

      {!complete && it.plan.kind === 'breath' && it.plan.breath && (
        <>
          <button
            class="big-btn primary"
            onClick={() => startTimer(breathSpec(it.plan.breath!.pattern, it.plan.breath!.minutes, onComplete, true))}
          >
            <Icon name="play" /> Start {it.plan.breath.pattern.name} · {it.plan.breath.minutes} min
          </button>
          <button class="link-btn" onClick={onComplete}>
            Mark done
          </button>
        </>
      )}

      {!complete && it.plan.kind === 'routine' && it.plan.routine && (
        <>
          <button
            class="big-btn primary"
            onClick={() => {
              const r = it.plan.routine!;
              startTimer(intervalSpec(r.title, r.stations, r.transition, onComplete, true));
            }}
          >
            <Icon name="play" /> {it.plan.section === 'warmup' ? 'Start warm-up' : 'Start'} · {fmtSeconds(it.plan.routine.seconds)}
          </button>
          <button class="link-btn" onClick={onComplete}>
            Mark done without the timer
          </button>
        </>
      )}

      {!complete && !it.skipped && (
        <button class="link-btn muted" onClick={() => patchItem(i, (x) => ({ ...x, skipped: true }))}>
          Skip this move
        </button>
      )}
      {it.skipped && (
        <button class="link-btn" onClick={() => patchItem(i, (x) => ({ ...x, skipped: false }))}>
          Skipped. Tap to un-skip
        </button>
      )}
      {complete && !it.skipped && it.sets.length > 0 && (it.plan.kind === 'routine' || it.plan.kind === 'breath') && (
        <button class="link-btn" onClick={() => undoSet(0)}>
          Done. Tap to undo.
        </button>
      )}
      {complete && !it.skipped && it.plan.kind !== 'routine' && it.plan.kind !== 'breath' && (
        <div class="good-text small">Done. Tap a set above to undo it.</div>
      )}
    </section>
  );
}

/** The move's own clock, top right of its card: running, waiting for the rest, or its final time (Nov 19). */
function MoveClock({ it }: { it: DraftItem }) {
  const took = moveTime(it);
  if (took !== undefined) return <span class="move-clock done">{fmtTime(took)}</span>;
  if (it.startedAt === undefined) return <span class="move-clock waiting">after rest</span>;
  return <span class="move-clock">{fmtTime(Date.now() - it.startedAt)}</span>;
}

/** "Last 2:05 · Best 1:50" for the same work (bell and total); "New best" when today beats it. */
function PastTimes({ it, move }: { it: DraftItem; move: string }) {
  const { last, best, lastAny } = lastAndBest(timesFor(sessions.value, move), workOf(it));
  const took = moveTime(it);
  if (took !== undefined && best && took < best.ms) return <div class="good-text small">New best! Was {fmtTime(best.ms)}</div>;
  if (took !== undefined && !lastAny) return <div class="muted small">First time on the clock</div>;
  if (last && best) {
    return (
      <div class="muted small">
        Last {fmtTime(last.ms)}
        {best !== last && ` · Best ${fmtTime(best.ms)}`}
      </div>
    );
  }
  if (lastAny) return <div class="muted small">Last {fmtTime(lastAny.ms)} for {lastAny.work}</div>;
  return null;
}

/** "16 of 24 · 8 to go" (Nov 19). */
function TotalLine({ it, total }: { it: DraftItem; total: number }) {
  const done = repsDone(it.sets);
  const left = Math.max(0, total - done);
  return (
    <div class="total-line">
      <b>{done}</b> of {total}
      {it.plan.perSide ? ` ${it.plan.sideLabel ?? 'per side'}` : ''}
      {left > 0 ? <span class="muted"> · {left} to go</span> : <span class="good-text"> · total done</span>}
    </div>
  );
}

function FinishSheet({ onClose }: { onClose: () => void }) {
  const [effort, setEffort] = useState<number | null>(null);
  const [pain, setPain] = useState<boolean | null>(null);
  const d = draft.value!;
  const left = d.items.filter((it) => !isItemComplete(it) || it.skipped).length;

  return (
    <Sheet onClose={onClose} title="Finish workout">
      {left > 0 && (
        <div class="note">
          {left} move{left > 1 ? 's' : ''} not finished. They'll be logged as not done.
        </div>
      )}
      <h3>How hard was it? (1–10)</h3>
      <div class="effort-grid">
        {Array.from({ length: 10 }, (_, k) => k + 1).map((n) => (
          <button key={n} class={`choice ${effort === n ? 'selected' : ''}`} onClick={() => setEffort(n)}>
            {n}
          </button>
        ))}
      </div>
      <h3>Joint pain, or soreness lasting 2+ days?</h3>
      <div class="seg big">
        <button class={pain === false ? 'selected' : ''} onClick={() => setPain(false)}>
          No
        </button>
        <button class={pain === true ? 'selected warn' : ''} onClick={() => setPain(true)}>
          Yes
        </button>
      </div>
      {pain && <p class="small muted">The plan will hold volume (no increases) until a session ends pain-free.</p>}
      <button
        class="big-btn primary"
        disabled={effort === null || pain === null}
        onClick={async () => {
          if (timer.value) stopTimer();
          await finishWorkout(effort!, pain!);
          window.scrollTo(0, 0);
        }}
      >
        Save workout
      </button>
      <button
        class="link-btn danger"
        onClick={() => {
          if (confirm('Throw away this workout? Nothing from it will be saved.')) {
            if (timer.value) stopTimer();
            void discardWorkout();
          }
        }}
      >
        Discard this workout
      </button>
    </Sheet>
  );
}
