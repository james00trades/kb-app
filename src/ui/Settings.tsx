import { useEffect, useRef, useState } from 'preact/hooks';
import { buildBackupFile, readBackupFile, restoreBackup, saveBackupFile, type Backup } from '../lib/backup';
import { beep, loadVoice, say, unlockAudio } from '../lib/sound';
import { markBackedUp, meta, persisted, sessions, settings, updateSettings } from '../lib/store';
import { wakeLockSupported } from '../lib/wakelock';
import { CheckInSettings } from './CheckIn';
import { Sheet, Stepper, Toggle, daysAgo } from './common';

export function Settings() {
  const s = settings.value;
  const [newBell, setNewBell] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, setPending] = useState<Backup | null>(null);
  const input = useRef<HTMLInputElement>(null);

  // Build the backup file ahead of time so the share sheet opens straight from the tap (iOS rule).
  const count = sessions.value.length;
  useEffect(() => {
    let live = true;
    void buildBackupFile().then((f) => live && setFile(f));
    return () => {
      live = false;
    };
  }, [count, s]);

  const last = meta.value.lastBackupAt;

  return (
    <div class="screen">
      <h1>Settings</h1>

      <h3 class="section-title">Sound</h3>
      <div class="list">
        <Toggle on={s.voice} onChange={(v) => void updateSettings({ voice: v })} label="Voice countdown" hint={'"3, 2, 1, go" plus beeps'} />
        <Toggle
          on={s.throughSilent}
          onChange={(v) => void updateSettings({ throughSilent: v })}
          label="Play through the silent switch"
          hint="On: always audible, but may pause your music. Off: mixes with music."
        />
        <button
          class="row"
          onClick={() => {
            unlockAudio();
            void loadVoice().then(() => {
              beep('go');
              say('3, 2, 1, go');
            });
          }}
        >
          <span class="row-label">Test sound</span>
        </button>
      </div>

      <h3 class="section-title">Workout</h3>
      <div class="card">
        <div class="mini-label">Default rest between sets</div>
        <Stepper value={s.defaultRest} onChange={(v) => void updateSettings({ defaultRest: v })} step={15} min={15} unit=" s" />
        <div class="mini-label">Bells I own (lb)</div>
        <div class="chips wrap">
          {s.bells.map((b) => (
            <button
              key={b}
              class="chip selected"
              onClick={() => {
                if (s.bells.length > 1 && confirm(`Remove the ${b} lb bell from the list?`)) void updateSettings({ bells: s.bells.filter((x) => x !== b) });
              }}
            >
              {b} ×
            </button>
          ))}
        </div>
        <div class="add-bell">
          <input
            type="number"
            inputMode="numeric"
            placeholder="Add a bell, e.g. 35"
            value={newBell}
            onInput={(e) => setNewBell((e.target as HTMLInputElement).value)}
          />
          <button
            class="pill-btn"
            onClick={() => {
              const n = Number(newBell);
              if (n > 0 && n < 300) {
                void updateSettings({ bells: [...s.bells, n] });
                setNewBell('');
              }
            }}
          >
            Add
          </button>
        </div>
      </div>

      <CheckInSettings />

      <h3 class="section-title">Backup</h3>
      <div class="card">
        <p class="small">
          Saves everything into one file. In the share sheet, choose <b>Save to Files</b> → <b>iCloud Drive</b>.
        </p>
        <p class="muted small">Last backup: {last ? `${new Date(last).toLocaleDateString()} (${daysAgo(last)})` : 'never'}</p>
        <button
          class="big-btn primary"
          disabled={!file}
          onClick={async () => {
            if (!file) return;
            try {
              const r = await saveBackupFile(file);
              if (r !== 'cancelled') {
                await markBackedUp();
                setMsg(r === 'shared' ? 'Backup saved.' : 'Backup downloaded.');
              }
            } catch (e) {
              setMsg(`Backup failed: ${(e as Error).message}`);
            }
          }}
        >
          Save backup
        </button>
        <button class="big-btn" onClick={() => input.current?.click()}>
          Restore from a backup
        </button>
        <input
          ref={input}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={async (e) => {
            const f = (e.target as HTMLInputElement).files?.[0];
            (e.target as HTMLInputElement).value = '';
            if (!f) return;
            try {
              setPending(await readBackupFile(f));
            } catch (err) {
              setMsg((err as Error).message);
            }
          }}
        />
        {msg && <p class="small">{msg}</p>}
      </div>

      <h3 class="section-title">About</h3>
      <div class="card small muted">
        <div>Version {__APP_VERSION__}</div>
        <div>Data protected from automatic clean-up: {persisted.value === null ? 'checking…' : persisted.value ? 'yes' : 'no'}</div>
        <div>Keep screen awake: {wakeLockSupported ? 'supported' : 'not supported on this device. Set Auto-Lock to Never while training'}</div>
      </div>

      {pending && (
        <Sheet onClose={() => setPending(null)} title="Restore this backup?">
          <p>
            Backup from {new Date(pending.exportedAt).toLocaleString()} with {pending.sessions.length} logged days,{' '}
            {pending.body.filter((b) => b.weight !== undefined).length} weigh-ins and {pending.photos.length} photos.
          </p>
          <p class="note warn">This replaces everything currently in the app on this phone.</p>
          <button
            class="big-btn primary"
            onClick={async () => {
              await restoreBackup(pending);
              location.reload();
            }}
          >
            Replace and restore
          </button>
          <button class="big-btn" onClick={() => setPending(null)}>
            Cancel
          </button>
        </Sheet>
      )}
    </div>
  );
}
