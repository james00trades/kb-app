import { render } from 'preact';
import { App } from './ui/App';
import { init, refreshDate } from './lib/store';
import { initPWA } from './lib/pwa';
import { appHidden, unlockAudio } from './lib/sound';
import './styles.css';

// iOS only allows sound after a touch; every tap keeps audio ready.
document.addEventListener('pointerdown', unlockAudio, { passive: true });
document.addEventListener('visibilitychange', () => {
  // Another app can take the sound while this one is in the background; recover on return.
  appHidden(document.hidden);
  // The app can sit in the background overnight; make "today" today again.
  if (!document.hidden) refreshDate();
});
setInterval(refreshDate, 60_000);

void init();
initPWA();
render(<App />, document.getElementById('app')!);
