// Records the app's spoken cues as small WAV clips with a free Windows voice (offline).
// The app plays these through Web Audio, which mixes with music; iPhone's built-in
// speech voice pauses other apps' music, so the app doesn't use it.
//
// Run on Windows after changing spoken words or station labels in data/plan.json:
//   npm run voice            (KB_VOICE=Zira or David picks another installed voice)
// The voice test fails if a label the timers speak has no clip.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(root, 'public', 'voice');
const MANIFEST = join(root, 'src', 'voice', 'clips.json');
const VOICE = process.env.KB_VOICE ?? 'Mark';

/** Same rule as normSegment() in src/lib/voiceText.ts. */
const norm = (s) =>
  s.replace(/\([^)]*\)/g, ' ').toLowerCase().replace(/[^a-z0-9' -]/g, ' ').replace(/\s+/g, ' ').trim();
const SPLIT = /[.,;:!?]+/;

// Words the timers say (see src/lib/timer.ts), and numbers for countdowns, rounds and minutes.
const WORDS = [
  'get ready', 'first', 'next', 'go', 'done', 'rest', 'hold', 'in', 'out', 'breathe in', 'breathe out',
  'switch sides', 'left side', 'right side', 'round', 'minute',
];
const NUMBERS = Array.from({ length: 30 }, (_, i) => String(i + 1));
/** Keys the voice would misread. */
const SAY_AS = { '4-7-8 breathing': 'four, seven, eight breathing' };

// Station labels and breathing pattern names from the plan
const plan = JSON.parse(readFileSync(join(root, 'data', 'plan.json'), 'utf8'));
const labels = new Set(Object.values(plan.breathPatterns).map((p) => p.name));
for (const ph of plan.phases) {
  for (const extra of [ph.morning, ph.evening]) for (const s of extra?.stations ?? []) labels.add(s.label);
  const items = [...ph.warmup, ...ph.cooldown, ...Object.values(ph.days).flatMap((d) => d.items ?? [])];
  for (const it of items) for (const s of it.stations ?? []) labels.add(s.label);
}

const keys = new Set([...WORDS, ...NUMBERS]);
for (const label of labels) for (const part of label.split(SPLIT)) if (norm(part)) keys.add(norm(part));

const slug = (k) => k.replace(/'/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const list = [...keys].sort().map((key) => ({ key, text: SAY_AS[key] ?? key, file: `${slug(key)}.wav` }));
const files = new Set(list.map((x) => x.file));
if (files.size !== list.length) throw new Error('Two clips map to the same file name.');

// Speak every phrase with the Windows voice
const tmp = mkdtempSync(join(tmpdir(), 'kb-voice-'));
writeFileSync(join(tmp, 'list.json'), JSON.stringify(list.map(({ text, file }) => ({ text, file }))));
execFileSync(
  'powershell',
  ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(root, 'scripts', 'tts.ps1'), '-List', join(tmp, 'list.json'), '-OutDir', tmp, '-Voice', VOICE],
  { stdio: 'inherit' },
);

// Trim silence, even out loudness, and write the clips + manifest
function readWav(buf) {
  let off = 12;
  let fmt;
  let data;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === 'fmt ') fmt = { format: buf.readUInt16LE(off + 8), channels: buf.readUInt16LE(off + 10), rate: buf.readUInt32LE(off + 12), bits: buf.readUInt16LE(off + 22) };
    if (id === 'data') data = buf.subarray(off + 8, off + 8 + size);
    off += 8 + size + (size % 2);
  }
  if (!fmt || !data || fmt.format !== 1 || fmt.bits !== 16 || fmt.channels !== 1) throw new Error('Expected 16-bit mono PCM WAV');
  const samples = new Int16Array(data.length / 2);
  for (let i = 0; i < samples.length; i++) samples[i] = data.readInt16LE(i * 2);
  return { rate: fmt.rate, samples };
}

function tidy(samples, rate) {
  let peak = 1;
  for (const s of samples) peak = Math.max(peak, Math.abs(s));
  const threshold = peak * 0.03;
  let start = samples.findIndex((s) => Math.abs(s) > threshold);
  let end = samples.findLastIndex((s) => Math.abs(s) > threshold);
  start = Math.max(0, start - Math.round(rate * 0.03));
  end = Math.min(samples.length - 1, end + Math.round(rate * 0.06));
  const gain = (0.89 * 32767) / peak;
  return Int16Array.from(samples.subarray(start, end + 1), (s) => Math.round(s * gain));
}

function writeWav(samples, rate) {
  const b = Buffer.alloc(44 + samples.length * 2);
  b.write('RIFF', 0, 'ascii');
  b.writeUInt32LE(36 + samples.length * 2, 4);
  b.write('WAVEfmt ', 8, 'ascii');
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36, 'ascii');
  b.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((s, i) => b.writeInt16LE(s, 44 + i * 2));
  return b;
}

mkdirSync(OUT, { recursive: true });
for (const f of readdirSync(OUT)) if (f.endsWith('.wav')) rmSync(join(OUT, f));
const manifest = {};
let bytes = 0;
for (const { key, file } of list) {
  const { rate, samples } = readWav(readFileSync(join(tmp, file)));
  const clip = tidy(samples, rate);
  const wav = writeWav(clip, rate);
  writeFileSync(join(OUT, file), wav);
  manifest[key] = { file, dur: Math.round((clip.length / rate) * 1000) / 1000 };
  bytes += wav.length;
}
mkdirSync(join(root, 'src', 'voice'), { recursive: true });
writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
rmSync(tmp, { recursive: true, force: true });
console.log(`Wrote ${list.length} clips (${Math.round(bytes / 1024)} KB) to public/voice/.`);
