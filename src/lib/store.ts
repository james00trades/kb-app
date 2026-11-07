// App state (signals) and the actions that change it. Everything is saved to IndexedDB as it changes.
import { computed, signal } from '@preact/signals';
import { loadData, type AppData } from '../engine/data';
import {
  back, finishSession, initialState, localDate, passDay, planSession, startDraft, upcoming,
  type EngineState, type PlannedSession, type SessionDraft, type SessionLog,
} from '../engine/engine';
import { addDays, streak } from '../engine/streak';
import { bodyDue as dueNow, weightSummary, weightTrend } from '../engine/body';
import { db, getKV, putKV, type BodyEntry, type Daily, type PhotoMeta, type Pose } from './db';
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
  bells: [18, 35, 45],
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
/** Weight and waist by local date. */
export const body = signal<Record<string, BodyEntry>>({});
/** Progress photo details and previews, newest first. */
export const photos = signal<PhotoMeta[]>([]);
/** The weight or waist entry sheet that's open (any screen). */
export const bodySheet = signal<{ kind: 'weight' | 'waist'; date?: string } | null>(null);
/** The progress-photo camera is open. */
export const photoSession = signal(false);
/** Move id whose card (cues) is open. */
export const moveSheet = signal<string | null>(null);
/** The workout screen is showing. Off when James backs out to the day; the workout stays in progress. */
export const workoutOpen = signal(false);
/** Which of the next 7 days is open (0 = today), or null for the 7-day list. */
export const openDay = signal<number | null>(null);
/** Today's local date. Kept current when the app comes back from the background (see refreshDate). */
export const todayStr = signal(localDate(Date.now()));

export function refreshDate() {
  const d = localDate(Date.now());
  if (d !== todayStr.value) todayStr.value = d;
}

const planData = (): AppData => ({ ...data, plan: { ...data.plan, defaultRest: settings.value.defaultRest } });

export const today = computed<PlannedSession>(() => planSession(planData(), engine.value));

export interface DayPlan {
  date: string;
  session: PlannedSession;
  /** Today's workout or rest day, once it's logged. */
  log?: SessionLog;
}

/** The next 7 days. Today is the next session, or the one already logged today (then the
 * next session falls on tomorrow). */
export const week = computed<DayPlan[]>(() => {
  const log = sessions.value.find((s) => s.date === todayStr.value && s.status !== 'skipped');
  const days: DayPlan[] = log ? [{ date: todayStr.value, session: log.session, log }] : [];
  for (const session of upcoming(planData(), engine.value, 7 - days.length)) {
    days.push({ date: addDays(todayStr.value, days.length), session });
  }
  return days;
});

export const weights = computed(() => weightTrend(Object.values(body.value)));
export const weightStats = computed(() => weightSummary(weights.value));
export const bodyDue = computed(() =>
  dueNow(Object.values(body.value), photos.value.map((p) => p.date), todayStr.value),
);

export const currentStreak = computed(() => streak(sessions.value, daily.value, todayStr.value));

export const isUnlocked = (id: string) =>
  !!data.moveById.get(id)?.unlocked || unlocked.value.includes(id);

const uid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export async function init() {
  try {
    const [eng, set, met, unl, dr, sess, days, bodyRows, photoRows] = await Promise.all([
      getKV<EngineState>('engine'),
      getKV<Settings>('settings'),
      getKV<Meta>('meta'),
      getKV<string[]>('unlocked'),
      getKV<SessionDraft | null>('draft'),
      db.sessions.orderBy('startedAt').reverse().toArray(),
      db.daily.toArray(),
      db.body.toArray(),
      db.photos.orderBy('date').reverse().toArray(),
    ]);
    engine.value = eng ?? initialState();
    const saved = { ...defaultSettings(), ...set };
    // James's bells are 18, 35 and 45 lb (Nov 7). Swap out the old starting list if it was never edited.
    if (saved.bells.join() === '25,45') {
      saved.bells = defaultSettings().bells;
      await putKV('settings', saved);
    }
    settings.value = saved;
    if (met) meta.value = met;
    else await putKV('meta', meta.value);
    unlocked.value = unl ?? [];
    draft.value = dr ?? null;
    workoutOpen.value = !!dr;
    if (dr) openDay.value = 0;
    sessions.value = sess;
    daily.value = Object.fromEntries(days.map((d) => [d.date, d]));
    body.value = Object.fromEntries(bodyRows.map((b) => [b.date, b]));
    photos.value = photoRows.sort((a, b) => b.takenAt - a.takenAt);
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
  workoutOpen.value = true;
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

/** Mark today's wake-up, warm-up or evening holds done (or undo it). */
export async function setPart(kind: 'morning' | 'warmup' | 'evening', done: boolean) {
  const date = localDate(Date.now());
  const row: Daily = { ...(daily.value[date] ?? { date }), [kind]: done ? Date.now() : undefined };
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

export const backupDue = computed(() => {
  const last = meta.value.lastBackupAt;
  const workouts = sessions.value.filter((s) => s.status === 'done' || s.status === 'partial').length;
  if (!workouts) return false;
  return !last || Date.now() - last > 7 * 24 * 3600 * 1000;
});

// ---------- Weight, waist and progress photos ----------

/** Set (or clear, with undefined) the weight or waist for a date. */
export async function setBody(date: string, patch: { weight?: number; waist?: number }) {
  const row: BodyEntry = { ...(body.value[date] ?? { date }), ...patch };
  if (row.weight === undefined) delete row.weight;
  if (row.waist === undefined) delete row.waist;
  const next = { ...body.value };
  if (row.weight === undefined && row.waist === undefined) {
    delete next[date];
    await db.body.delete(date);
  } else {
    next[date] = row;
    await db.body.put(row);
  }
  body.value = next;
}

/** Save a progress photo for today. Replaces a photo of the same pose already taken today. */
export async function addPhoto(pose: Pose, data: ArrayBuffer, thumb: ArrayBuffer): Promise<PhotoMeta> {
  const now = Date.now();
  const meta: PhotoMeta = { id: uid(), date: localDate(now), pose, takenAt: now, thumb };
  const replaced = photos.value.filter((p) => p.date === meta.date && p.pose === pose).map((p) => p.id);
  await db.transaction('rw', db.photos, db.photoFiles, async () => {
    await db.photos.bulkDelete(replaced);
    await db.photoFiles.bulkDelete(replaced);
    await db.photos.put(meta);
    await db.photoFiles.put({ id: meta.id, data });
  });
  photos.value = [meta, ...photos.value.filter((p) => !replaced.includes(p.id))];
  return meta;
}

export async function deletePhoto(id: string) {
  await db.transaction('rw', db.photos, db.photoFiles, async () => {
    await db.photos.delete(id);
    await db.photoFiles.delete(id);
  });
  photos.value = photos.value.filter((p) => p.id !== id);
}

/** The full-size picture (loaded only when needed). */
export async function photoData(id: string): Promise<ArrayBuffer | undefined> {
  return (await db.photoFiles.get(id))?.data;
}
