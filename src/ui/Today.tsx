import { useState } from 'preact/hooks';
import type { PlannedItem, PlannedSession } from '../engine/engine';
import { localDate } from '../engine/engine';
import {
  backOneDay, backupDue, daily, data, draft, markExtra, meta, moveSheet, passToday, startWorkout, tab, today, trainedToday,
} from '../lib/store';
import { intervalSpec, startTimer } from '../lib/timer';
import { Icon, prescText, upText } from './common';
import { Workout } from './Workout';

const SECTION_TITLES = { warmup: 'Warm-up', main: 'Main work', cooldown: 'Breathwork' } as const;

export function Today() {
  if (draft.value) return <Workout />;
  const s = today.value;
  return (
    <div class="screen">
      {backupDue.value && (
        <button class="note warn note-btn" onClick={() => (tab.value = 'settings')}>
          {meta.value.lastBackupAt
            ? "It's been a week since your last backup. Tap to back up now."
            : "You haven't backed up yet. Tap to save a copy to iCloud Drive."}
        </button>
      )}
      <header class="day-head">
        <div class="eyebrow">
          Week {s.week} · {s.day === 'REST' ? 'Rest day' : `Day ${s.day}`}
        </div>
        <h1>{s.title}</h1>
        <div class="muted">
          {s.phaseName}
          {s.day !== 'REST' && s.effort && ` · Effort ${s.effort}`}
          {s.day !== 'REST' && s.minutes && ` · ${s.minutes}`}
        </div>
      </header>

      {trainedToday.value && <div class="note good">✓ You trained today. This is your next session.</div>}
      {s.held && (
        <div class="note warn">
          Holding volume: joint pain was reported. The plan stays at Week {s.effectiveWeek} with no increases until a
          session ends pain-free.
        </div>
      )}
      {s.beyondPlan && (
        <div class="note">The plan data ends here, so the app repeats the final week until the next month is loaded.</div>
      )}

      {s.day === 'REST' ? <RestDay s={s} /> : <Preview s={s} />}

      <Extras />

      {s.finalWeekOfPhase && s.checks && s.day !== 'REST' && (
        <section class="card">
          <h3>End-of-month checks</h3>
          <p class="muted small">All must pass before moving on.</p>
          <ul class="checks">
            {s.checks.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </section>
      )}

      <div class="nudge-row">
        <button
          class="link-btn"
          onClick={() => {
            if (confirm(`Skip ${s.day === 'REST' ? 'the rest day' : `Day ${s.day}`}? It's logged as skipped and the rotation moves on.`)) void passToday('skipped');
          }}
        >
          Skip this day
        </button>
        {(s.cycle > 0 || s.slot > 0) && (
          <button class="link-btn" onClick={() => void backOneDay()}>
            Back one day
          </button>
        )}
      </div>
    </div>
  );
}

function ItemRow({ item }: { item: PlannedItem }) {
  const p = item.up ?? item.stay;
  const move = p.move;
  return (
    <div class="preview-row">
      <button class="preview-name" disabled={!move} onClick={() => move && (moveSheet.value = move)}>
        {p.name}
        {move && <Icon name="info" size={16} />}
      </button>
      <div class="preview-presc">{prescText(item, p)}</div>
      {item.up && (
        <div class="up-tag">
          <Icon name="up" size={14} /> Moving up: {upText(item)}
        </div>
      )}
    </div>
  );
}

function Preview({ s }: { s: PlannedSession }) {
  return (
    <>
      {(['warmup', 'main', 'cooldown'] as const).map((sec) => {
        const items = s.items.filter((i) => i.section === sec);
        if (!items.length) return null;
        return (
          <section class="card" key={sec}>
            <h3>{SECTION_TITLES[sec]}</h3>
            {items.map((i) => (
              <ItemRow key={i.itemId} item={i} />
            ))}
          </section>
        );
      })}
      <button
        class="big-btn primary sticky-cta"
        onClick={() => {
          window.scrollTo(0, 0);
          void startWorkout();
        }}
      >
        Start workout
      </button>
    </>
  );
}

function RestDay({ s }: { s: PlannedSession }) {
  const [walk, setWalk] = useState(false);
  const next = data.plan.rotation[(s.slot + 1) % data.plan.rotation.length];
  return (
    <section class="card">
      {s.notes && <p>{s.notes}</p>}
      <button class={`choice ${walk ? 'selected' : ''}`} onClick={() => setWalk(!walk)}>
        {walk ? '✓ ' : ''}Walked today
      </button>
      <button class="big-btn primary" onClick={() => void passToday('rest', walk)}>
        Done · next up Day {next}
      </button>
    </section>
  );
}

function Extras() {
  const phase = data.plan.phases.find((p) => p.id === today.value.phaseId);
  const doneToday = daily.value[localDate(Date.now())] ?? {};
  const cards = [
    { key: 'morning' as const, extra: phase?.morning },
    { key: 'evening' as const, extra: phase?.evening },
  ];
  return (
    <>
      {cards.map(({ key, extra }) => {
        if (!extra) return null;
        const total = extra.stations.reduce((sum, st) => sum + st.seconds, 0) + extra.transition * (extra.stations.length - 1);
        const each = extra.stations[0].seconds;
        const eachText = each >= 60 && each % 60 === 0 ? `${each / 60} min` : `${each} s`;
        const summary =
          key === 'evening'
            ? `${extra.stations.length} holds × ${eachText} · about ${Math.round(total / 60)} min · optional`
            : `About ${Math.round(total / 60)} min, continuous · optional`;
        const done = !!doneToday[key];
        return (
          <section class="card extra" key={key}>
            <div>
              <h3>
                {extra.title} {done && <span class="good-text">✓ done today</span>}
              </h3>
              <div class="muted small">{summary}</div>
              <div class="muted small">{extra.stations.map((st) => st.label).join(' · ')}</div>
            </div>
            <button
              class="round-btn"
              aria-label={`Start ${extra.title}`}
              onClick={() => startTimer(intervalSpec(extra.title, extra.stations, extra.transition, () => void markExtra(key)))}
            >
              <Icon name="play" />
            </button>
          </section>
        );
      })}
    </>
  );
}
