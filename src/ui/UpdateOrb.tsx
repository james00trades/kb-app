// "Update Available" (James, Nov 19): a floating square over the end of the streak bar, where his
// screenshot marked it. When it first appears it explodes into view (pop, white flash, shockwave, a burst
// of sparks); once that settles it glows and pulses until tapped. The motion is CSS (.update-card in
// styles.css); this file places the burst sparks. Amber with white words, amber and white sparks (James's pick).
import { applyUpdate } from '../lib/pwa';
import { Icon } from './common';

const COUNT = 26;

/** Repeatable "random" in [0, 1), so the burst looks scattered but is the same every time. */
const rand = (i: number, salt: number) => {
  const x = Math.sin(i * 91.7 + salt * 271.3) * 43758.5453;
  return x - Math.floor(x);
};

/** One burst spark: an even spread of directions, each a little off, at its own speed, in the theme's colors. */
export function burstVars(i: number): Record<string, string> {
  const deg = (360 / COUNT) * i + (rand(i, 1) - 0.5) * 18;
  const rad = (deg * Math.PI) / 180;
  const dist = 70 + rand(i, 2) * 80;
  const size = 4 + Math.round(rand(i, 3) * 3);
  return {
    '--dx': `${(Math.cos(rad) * dist).toFixed(1)}px`,
    '--dy': `${(Math.sin(rad) * dist).toFixed(1)}px`,
    '--c': i % 4 === 3 ? '#ffffff' : `var(--u-c${(i % 3) + 1})`,
    '--s': `${size}px`,
    '--dur': `${(0.9 + rand(i, 4) * 0.6).toFixed(2)}s`,
    '--delay': `${(rand(i, 5) * 0.12).toFixed(2)}s`,
  };
}

export function UpdateOrb() {
  return (
    <button class="update-card" onClick={applyUpdate} aria-label="Update available. Tap to update the app.">
      <span class="uc-pulse" aria-hidden="true" />
      <span class="uc-body">
        <Icon name="refresh" size={24} />
        <span class="uc-text">
          Update
          <br />
          Available
        </span>
      </span>
      <span class="uc-ring" aria-hidden="true" />
      <span class="uc-burst" aria-hidden="true">
        {Array.from({ length: COUNT }, (_, i) => (
          <i key={i} style={burstVars(i)} />
        ))}
      </span>
    </button>
  );
}
