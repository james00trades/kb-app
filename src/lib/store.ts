// App state (signals) and the actions that change it. Everything is saved to IndexedDB as it changes.
import { computed, signal } from '@preact/signals';
import { loadData, type AppData } from '../engine/data';
import {
  back, finishSession, initialState, localDate, passDay, planSession, startDraft,
  type EngineState, type PlannedSession, type SessionDraft, type SessionLog,
} from '../engine/engine';
import { db, getKV, putKV, type Daily } from './db';
import { setAudioSession, setVoice } from './sound';

export const data: AppData = loadData();

export interface Settings {
  voice: boolean;
  throughSilent: boolean;
  defaultRest: number;
  bells: number[];
}

export interface Meta {
  createdAt: number;
  lastBackupAt?: number;
}

const defaultSettings = (): Settings => ({
  voice: true,
  throughSilent: false,
  defaultRest: data.plan.defaultRest,
  bells: [25, 45],
});

export type Tab = 'today' | 'timers' | 'library' | 'history' | 'settings';

export const ready = signal(false);
export const loadError = signal<string | null>(null);
export const tab = signal<Tab>('today');
export const engine = signal<EngineState>(initialState());
export const settings = signal<Settings>(defaultSettings());
export const meta = signal<Meta>({ createdAt: Date.now() });
export const unlocked = signal<string[]>([]);
export const draft = signal<SessionDraft | null>(null);
export const sessions = signal<SessionLog[]>([]);
export const daily = signal<Record<string, Daily>>({});
export const persisted = signal<boolean | null>(null);
/** Move id whose card (cues) is open. */
export const moveSheet = signal<string | null>(null);

export const today = computed<PlannedSession>(() =>
  planSession({ ...data, plan: { ...data.plan, defaultRest: settings.value.defaultRest } }, engine.value),
);

export const isUnlocked = (id: string) =>
  !!data.moveById.get(id)?.unlocked || unlocked.value.includes(id);

const uid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export async function init() {
  try {
    const [eng, set, met, unl, dr, sess, days] = await Promise.all([
      getKV<EngineState>('engine'),
      getKV<Settings>('settings'),
      getKV<Meta>('meta'),
      getKV<string[]>('unlocked'),
      getKV<SessionDraft | null>('draft'),
      db.sessions.orderBy('startedAt').reverse().toArray(),
      db.daily.toArray(),
    ]);
    engine.value = eng ?? initialState();
    settings.value = { ...defaultSettings(), ...set };
    if (met) meta.value = met;
    else await putKV('meta', meta.value);
    unlocked.value = unl ?? [];
    draft.value = dr ?? null;
    sessions.value = sess;
    daily.value = Object.fromEntries(days.map((d) => [d.date, d]));
    setVoice(settings.value.voice);
    setAudioSession(settings.value.throughSilent);
    ready.value = true;
  } catch (e) {
    loadError.value = String(e);
  }
  if (navigator.storage?.persist) {
    try {
      persisted.value = (await navigator.storage.persisted()) || (await navigator.storage.persist());
    } catch {
      persisted.value = false;
    }
  }
}

async function saveEngine(next: EngineState) {
  engine.value = next;
  await putKV('engine', next);
}

// ---------- Workout ----------

export async function startWorkout() {
  const d = startDraft(today.value, uid(), Date.now());
  draft.value = d;
  await putKV('draft', d);
}

export async function updateDraft(fn: (d: SessionDraft) => SessionDraft) {
  if (!draft.value) return;
  const d = fn(draft.value);
  draft.value = d;
  await putKV('draft', d);
}

export async function discardWorkout() {
  draft.value = null;
  await putKV('draft', null);
}

export async function finishWorkout(effort: number, pain: boolean) {
  const d = draft.value;
  if (!d) return;
  const r = finishSession(data.plan, engine.value, d, { effort, pain }, Date.now());
  await db.sessions.put(r.log);
  sessions.value = [r.log, ...sessions.value];
  const newly = r.trained.filter((id) => !isUnlocked(id));
  if (newly.length) {
    unlocked.value = [...unlocked.value, ...newly];
    await putKV('unlocked', unlocked.value);
  }
  await saveEngine(r.state);
  await discardWorkout();
}

// ---------- Rotation ----------

export async function passToday(kind: 'rest' | 'skipped', walk?: boolean) {
  const r = passDay(data.plan, engine.value, today.value, kind, uid(), Date.now(), walk);
  await db.sessions.put(r.log);
  sessions.value = [r.log, ...sessions.value];
  await saveEngine(r.state);
}

export async function backOneDay() {
  await saveEngine({ ...engine.value, pointer: back(data.plan, engine.value.pointer) });
}

// ---------- Extras, settings, library ----------

export async function markExtra(kind: 'morning' | 'evening') {
  const date = localDate(Date.now());
  const row: Daily = { ...(daily.value[date] ?? { date }), [kind]: Date.now() };
  daily.value = { ...daily.value, [date]: row };
  await db.daily.put(row);
}

export async function updateSettings(patch: Partial<Settings>) {
  const next = { ...settings.value, ...patch };
  next.bells = [...new Set(next.bells)].sort((a, b) => a - b);
  settings.value = next;
  setVoice(next.voice);
  setAudioSession(next.throughSilent);
  await putKV('settings', next);
}

export async function unlockMove(id: string) {
  if (isUnlocked(id)) return;
  unlocked.value = [...unlocked.value, id];
  await putKV('unlocked', unlocked.value);
}

export async function markBackedUp() {
  meta.value = { ...meta.value, lastBackupAt: Date.now() };
  await putKV('meta', meta.value);
}

export const trainedToday = computed(() => {
  const d = localDate(Date.now());
  return sessions.value.some((s) => s.date === d && (s.status === 'done' || s.status === 'partial'));
});

export const backupDue = computed(() => {
  const last = meta.value.lastBackupAt;
  const workouts = sessions.value.filter((s) => s.status === 'done' || s.status === 'partial').length;
  if (!workouts) return false;
  return !last || Date.now() - last > 7 * 24 * 3600 * 1000;
});
