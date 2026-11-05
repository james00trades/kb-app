// Backup: everything in one file, saved via the share sheet ("Save to Files" → iCloud Drive).
import { z } from 'zod';
import { db, type Daily, type KV } from './db';
import type { SessionLog } from '../engine/engine';
import { localDate } from '../engine/engine';

export const BACKUP_SCHEMA_VERSION = 1;

const BackupFile = z.object({
  app: z.literal('kb-app'),
  schemaVersion: z.number().int(),
  exportedAt: z.number(),
  sessions: z.array(z.object({ id: z.string(), startedAt: z.number() }).passthrough()),
  kv: z.array(z.object({ key: z.string(), value: z.unknown() })),
  daily: z.array(z.object({ date: z.string() }).passthrough()),
});

export interface Backup {
  app: 'kb-app';
  schemaVersion: number;
  exportedAt: number;
  sessions: SessionLog[];
  kv: KV[];
  daily: Daily[];
}

export async function buildBackupFile(): Promise<File> {
  const [sessions, kv, daily] = await Promise.all([db.sessions.toArray(), db.kv.toArray(), db.daily.toArray()]);
  const backup: Backup = {
    app: 'kb-app',
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: Date.now(),
    sessions,
    kv,
    daily,
  };
  const name = `kettlebell-backup-${localDate(Date.now())}.json`;
  return new File([JSON.stringify(backup)], name, { type: 'application/json' });
}

/** Must be called straight from a tap (iOS rule), with the file already built. */
export async function saveBackupFile(file: File): Promise<'shared' | 'downloaded' | 'cancelled'> {
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: file.name });
      return 'shared';
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'cancelled';
      throw e;
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'downloaded';
}

export async function readBackupFile(file: File): Promise<Backup> {
  const text = await file.text();
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("This file isn't a backup from this app.");
  }
  const parsed = BackupFile.safeParse(raw);
  if (!parsed.success) throw new Error("This file isn't a backup from this app.");
  if (parsed.data.schemaVersion > BACKUP_SCHEMA_VERSION) {
    throw new Error('This backup is from a newer version of the app. Update the app first.');
  }
  return parsed.data as unknown as Backup;
}

/** Replaces everything on this phone with the backup. */
export async function restoreBackup(b: Backup): Promise<void> {
  await db.transaction('rw', db.sessions, db.kv, db.daily, async () => {
    await Promise.all([db.sessions.clear(), db.kv.clear(), db.daily.clear()]);
    await db.sessions.bulkPut(b.sessions);
    await db.kv.bulkPut(b.kv);
    await db.daily.bulkPut(b.daily);
  });
}
