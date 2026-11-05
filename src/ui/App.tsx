import { useEffect } from 'preact/hooks';
import { applyUpdate, updateReady } from '../lib/pwa';
import { draft, loadError, ready, tab, type Tab } from '../lib/store';
import { timer } from '../lib/timer';
import { setAwake } from '../lib/wakelock';
import { Icon } from './common';
import { History } from './History';
import { Library, MoveSheet } from './Library';
import { Settings } from './Settings';
import { RestBar, TimerOverlay } from './TimerView';
import { Timers } from './Timers';
import { Today } from './Today';

const TABS: { id: Tab; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'timers', label: 'Timers' },
  { id: 'library', label: 'Library' },
  { id: 'history', label: 'History' },
  { id: 'settings', label: 'Settings' },
];

export function App() {
  const awake = !!draft.value || !!timer.value;
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
      <main class="main">
        {updateReady.value && !draft.value && (
          <button class="note good note-btn" onClick={applyUpdate}>
            A new version is ready. Tap to update.
          </button>
        )}
        {t === 'today' && <Today />}
        {t === 'timers' && <Timers />}
        {t === 'library' && <Library />}
        {t === 'history' && <History />}
        {t === 'settings' && <Settings />}
      </main>
      <RestBar />
      <nav class="tabbar">
        {TABS.map((x) => (
          <button
            key={x.id}
            class={`tab ${t === x.id ? 'active' : ''}`}
            onClick={() => {
              tab.value = x.id;
              window.scrollTo(0, 0);
            }}
          >
            <Icon name={x.id} />
            <span>{x.id === 'today' && draft.value ? 'Workout' : x.label}</span>
          </button>
        ))}
      </nav>
      <MoveSheet />
      <TimerOverlay />
    </>
  );
}
