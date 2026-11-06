// Turns a spoken cue ("Get ready. First, Jumping twists") into recorded clip keys.
// Clips are made by scripts/make-voice.mjs, which uses the same normalizing rule.
import clips from '../voice/clips.json';

export interface Clip {
  file: string;
  /** Seconds. */
  dur: number;
}

export const CLIPS: Record<string, Clip> = clips;

/** "Push-ups (knees or bench OK)" → "push-ups". Must match norm() in make-voice.mjs. */
export function normSegment(s: string): string {
  return s
    .replace(/\([^)]*\)/g, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9' -]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Clip keys to play for a phrase, plus any words with no clip. */
export function voicePlan(text: string, has = (k: string) => Object.hasOwn(CLIPS, k)): { keys: string[]; missing: string[] } {
  const keys: string[] = [];
  const missing: string[] = [];
  for (const part of text.split(/[.,;:!?]+/)) {
    const seg = normSegment(part);
    if (!seg) continue;
    if (has(seg)) {
      keys.push(seg);
      continue;
    }
    // e.g. "Round 7" → "round" + "7"
    for (const word of seg.split(' ')) (has(word) ? keys : missing).push(word);
  }
  return { keys, missing };
}
