import { useState } from 'preact/hooks';
import { routineAt, type RoutinePick } from '../engine/engine';
import type { Phase } from '../engine/schema';
import { chooseRoutine, data, draft, engine, routinePicker } from '../lib/store';
import { Icon } from './common';

/** Pick a difficulty level, then one of its 4-week routines (James, Nov 20, 2026). Shown the first time
 *  the app opens on a new phone, and from Settings or the Today screen. */
export function RoutinePicker() {
  const welcome = !!routinePicker.value?.welcome;
  const now = routineAt(data, engine.value.routine as RoutinePick | undefined, engine.value.pointer.cycle);
  const [level, setLevel] = useState<number | null>(welcome ? null : now.routine.level);
  const busy = !!draft.value;

  const pick = (r: Phase) => {
    if (busy) return;
    const same = !welcome && r.id === now.routine.id;
    const msg = welcome
      ? `Start with ${r.name}? Your first workout is its Week 1, Day A.`
      : same
        ? `Start ${r.name} over from Week 1, Day A? Your history stays.`
        : `Switch to ${r.name}? Your next workout becomes its Week 1, Day A. Your history stays.`;
    if (confirm(msg)) {
      void chooseRoutine(r.id);
      window.scrollTo(0, 0);
    }
  };

  const levelInfo = level === null ? undefined : data.plan.levels.find((l) => l.n === level);
  return (
    <div class="screen picker">
      <header class="picker-head">
        {level !== null && (welcome || data.plan.levels.length > 1) ? (
          <button class="back-btn" onClick={() => setLevel(null)}>
            <Icon name="back" size={18} /> Levels
          </button>
        ) : (
          <span />
        )}
        {!welcome && (
          <button class="pill-btn" onClick={() => (routinePicker.value = null)}>
            Close
          </button>
        )}
      </header>

      {level === null ? (
        <>
          <h1>{welcome ? 'Where do you want to start?' : 'Pick a level'}</h1>
          <p class="muted">
            Each level has several 4-week routines. When one ends, the next one at the same level starts by itself, so you can stay
            at a level as long as you like.{welcome ? ' You can change this any time in Settings.' : ''}
          </p>
          <div class="level-list">
            {data.plan.levels.map((l) => {
              const count = data.routines.filter((r) => r.level === l.n).length;
              const current = !welcome && l.n === now.routine.level;
              return (
                <button key={l.n} class={`card level-card ${current ? 'current' : ''}`} onClick={() => setLevel(l.n)}>
                  <span class="level-num">{l.n}</span>
                  <span class="level-text">
                    <span class="day-title">
                      {l.name}
                      {current && <span class="tag-now">Now</span>}
                    </span>
                    <span class="muted small">{l.summary}</span>
                    <span class="muted small">
                      {count} routine{count === 1 ? '' : 's'}
                      {l.n === 1 ? ' · start here if you’re new to kettlebells' : ''}
                    </span>
                  </span>
                  <Icon name="next" size={18} />
                </button>
              );
            })}
          </div>
        </>
      ) : (
        <>
          <div class="eyebrow">Level {level}</div>
          <h1>{levelInfo?.name}</h1>
          <p class="muted">{levelInfo?.summary}.</p>
          {busy && <div class="note warn">Finish or discard today’s workout first, then pick a routine.</div>}
          {!welcome && now.routine.level === level && (
            <p class="muted small">
              Now: {now.routine.name}, Week {now.week} of {now.routine.weeks[1]}.
            </p>
          )}
          <div class="routine-list">
            {data.routines
              .filter((r) => r.level === level)
              .map((r) => {
                const current = !welcome && r.id === now.routine.id;
                return (
                  <section key={r.id} class={`card routine-card ${current ? 'current' : ''}`}>
                    <div class="day-title">
                      {r.name}
                      {current && <span class="tag-now">Now</span>}
                    </div>
                    <p class="small">{r.summary}</p>
                    <ul class="routine-days muted small">
                      {(['A', 'B', 'C'] as const).map((d) => (
                        <li key={d}>
                          <b>Day {d}</b> {r.days[d].title}: {(r.days[d].items ?? []).map((it) => it.label ?? data.moveById.get(it.move ?? '')?.name ?? it.id).join(' · ')}
                        </li>
                      ))}
                    </ul>
                    <div class="muted small">
                      {r.weeks[1]} weeks · {r.minutes ?? ''}
                      {r.effort ? ` · effort ${r.effort}` : ''}
                    </div>
                    <button class={`big-btn ${current ? '' : 'primary'}`} disabled={busy} onClick={() => pick(r)}>
                      {welcome ? `Start ${r.name}` : current ? 'Start over at Week 1' : `Switch to ${r.name}`}
                    </button>
                  </section>
                );
              })}
          </div>
        </>
      )}
    </div>
  );
}
