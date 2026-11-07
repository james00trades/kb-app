import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { buildBackupFile, readBackupFile, restoreBackup } from '../src/lib/backup';
import { db, getKV, putKV } from '../src/lib/db';
import type { SessionLog } from '../src/engine/engine';

const session = (id: string): SessionLog =>
  ({
    id,
    date: '2026-11-04',
    startedAt: 1,
    endedAt: 2,
    status: 'done',
    session: {} as SessionLog['session'],
    items: [],
    kbReps: 120,
    effort: 6,
    pain: false,
  }) as SessionLog;

describe('backup', () => {
  it('saves everything and restores it exactly, replacing what was there', async () => {
    await db.sessions.bulkPut([session('a'), session('b')]);
    await putKV('engine', { pointer: { cycle: 1, slot: 2 } });
    await db.daily.put({ date: '2026-11-04', morning: 5 });

    const file = await buildBackupFile();
    expect(file.name).toMatch(/^kettlebell-backup-\d{4}-\d{2}-\d{2}\.json$/);

    // Phone gets wiped / replaced, and something else is there now
    await Promise.all([db.sessions.clear(), db.kv.clear(), db.daily.clear()]);
    await db.sessions.put(session('stray'));

    const backup = await readBackupFile(file);
    await restoreBackup(backup);

    const ids = (await db.sessions.toArray()).map((s) => s.id).sort();
    expect(ids).toEqual(['a', 'b']);
    expect(await getKV('engine')).toEqual({ pointer: { cycle: 1, slot: 2 } });
    expect((await db.daily.get('2026-11-04'))?.morning).toBe(5);
  });

  it('includes weight, waist and photos, but never the API key', async () => {
    const jpeg = (n: number) => new Uint8Array([0xff, 0xd8, n, 0xff, 0xd9]).buffer;
    await db.body.bulkPut([{ date: '2026-11-07', weight: 231.4, waist: 40.5 }]);
    await db.photos.put({ id: 'p1', date: '2026-11-07', pose: 'front', takenAt: 9, thumb: jpeg(1) });
    await db.photoFiles.put({ id: 'p1', data: jpeg(2) });
    await putKV('apiKey', 'sk-test-on-this-phone');

    const file = await buildBackupFile();
    expect(await file.text()).not.toContain('sk-test-on-this-phone');

    await Promise.all([db.body.clear(), db.photos.clear(), db.photoFiles.clear()]);
    await putKV('apiKey', 'sk-test-new-phone');
    await restoreBackup(await readBackupFile(file));

    expect(await db.body.get('2026-11-07')).toEqual({ date: '2026-11-07', weight: 231.4, waist: 40.5 });
    const meta = await db.photos.get('p1');
    expect(meta).toMatchObject({ date: '2026-11-07', pose: 'front', takenAt: 9 });
    expect([...new Uint8Array(meta!.thumb)]).toEqual([0xff, 0xd8, 1, 0xff, 0xd9]);
    expect([...new Uint8Array((await db.photoFiles.get('p1'))!.data)]).toEqual([0xff, 0xd8, 2, 0xff, 0xd9]);
    // The key on this phone stays as it was
    expect(await getKV('apiKey')).toBe('sk-test-new-phone');
  });

  it('still restores a backup from before photos existed', async () => {
    await db.body.put({ date: '2026-11-01', weight: 240 });
    const old = { app: 'kb-app', schemaVersion: 1, exportedAt: 1, sessions: [session('a')], kv: [], daily: [] };
    const file = new File([JSON.stringify(old)], 'old.json', { type: 'application/json' });
    await restoreBackup(await readBackupFile(file));
    expect((await db.sessions.toArray()).map((s) => s.id)).toEqual(['a']);
    expect(await db.body.count()).toBe(0);
  });

  it('rejects a file that is not a backup', async () => {
    const junk = new File(['{"hello":1}'], 'x.json', { type: 'application/json' });
    await expect(readBackupFile(junk)).rejects.toThrow(/isn't a backup/);
    const notJson = new File(['nope'], 'x.json');
    await expect(readBackupFile(notJson)).rejects.toThrow(/isn't a backup/);
  });
});
