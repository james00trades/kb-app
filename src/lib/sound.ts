// Beeps and spoken cues, both played through Web Audio so they mix with the user's music.
// The voice is recorded clips bundled with the app (public/voice/), not the phone's
// built-in speech: on iPhone, built-in speech stops music playing in other apps.
// iOS only allows sound after a tap, so unlockAudio() runs on every touch.
import { CLIPS, voicePlan } from './voiceText';

let ctx: AudioContext | null = null;
let voiceOn = true;

const buffers = new Map<string, AudioBuffer>();
let loading: Promise<void> | null = null;
let loaded = false;
let speaking: AudioBufferSourceNode[] = [];
let sayId = 0;

export function setVoice(on: boolean) {
  voiceOn = on;
  if (!on) stopVoice();
}

/** "Play through silent switch" uses the playback session (pauses music); otherwise mix with music. */
export function setAudioSession(throughSilent: boolean) {
  const session = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
  if (session) {
    try {
      session.type = throughSilent ? 'playback' : 'ambient';
    } catch {
      /* not supported */
    }
  }
}

export function unlockAudio() {
  try {
    if (!ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') void ctx.resume();
    const buf = ctx.createBuffer(1, 1, 22050);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(0);
    void loadVoice();
  } catch {
    /* audio unavailable */
  }
}

/** Fetch and decode the voice clips once (they're in the offline cache). */
export function loadVoice(): Promise<void> {
  const c = ctx;
  if (!c) return Promise.resolve();
  if (!loading) {
    const base = `${import.meta.env.BASE_URL}voice/`;
    loading = Promise.all(
      Object.entries(CLIPS).map(async ([key, clip]) => {
        if (buffers.has(key)) return;
        const res = await fetch(base + clip.file);
        if (!res.ok) throw new Error(`voice clip ${clip.file}: ${res.status}`);
        buffers.set(key, await c.decodeAudioData(await res.arrayBuffer()));
      }),
    )
      .then(() => {
        loaded = true;
      })
      .catch(() => {
        loading = null; // try again on the next tap
      });
  }
  return loading;
}

type BeepKind = 'tick' | 'go' | 'rest' | 'end' | 'soft';

const BEEPS: Record<BeepKind, { freq: number; dur: number; vol: number; repeat?: number }> = {
  tick: { freq: 660, dur: 0.12, vol: 0.35 },
  go: { freq: 990, dur: 0.35, vol: 0.45 },
  rest: { freq: 520, dur: 0.35, vol: 0.4 },
  end: { freq: 880, dur: 0.18, vol: 0.45, repeat: 3 },
  soft: { freq: 440, dur: 0.15, vol: 0.2 },
};

export function beep(kind: BeepKind) {
  if (!ctx) return;
  if (ctx.state === 'suspended') void ctx.resume();
  const b = BEEPS[kind];
  const t0 = ctx.currentTime;
  for (let i = 0; i < (b.repeat ?? 1); i++) {
    const start = t0 + i * (b.dur + 0.08);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = b.freq;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(b.vol, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + b.dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + b.dur + 0.02);
  }
}

export function stopVoice() {
  sayId++;
  for (const src of speaking) {
    try {
      src.stop();
    } catch {
      /* already stopped */
    }
  }
  speaking = [];
}

/** Speak a cue with the recorded clips. A new cue cuts off the previous one. */
export function say(text: string) {
  if (!voiceOn || !ctx || !text) return;
  stopVoice();
  const id = sayId;
  if (loaded) play(text);
  else void loadVoice().then(() => id === sayId && loaded && play(text));
}

function play(text: string) {
  const c = ctx;
  if (!c) return;
  if (c.state === 'suspended') void c.resume();
  let at = c.currentTime + 0.02;
  for (const key of voicePlan(text).keys) {
    const buf = buffers.get(key);
    if (!buf) continue;
    const src = c.createBufferSource();
    src.buffer = buf;
    src.connect(c.destination);
    src.start(at);
    at += buf.duration + 0.05;
    speaking.push(src);
  }
}
