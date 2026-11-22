import { useEffect } from 'preact/hooks';
import { updateReady } from '../lib/pwa';
import { streakHeat, streakParts, streakPartsDone } from '../engine/streak';
import { currentStreak, draft, levelUp, loadError, logDueCount, photoSession, ready, routinePicker, tab, type Tab } from '../lib/store';
import { timer } from '../lib/timer';
import { setAwake } from '../lib/wakelock';
import { BodySheet } from './Body';
import { Icon } from './common';
import { PhotoSession } from './PhotoSession';
import { History } from './History';
import { LevelUp } from './LevelUp';
import { Library, MoveSheet } from './Library';
import { RoutinePicker } from './RoutinePicker';
import { Settings } from './Settings';
import { Sparks } from './Sparks';
import { UpdateOrb } from './UpdateOrb';
import { RestBar, TimerOverlay } from './TimerView';
import { Timers } from './Timers';
import { Today } from './Today';

const TABS: { id: Tab; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'timers', label: 'Timers' },
  { id: 'library', label: 'Library' },
  { id: 'history', label: 'Progress' },
  { id: 'settings', label: 'Settings' },
];

export function App() {
  const awake = !!draft.value || !!timer.value || photoSession.value;
  useEffect(() => setAwake(awake), [awake]);

  if (loadError.value) {
    return (
      <div class="screen">
        <h1>Something went wrong</h1>
        <p>The app couldn't open its saved data. Your data is still on the phone.</p>
        <pre class="small muted">{loadError.value}</pre>
      </div>
    );
  }
  if (!ready.value) return <div class="screen muted">Loading…</div>;

  const t = tab.value;
  return (
    <>
      <StreakBar />
      {/* New version ready: a circle that bursts into the top right corner, then pulses (James, Nov 19).
          Never mid-workout; it bursts in when the workout ends, after any new streak level. */}
      {updateReady.value && !draft.value && !levelUp.value && <UpdateOrb />}
      <main class="main">
        {routinePicker.value ? (
          <RoutinePicker />
        ) : (
          <>
            {t === 'today' && <Today />}
            {t === 'timers' && <Timers />}
            {t === 'library' && <Library />}
            {t === 'history' && <History />}
            {t === 'settings' && <Settings />}
          </>
        )}
      </main>
      <RestBar />
      <nav class={`tabbar ${routinePicker.value?.welcome ? 'hidden' : ''}`}>
        {TABS.map((x) => (
          <button
            key={x.id}
            class={`tab ${t === x.id ? 'active' : ''}`}
            onClick={() => {
              tab.value = x.id;
              routinePicker.value = null;
              window.scrollTo(0, 0);
            }}
          >
            <span class="tab-icon">
              <Icon name={x.id} />
              {x.id === 'today' && logDueCount.value > 0 && (
                <span class="tab-badge" aria-label={`${logDueCount.value} to log`}>
                  {logDueCount.value}
                </span>
              )}
            </span>
            <span>{x.id === 'today' && draft.value ? 'Workout' : x.label}</span>
          </button>
        ))}
      </nav>
      <MoveSheet />
      <BodySheet />
      <TimerOverlay />
      <PhotoSession />
      <LevelUp />
    </>
  );
}

/** Always at the top: days in a row kept (warm-up and full workout, or the walk; Nov 14). */
function StreakBar() {
  const { current, best, todayKept, today } = currentStreak.value;
  const doneToday = streakPartsDone(today);
  const bestEver = current > 1 && current >= best;
  return (
    <header class="topbar">
      <div class={`streak ${todayKept ? '' : 'cold'}`} aria-label={`${current} day streak. Best ${best}.`}>
        <span class={`flame heat-${streakHeat(current)}`}>
          <Icon name="flame" size={26} filled={todayKept} />
          <Sparks heat={streakHeat(current)} />
        </span>
        {current === 0 && best === 0 ? (
          <span class="streak-label">Start your streak today</span>
        ) : (
          <>
            <span class="streak-n">{current}</span>
            <span class="streak-label">day streak</span>
          </>
        )}
        <span class="streak-side">
          {todayKept ? (
            <span class="good-text">✓ Today done</span>
          ) : doneToday > 0 ? (
            `${doneToday} of ${streakParts(today)} done today`
          ) : current > 0 ? (
            'Keep it going today'
          ) : best > 0 ? (
            'New streak starts today'
          ) : null}
          {best > 0 && <br />}
          {best > 0 && (bestEver ? <span class="good-text">Your best ever!</span> : `Best: ${best} day${best === 1 ? '' : 's'}`)}
        </span>
      </div>
    </header>
  );
}
