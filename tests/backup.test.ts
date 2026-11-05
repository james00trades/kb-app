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

  it('rejects a file that is not a backup', async () => {
    const junk = new File(['{"hello":1}'], 'x.json', { type: 'application/json' });
    await expect(readBackupFile(junk)).rejects.toThrow(/isn't a backup/);
    const notJson = new File(['nope'], 'x.json');
    await expect(readBackupFile(notJson)).rejects.toThrow(/isn't a backup/);
  });
});
