// A new streak level (James, Nov 22: "fill the screen with that animation to draw attention to the new
// achievement"). The streak bar's own flame, at its new step, blown up to fill the screen: it pops in
// with a flash, shockwaves and a burst of sparks, then keeps its usual motion (sway, flicker, embers,
// welding sparks, supernova) until tapped. Only the day count, no level names (James).
// The flame's looks are the streak bar's (styles.css, .heat-N); the entrance is .levelup.
import { useEffect } from 'preact/hooks';
import { levelUp } from '../lib/store';
import { Icon } from './common';
import { Sparks } from './Sparks';

const BURST = 28;

/** Repeatable "random" in [0, 1), so the burst looks scattered but is the same every time. */
const rand = (i: number, salt: number) => {
  const x = Math.sin(i * 57.3 + salt * 193.1) * 43758.5453;
  return x - Math.floor(x);
};

/** One burst spark, in the flame's (un-zoomed) pixels: an even spread of directions, each a little off. */
export function levelBurstVars(i: number): Record<string, string> {
  const deg = (360 / BURST) * i + (rand(i, 1) - 0.5) * 14;
  const rad = (deg * Math.PI) / 180;
  const dist = 28 + rand(i, 2) * 34;
  return {
    '--dx': `${(Math.cos(rad) * dist).toFixed(1)}px`,
    '--dy': `${(Math.sin(rad) * dist).toFixed(1)}px`,
    '--dur': `${(0.9 + rand(i, 3) * 0.7).toFixed(2)}s`,
    '--delay': `${(0.32 + rand(i, 4) * 0.12).toFixed(2)}s`,
  };
}

export function LevelUp() {
  const lv = levelUp.value;
  useEffect(() => {
    if (!lv) return;
    const close = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') levelUp.value = null;
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [lv]);
  if (!lv) return null;
  return (
    <div
      class={`levelup heat-${lv.heat}`}
      role="dialog"
      aria-modal="true"
      aria-label={`New streak level: ${lv.days} days in a row. Tap to continue.`}
      onClick={() => (levelUp.value = null)}
    >
      <div class="levelup-flash" aria-hidden="true" />
      <div class="levelup-zoom" aria-hidden="true">
        <span class={`flame heat-${lv.heat}`}>
          <i class="levelup-glow" />
          <i class="levelup-ring" />
          <i class="levelup-ring late" />
          <span class="levelup-burst">
            {Array.from({ length: BURST }, (_, i) => (
              <i key={i} style={levelBurstVars(i)} />
            ))}
          </span>
          <Icon name="flame" size={26} filled />
          <Sparks heat={lv.heat} />
        </span>
      </div>
      <div class="levelup-text">
        <div class="levelup-n">{lv.days}</div>
        <div class="levelup-label">day streak</div>
        <div class="levelup-sub">New streak level</div>
      </div>
      <div class="levelup-tap">Tap to continue</div>
    </div>
  );
}
