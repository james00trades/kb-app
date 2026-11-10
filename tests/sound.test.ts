import { beforeAll, describe, expect, it, vi } from 'vitest';

/** A stand-in for the browser's AudioContext that records what the app does with it. */
class FakeCtx {
  static made: FakeCtx[] = [];
  state = 'suspended'; // iOS starts a context suspended until it's resumed in a tap
  currentTime = 0;
  destination = {};
  played = 0;
  constructor() {
    FakeCtx.made.push(this);
  }
  resume() {
    if (this.state !== 'closed') this.state = 'running';
    return Promise.resolve();
  }
  close() {
    this.state = 'closed';
    return Promise.resolve();
  }
  createBuffer() {
    return { duration: 0 };
  }
  createBufferSource() {
    return { buffer: null, connect: () => {}, start: () => this.played++, stop: () => {} };
  }
  createOscillator() {
    return { type: '', frequency: { value: 0 }, connect: (n: unknown) => n, start: () => this.played++, stop: () => {} };
  }
  createGain() {
    return { gain: { setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} }, connect: (n: unknown) => n };
  }
  decodeAudioData() {
    return Promise.resolve({ duration: 0.4 });
  }
}

let sound: typeof import('../src/lib/sound');
const last = () => FakeCtx.made[FakeCtx.made.length - 1];

beforeAll(async () => {
  vi.stubGlobal('window', { AudioContext: FakeCtx });
  vi.stubGlobal('fetch', async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }));
  sound = await import('../src/lib/sound');
});

describe('sound keeps working after iPhone takes the audio away', () => {
  it('the first tap makes the sound engine and starts it', async () => {
    sound.unlockAudio();
    await sound.loadVoice();
    expect(FakeCtx.made).toHaveLength(1);
    expect(last().state).toBe('running');
  });

  it('later taps keep the same engine when nothing happened', () => {
    sound.unlockAudio();
    expect(FakeCtx.made).toHaveLength(1);
  });

  it('after a trip to another app, the next tap builds a fresh engine', () => {
    const old = last();
    sound.appHidden(true);
    sound.appHidden(false);
    sound.unlockAudio();
    expect(FakeCtx.made).toHaveLength(2);
    expect(old.state).toBe('closed');
    expect(last().state).toBe('running');
  });

  it('if iPhone interrupts the sound while the app is open, the next tap builds a fresh engine', () => {
    last().state = 'interrupted';
    sound.unlockAudio();
    expect(FakeCtx.made).toHaveLength(3);
    expect(last().state).toBe('running');
  });

  it('beeps and the voice play on the fresh engine', () => {
    const now = last();
    sound.beep('go');
    sound.say('3, 2, 1, go');
    expect(now.played).toBeGreaterThanOrEqual(1 + 1 + 4); // silent unlock + beep + 4 clips
  });

  it('after a timer ends, the next tap builds a fresh engine for whatever is connected now (AirPods, Nov 10)', () => {
    const before = FakeCtx.made.length;
    sound.unlockAudio();
    expect(FakeCtx.made).toHaveLength(before); // nothing changed: same engine
    sound.refreshOnNextTap();
    sound.unlockAudio();
    expect(FakeCtx.made).toHaveLength(before + 1);
    expect(last().state).toBe('running');
  });

  it('an engine iPhone interrupts (audio route change) is rebuilt at the next tap, even if it recovers', () => {
    const before = FakeCtx.made.length;
    const c = last() as FakeCtx & { onstatechange?: () => void };
    c.state = 'interrupted';
    c.onstatechange?.();
    c.state = 'running';
    sound.unlockAudio();
    expect(FakeCtx.made).toHaveLength(before + 1);
  });

  it('coming back to the app tries to wake an interrupted engine right away', () => {
    last().state = 'interrupted';
    sound.appHidden(false);
    expect(last().state).toBe('running');
  });
});
