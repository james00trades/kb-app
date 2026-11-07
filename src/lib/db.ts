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

class KbDb extends Dexie {
  sessions!: Table<SessionLog, string>;
  kv!: Table<KV, string>;
  daily!: Table<Daily, string>;

  constructor() {
    super('kb-app');
    this.version(1).stores({
      sessions: 'id, date, startedAt',
      kv: 'key',
      daily: 'date',
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
