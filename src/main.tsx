import { render } from 'preact';
import { App } from './ui/App';
import { init } from './lib/store';
import { initPWA } from './lib/pwa';
import { unlockAudio } from './lib/sound';
import './styles.css';

// iOS only allows sound after a touch; every tap keeps audio ready.
document.addEventListener('pointerdown', unlockAudio, { passive: true });

void init();
initPWA();
render(<App />, document.getElementById('app')!);
