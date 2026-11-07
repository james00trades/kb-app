// On-device storage (IndexedDB via Dexie). Nothing leaves the phone except backups.
import Dexie, { type Table } from 'dexie';
import type { SessionLog } from '../engine/engine';

export interface KV {
  key: string;
  value: unknown;
}

/** The day's warm-up and evening parts, keyed by local date. Values are completion timestamps. */
export interface Daily {
  date: string;
  /** The wake-up routine on its own (rest days; before Nov 7, 2026 also the optional morning card). */
  morning?: number;
  /** The guided warm-up (workout days). */
  warmup?: number;
  evening?: number;
}

/** Weight and waist, one row per local date. */
export interface BodyEntry {
  date: string;
  /** Pounds. */
  weight?: number;
  /** Inches. */
  waist?: number;
}

export type Pose = 'front' | 'side' | 'back';

/** A progress photo's details plus a small preview. The full picture is in `photoFiles`
 * so the app can load every preview at start without loading every photo. */
export interface PhotoMeta {
  id: string;
  date: string;
  pose: Pose;
  takenAt: number;
  /** JPEG, about 240 × 320. */
  thumb: ArrayBuffer;
}

export interface PhotoFile {
  id: string;
  /** JPEG, up to 960 × 1280 (3:4 portrait). */
  data: ArrayBuffer;
}

class KbDb extends Dexie {
  sessions!: Table<SessionLog, string>;
  kv!: Table<KV, string>;
  daily!: Table<Daily, string>;
  body!: Table<BodyEntry, string>;
  photos!: Table<PhotoMeta, string>;
  photoFiles!: Table<PhotoFile, string>;

  constructor() {
    super('kb-app');
    this.version(1).stores({
      sessions: 'id, date, startedAt',
      kv: 'key',
      daily: 'date',
    });
    // Nov 7, 2026: weight, waist and progress photos
    this.version(2).stores({
      body: 'date',
      photos: 'id, date, pose',
      photoFiles: 'id',
    });
  }
}

export const db = new KbDb();

export async function getKV<T>(key: string): Promise<T | undefined> {
  return (await db.kv.get(key))?.value as T | undefined;
}

export async function putKV(key: string, value: unknown): Promise<void> {
  await db.kv.put({ key, value });
}
