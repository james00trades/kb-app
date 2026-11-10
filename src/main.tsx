import { render } from 'preact';
import { App } from './ui/App';
import { init, refreshDate } from './lib/store';
import { initPWA } from './lib/pwa';
import { appHidden, refreshOnNextTap, unlockAudio } from './lib/sound';
import './styles.css';

// Installed on the iPhone home screen: iOS 26 blurs the top edge, so the layout clears it (see .ios-app in styles.css).
if ((navigator as Navigator & { standalone?: boolean }).standalone) document.documentElement.classList.add('ios-app');

// iOS only allows sound after a touch; every tap keeps audio ready.
document.addEventListener('pointerdown', unlockAudio, { passive: true });
// AirPods or a speaker connected while the app is open: rebuild the sound on the next tap, or it lags.
navigator.mediaDevices?.addEventListener?.('devicechange', refreshOnNextTap);
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
