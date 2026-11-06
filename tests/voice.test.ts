import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadData } from '../src/engine/data';
import type { Station } from '../src/engine/schema';
import { amrapSpec, breathSpec, emomSpec, holdSpec, intervalSpec, restSpec, roundsSpec, type TimerSpec } from '../src/lib/timer';
import { CLIPS, voicePlan } from '../src/lib/voiceText';

const { plan } = loadData();

/** Every timer the app can build from the plan, plus the generic ones in the Timers tab. */
function allSpecs(): TimerSpec[] {
  const specs: TimerSpec[] = [
    restSpec(60),
    holdSpec('Hold', 30, false),
    holdSpec('Hold', 30, true),
    roundsSpec('Interval', 30, 30, 10),
    emomSpec(30),
    amrapSpec(20),
    ...Object.values(plan.breathPatterns).map((p) => breathSpec(p, 4)),
  ];
  for (const ph of plan.phases) {
    for (const extra of [ph.morning, ph.evening]) if (extra) specs.push(intervalSpec(extra.title, extra.stations, extra.transition));
    const items = [...ph.warmup, ...ph.cooldown, ...Object.values(ph.days).flatMap((d) => d.items ?? [])];
    for (const it of items) {
      if (it.kind !== 'routine') continue;
      const stations: Station[] = [...(it.routine ? ph[it.routine]?.stations ?? [] : []), ...(it.stations ?? [])];
      specs.push(intervalSpec(it.label ?? 'Routine', stations, it.transition ?? 0));
    }
  }
  return specs;
}

describe('recorded voice', () => {
  it('has a clip for every word the timers say', () => {
    const phrases = new Set(['1', '2', '3', 'Go', 'Done', '3, 2, 1, go']);
    for (const spec of allSpecs()) for (const ph of spec.phases) phrases.add(ph.say ?? ph.label);
    const missing = [...phrases].flatMap((p) => voicePlan(p).missing.map((w) => `"${w}" in "${p}"`));
    expect(missing, 'Run `npm run voice` to record new words').toEqual([]);
  });

  it('every clip file is in the app', () => {
    const absent = Object.values(CLIPS).filter((c) => !existsSync(new URL(`../public/voice/${c.file}`, import.meta.url)));
    expect(absent).toEqual([]);
  });

  it('splits cues into clips, dropping notes in brackets', () => {
    expect(voicePlan('Get ready. First, Push-ups (knees or bench OK)').keys).toEqual(['get ready', 'first', 'push-ups']);
    expect(voicePlan('Round 7').keys).toEqual(['round', '7']);
    expect(voicePlan('3, 2, 1, go').keys).toEqual(['3', '2', '1', 'go']);
    expect(voicePlan('').keys).toEqual([]);
  });
});
