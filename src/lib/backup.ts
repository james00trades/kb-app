// Backup: everything in one file, saved via the share sheet ("Save to Files" → iCloud Drive).
// Progress photos go in too (as base64 text), so a lost phone doesn't lose them.
import { z } from 'zod';
import { db, type BodyEntry, type Daily, type KV, type PhotoFile, type PhotoMeta, type Pose } from './db';
import type { SessionLog } from '../engine/engine';
import { localDate } from '../engine/engine';

/** 2: weight, waist and photos (Nov 7, 2026). Version 1 files still restore. */
export const BACKUP_SCHEMA_VERSION = 2;

const BackupFile = z.object({
  app: z.literal('kb-app'),
  schemaVersion: z.number().int(),
  exportedAt: z.number(),
  sessions: z.array(z.object({ id: z.string(), startedAt: z.number() }).passthrough()),
  kv: z.array(z.object({ key: z.string(), value: z.unknown() })),
  daily: z.array(z.object({ date: z.string() }).passthrough()),
  body: z.array(z.object({ date: z.string(), weight: z.number().optional(), waist: z.number().optional() })).default([]),
  photos: z
    .array(
      z.object({
        id: z.string(),
        date: z.string(),
        pose: z.enum(['front', 'side', 'back']),
        takenAt: z.number(),
        thumb: z.string(),
        data: z.string(),
      }),
    )
    .default([]),
});

/** A photo as stored in the backup file: both pictures as base64 JPEG. */
export interface BackupPhoto {
  id: string;
  date: string;
  pose: Pose;
  takenAt: number;
  thumb: string;
  data: string;
}

export interface Backup {
  app: 'kb-app';
  schemaVersion: number;
  exportedAt: number;
  sessions: SessionLog[];
  kv: KV[];
  daily: Daily[];
  body: BodyEntry[];
  photos: BackupPhoto[];
}

/** Keys that stay on this phone and never go into a backup file. */
const PRIVATE_KEYS = new Set(['apiKey']);

export function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

export function fromBase64(s: string): ArrayBuffer {
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

export async function buildBackupFile(): Promise<File> {
  const [sessions, kv, daily, body, metas, files] = await Promise.all([
    db.sessions.toArray(),
    db.kv.toArray(),
    db.daily.toArray(),
    db.body.toArray(),
    db.photos.toArray(),
    db.photoFiles.toArray(),
  ]);
  const fileById = new Map(files.map((f) => [f.id, f.data]));
  const photos: BackupPhoto[] = metas
    .filter((m) => fileById.has(m.id))
    .map((m) => ({
      id: m.id,
      date: m.date,
      pose: m.pose,
      takenAt: m.takenAt,
      thumb: toBase64(m.thumb),
      data: toBase64(fileById.get(m.id)!),
    }));
  const backup: Backup = {
    app: 'kb-app',
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: Date.now(),
    sessions,
    kv: kv.filter((k) => !PRIVATE_KEYS.has(k.key)),
    daily,
    body,
    photos,
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

/** Replaces everything on this phone with the backup (except keys that never leave the phone). */
export async function restoreBackup(b: Backup): Promise<void> {
  const metas: PhotoMeta[] = b.photos.map((p) => ({
    id: p.id,
    date: p.date,
    pose: p.pose,
    takenAt: p.takenAt,
    thumb: fromBase64(p.thumb),
  }));
  const files: PhotoFile[] = b.photos.map((p) => ({ id: p.id, data: fromBase64(p.data) }));
  const tables = [db.sessions, db.kv, db.daily, db.body, db.photos, db.photoFiles];
  await db.transaction('rw', tables, async () => {
    const kept = (await db.kv.bulkGet([...PRIVATE_KEYS])).filter((k): k is KV => !!k);
    await Promise.all(tables.map((t) => t.clear()));
    await db.sessions.bulkPut(b.sessions);
    await db.kv.bulkPut([...b.kv.filter((k) => !PRIVATE_KEYS.has(k.key)), ...kept]);
    await db.daily.bulkPut(b.daily);
    await db.body.bulkPut(b.body);
    await db.photos.bulkPut(metas);
    await db.photoFiles.bulkPut(files);
  });
}
