import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { isItemComplete, type PlannedSession, type RoutinePlan } from '../engine/engine';
import {
  backOneDay, backupDue, currentStreak, data, draft, meta, openDay, passToday, setPart, startWorkout, tab, today,
  week, workoutOpen, type DayPlan,
} from '../lib/store';
import { intervalSpec, startTimer } from '../lib/timer';
import { Icon, fmtSeconds } from './common';
import { Workout } from './Workout';

/** The Workout tab: the next 7 days → one day's three parts → the workout itself. */
export function Today() {
  if (draft.value && workoutOpen.value) return <Workout />;
  const i = openDay.value;
  const day = i === null ? undefined : week.value[i];
  if (i !== null && day) return <DayScreen day={day} index={i} />;
  return <Home />;
}

const openTo = (i: number | null) => {
  openDay.value = i;
  window.scrollTo(0, 0);
};

// ---------- The next 7 days ----------

function Home() {
  const days = week.value;
  const s = today.value;
  let prevWeek = days[0].session.week;
  let prevPhase = days[0].session.phaseId;

  return (
    <div class="screen">
      {backupDue.value && (
        <button class="note warn note-btn" onClick={() => (tab.value = 'settings')}>
          {meta.value.lastBackupAt
            ? "It's been a week since your last backup. Tap to back up now."
            : "You haven't backed up yet. Tap to save a copy to iCloud Drive."}
        </button>
      )}
      {s.held && (
        <div class="note warn">
          Holding volume: joint pain was reported. The plan stays at Week {s.effectiveWeek} with no increases until a
          session ends pain-free.
        </div>
      )}
      {s.beyondPlan && (
        <div class="note">The plan data ends here, so the app repeats the final week until the next month is loaded.</div>
      )}

      <h3 class="section-title">Next 7 days</h3>
      <section class="card week">
        {days.map((d, i) => {
          const ns = d.session;
          const newPhase = ns.phaseId !== prevPhase;
          const newWeek = ns.week !== prevWeek;
          prevWeek = ns.week;
          prevPhase = ns.phaseId;
          return (
            <div key={d.date}>
              {i > 0 && (newWeek || newPhase) && (
                <div class="week-break">
                  Week {ns.week}
                  {newPhase ? ` · ${ns.phaseName}` : ''}
                </div>
              )}
              {i === 0 ? <TodayRow day={d} /> : <DayRow day={d} index={i} />}
            </div>
          );
        })}
      </section>

      {!draft.value && (
        <div class="nudge-row">
          {!days[0].log && (
            <button
              class="link-btn"
              onClick={() => {
                if (confirm(`Skip ${s.day === 'REST' ? 'the rest day' : `Day ${s.day}`}? It's logged as skipped and the rotation moves on.`)) void passToday('skipped');
              }}
            >
              Skip {s.day === 'REST' ? 'rest day' : `Day ${s.day}`}
            </button>
          )}
          {(s.cycle > 0 || s.slot > 0) && (
            <button class="link-btn" onClick={() => void backOneDay()}>
              Back one day
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const partLabels = (s: PlannedSession) =>
  s.day === 'REST' ? ['Wake-up', 'Walk', 'Evening holds'] : ['Warm-up', 'Workout', 'Evening holds'];

function TodayRow({ day }: { day: DayPlan }) {
  const s = day.session;
  const p = currentStreak.value.today;
  const status = [p.warmup, p.main, p.evening];
  const all = status.every(Boolean);
  return (
    <div class="day-row up-next">
      <When top="Today" />
      <Badge day={s.day} done={all} />
      <div class="day-info">
        <div class="eyebrow">
          Week {s.week} · {s.day === 'REST' ? 'Rest day' : `Day ${s.day}`}
        </div>
        <div class="day-title big">{s.title}</div>
        <div class="day-moves">{summary(s)}</div>
        <ul class="parts-mini">
          {partLabels(s).map((label, k) => (
            <li key={label} class={status[k] ? 'done' : ''}>
              <Icon name={status[k] ? 'check' : 'circle'} size={15} /> {label}
            </li>
          ))}
        </ul>
      </div>
      <div class="up-next-action">
        {draft.value ? (
          <button
            class="big-btn primary"
            onClick={() => {
              openDay.value = 0;
              workoutOpen.value = true;
            }}
          >
            <Icon name="play" /> Resume workout
          </button>
        ) : (
          <button class="big-btn primary" onClick={() => openTo(0)}>
            {all ? 'See today' : 'Open today'} <Icon name="next" />
          </button>
        )}
      </div>
    </div>
  );
}

function DayRow({ day, index }: { day: DayPlan; index: number }) {
  const s = day.session;
  const [y, m, d] = day.date.split('-').map(Number);
  return (
    <button class="day-row tappable" onClick={() => openTo(index)}>
      <When top={new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short' })} num={String(d)} />
      <Badge day={s.day} />
      <div class="day-info">
        <div class="day-title">{s.title}</div>
        <div class="day-moves">{summary(s)}</div>
      </div>
      <span class="chev">
        <Icon name="next" size={18} />
      </span>
    </button>
  );
}

function When({ top, num }: { top: string; num?: string }) {
  return (
    <div class="day-when">
      <span>{top}</span>
      {num && <b>{num}</b>}
    </div>
  );
}

function Badge({ day, done }: { day: string; done?: boolean }) {
  return (
    <div class={`day-badge ${day === 'REST' ? 'rest' : ''} ${done ? 'done' : ''}`}>
      {done ? <Icon name="check" size={18} /> : day === 'REST' ? 'Rest' : day}
    </div>
  );
}

const shortName = (name: string) => name.replace(/\s*\([^)]*\)/g, '');

/** Main moves, or the rest day's note. */
function summary(s: PlannedSession): string {
  if (s.day === 'REST') return s.notes ?? '';
  return s.items
    .filter((i) => i.section === 'main')
    .map((i) => shortName(i.stay.name))
    .join(' · ');
}

function longDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

// ---------- One day: warm-up, workout, evening holds ----------

function DayScreen({ day, index }: { day: DayPlan; index: number }) {
  const s = day.session;
  const rest = s.day === 'REST';
  const live = index === 0; // only today can be started; other days are a look ahead
  const p = live ? currentStreak.value.today : { warmup: false, main: false, evening: false };
  return (
    <div class="screen">
      <header class="workout-head">
        <button class="back-btn" aria-label="Back to the next 7 days" onClick={() => openTo(null)}>
          <Icon name="back" size={22} />
          Back
        </button>
        <div class="workout-head-text">
          <div class="eyebrow">
            {live ? 'Today' : longDate(day.date)} · Week {s.week}
          </div>
          <div class="workout-title">{rest ? s.title : `Day ${s.day} · ${s.title}`}</div>
        </div>
      </header>

      {!live && <div class="note">A look ahead. You can start these on {longDate(day.date)}.</div>}

      {s.warmup && (
        <RoutinePart n={1} r={s.warmup} kind={rest ? 'morning' : 'warmup'} done={p.warmup} live={live} />
      )}
      {rest ? <RestPart n={2} day={day} live={live} /> : <WorkoutPart n={2} day={day} live={live} />}
      {s.evening && <RoutinePart n={3} r={s.evening} kind="evening" done={p.evening} live={live} />}

      {live && p.warmup && p.main && p.evening && (
        <div class="note good">All three done. Today counts toward your streak.</div>
      )}

      {!rest && s.finalWeekOfPhase && s.checks && (
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
    </div>
  );
}

function PartCard(props: { n: number; title: string; meta: string; done: boolean; children: ComponentChildren }) {
  return (
    <section class={`card part ${props.done ? 'done' : ''}`}>
      <div class="part-head">
        <div class="part-num">{props.done ? <Icon name="check" size={18} /> : props.n}</div>
        <div>
          <h3>{props.title}</h3>
          <div class="muted small">{props.meta}</div>
        </div>
      </div>
      {props.children}
    </section>
  );
}

const START_LABEL = { warmup: 'Start warm-up', morning: 'Start wake-up', evening: 'Start holds' } as const;

/** A guided timer part: the warm-up, the rest-day wake-up, or the evening holds. */
function RoutinePart(props: { n: number; r: RoutinePlan; kind: 'warmup' | 'morning' | 'evening'; done: boolean; live: boolean }) {
  const { r, kind, done, live } = props;
  const each = r.stations[0].seconds;
  const meta =
    kind === 'evening' && r.stations.every((st) => st.seconds === each)
      ? `${r.stations.length} holds × ${fmtSeconds(each)} · ${fmtSeconds(r.seconds)}`
      : `${fmtSeconds(r.seconds)}${r.transition ? '' : ', no breaks'}`;
  return (
    <PartCard n={props.n} title={r.title} meta={meta} done={done}>
      {r.notes && <div class="small">{r.notes}</div>}
      <div class="muted small">{r.stations.map((st) => shortName(st.label)).join(' · ')}</div>
      {live && !done && (
        <>
          <button
            class="big-btn primary"
            onClick={() => startTimer(intervalSpec(r.title, r.stations, r.transition, () => void setPart(kind, true), kind === 'warmup'))}
          >
            <Icon name="play" /> {START_LABEL[kind]} · {fmtSeconds(r.seconds)}
          </button>
          <button class="link-btn" onClick={() => void setPart(kind, true)}>
            Mark done without the timer
          </button>
        </>
      )}
      {live && done && (
        <button class="link-btn" onClick={() => void setPart(kind, false)}>
          Done. Tap to undo.
        </button>
      )}
    </PartCard>
  );
}

function WorkoutPart({ n, day, live }: { n: number; day: DayPlan; live: boolean }) {
  const s = day.session;
  const log = day.log;
  const d = draft.value;
  const breath = s.items.find((i) => i.breath)?.breath;
  const meta = [s.minutes, s.effort && `effort ${s.effort}`].filter(Boolean).join(' · ');
  return (
    <PartCard n={n} title="Workout" meta={meta} done={log?.status === 'done'}>
      <div class="muted small">
        {summary(s)}
        {breath && ` · then breathing: ${breath.pattern.name}`}
      </div>
      {live && log && (log.status === 'done' ? (
        <div class="good-text small">Done</div>
      ) : (
        <div class="warn-text small">Ended early, so today doesn't count toward the streak.</div>
      ))}
      {live && !log && d && (
        <>
          <button class="big-btn primary" onClick={() => (workoutOpen.value = true)}>
            <Icon name="play" /> Resume workout
          </button>
          <div class="muted small center">
            In progress · started {Math.max(1, Math.round((Date.now() - d.startedAt) / 60000))} min ago ·{' '}
            {d.items.filter(isItemComplete).length} of {d.items.length} moves done
          </div>
        </>
      )}
      {live && !log && !d && (
        <button
          class="big-btn primary"
          onClick={() => {
            window.scrollTo(0, 0);
            void startWorkout();
          }}
        >
          <Icon name="play" /> Start workout
        </button>
      )}
    </PartCard>
  );
}

function RestPart({ n, day, live }: { n: number; day: DayPlan; live: boolean }) {
  const s = day.session;
  const log = day.log;
  return (
    <PartCard n={n} title="Walk" meta="Rest day" done={log?.status === 'rest'}>
      {s.notes && <div class="muted small">{s.notes}</div>}
      {live && !log && <RestDone s={s} />}
      {live && log && <div class="good-text small">{log.walk ? 'Done · walked' : 'Done'}</div>}
    </PartCard>
  );
}

function RestDone({ s }: { s: PlannedSession }) {
  const [walk, setWalk] = useState(false);
  const next = data.plan.rotation[(s.slot + 1) % data.plan.rotation.length];
  return (
    <div class="rest-actions">
      <button class={`choice ${walk ? 'selected' : ''}`} onClick={() => setWalk(!walk)}>
        {walk ? '✓ ' : ''}Walked today
      </button>
      <button class="big-btn primary" onClick={() => void passToday('rest', walk)}>
        Done · next up Day {next}
      </button>
    </div>
  );
}
