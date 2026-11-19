// Sparks off the streak flame (James, Nov 19: "some sparks? Starting with campfire sparks, then moving
// up to straight up welding sparks for the intense one"). Each spark is a tiny element with its own
// path, speed and delay; the motion itself is CSS (.sparks in styles.css), so it costs little.

export interface SparkSet {
  kind: 'ember' | 'weld';
  count: number;
  /** Seconds for one spark's flight: [fastest, slowest]. */
  dur: [number, number];
  /** How far a spark travels, px: [least, most]. */
  reach: [number, number];
  /** Sideways spread, px (embers) or the fan's half-angle in degrees (welding). */
  spread: number;
}

/** By heat step (streakHeat). None below 6 days. */
export const SPARKS: Record<number, SparkSet> = {
  6: { kind: 'ember', count: 3, dur: [2.2, 3.0], reach: [16, 22], spread: 6 }, // campfire: a few lazy embers
  8: { kind: 'ember', count: 5, dur: [1.5, 2.2], reach: [20, 28], spread: 9 },
  10: { kind: 'ember', count: 8, dur: [0.9, 1.4], reach: [22, 32], spread: 12 },
  12: { kind: 'ember', count: 12, dur: [0.75, 1.15], reach: [26, 38], spread: 15 }, // campfire at its most intense
  14: { kind: 'weld', count: 16, dur: [0.35, 0.7], reach: [18, 34], spread: 80 }, // welding: a hard, fast spray
};
SPARKS[16] = SPARKS[14]; // 16+: the same welding sparks, with a supernova behind the flame

/** From 16 days, a supernova behind the welding flame (James, Nov 19): a glow, turning light rays,
 *  shockwave rings and a flashing core. Pure CSS (.nova in styles.css). */
const NOVA_FROM = 16;

/** Repeatable "random" in [0, 1), so the sparks look scattered but don't jump on every redraw. */
const rand = (i: number, salt: number) => {
  const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
};
const between = ([a, b]: [number, number], r: number) => a + (b - a) * r;

/** One spark's CSS variables: where it ends up, how long it takes, and when it starts. */
export function sparkVars(set: SparkSet, i: number): Record<string, string> {
  const dur = between(set.dur, rand(i, 1));
  const delay = -dur * rand(i, 2); // already mid-flight on first paint, so they never all start together
  const reach = between(set.reach, rand(i, 3));
  if (set.kind === 'ember') {
    const dx = (rand(i, 4) * 2 - 1) * set.spread;
    const wob = (rand(i, 5) * 2 - 1) * 4;
    return { '--dur': `${dur.toFixed(2)}s`, '--delay': `${delay.toFixed(2)}s`, '--dx': `${dx.toFixed(1)}px`, '--wob': `${wob.toFixed(1)}px`, '--rise': `${reach.toFixed(1)}px` };
  }
  // Welding: shoot out in a fan above the flame, then fall
  const deg = -90 + (rand(i, 4) * 2 - 1) * set.spread;
  const rad = (deg * Math.PI) / 180;
  return {
    '--dur': `${dur.toFixed(2)}s`,
    '--delay': `${delay.toFixed(2)}s`,
    '--dx': `${(Math.cos(rad) * reach).toFixed(1)}px`,
    '--dy': `${(Math.sin(rad) * reach).toFixed(1)}px`,
    '--a': `${(deg + 90).toFixed(0)}deg`,
  };
}

export function Sparks({ heat }: { heat: number }) {
  const set = SPARKS[heat];
  if (!set) return null;
  return (
    <>
      {heat >= NOVA_FROM && (
        <span class="nova" aria-hidden="true">
          <i class="nova-haze" />
          <i class="nova-rays" />
          <i class="nova-ring" />
          <i class="nova-ring late" />
          <i class="nova-core" />
        </span>
      )}
      <span class={`sparks ${set.kind}`} aria-hidden="true">
        {Array.from({ length: set.count }, (_, i) => (
          <i key={i} style={sparkVars(set, i)} />
        ))}
      </span>
    </>
  );
}
