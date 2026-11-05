// Beeps (Web Audio) and spoken cues (on-device speech, works offline).
// iOS only allows sound after a tap, so unlockAudio() runs on the first touch.

let ctx: AudioContext | null = null;
let speechPrimed = false;
let voiceOn = true;

export function setVoice(on: boolean) {
  voiceOn = on;
  if (!on && hasSpeech()) speechSynthesis.cancel();
}

/** "Play through silent switch" uses the playback session (may pause music); otherwise mix with music. */
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
  } catch {
    /* audio unavailable */
  }
  if (!speechPrimed && 'speechSynthesis' in window) {
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    speechSynthesis.speak(u);
    speechPrimed = true;
  }
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

const hasSpeech = () => typeof window !== 'undefined' && 'speechSynthesis' in window;

export function say(text: string) {
  if (!voiceOn || !hasSpeech() || !text) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 1.05;
  u.lang = 'en-US';
  speechSynthesis.speak(u);
}
