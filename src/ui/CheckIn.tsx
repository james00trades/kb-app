// The weekly check-in with Claude: its card on the Progress tab, and its setup in Settings.
import { useEffect, useState } from 'preact/hooks';
import { CHECKIN_EVERY_DAYS, LEVER_TEXT, costOf, type CheckIn } from '../lib/checkin';
import { daysBetween } from '../engine/body';
import {
  apiKey, checkinAbout, checkinDue, checkinError, checkinRunning, checkins, deleteCheckIn, runCheckIn, saveApiKey,
  saveCheckinAbout, tab, todayStr,
} from '../lib/store';
import { Icon, Sheet, fmtDay } from './common';

const fmtCost = (c: CheckIn) => {
  const d = costOf(c.usage);
  return d < 0.01 ? 'under 1¢' : `about ${Math.round(d * 100)}¢`;
};

function Result({ c }: { c: CheckIn }) {
  const r = c.result;
  return (
    <div class="checkin-result">
      <div class="muted small">{fmtDay(c.date)}</div>
      <p class="checkin-headline">{r.headline}</p>
      {r.bigPicture && (
        <>
          <div class="mini-label">Big picture</div>
          <p class="small">{r.bigPicture}</p>
        </>
      )}
      <div class={`lever lever-${r.lever}`}>
        <span class="lever-label">Lever</span> {LEVER_TEXT[r.lever]}
      </div>
      <p class="small">{r.leverWhy}</p>
      {r.actions.length > 0 && (
        <>
          <div class="mini-label">This week</div>
          <ol class="checkin-list">
            {r.actions.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ol>
        </>
      )}
      {r.patterns.length > 0 && (
        <>
          <div class="mini-label">Patterns</div>
          <ul class="checkin-list">
            {r.patterns.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </>
      )}
      {r.photos && (
        <>
          <div class="mini-label">Photos</div>
          <p class="small">{r.photos}</p>
        </>
      )}
      {r.dataGaps && <p class="muted small">Missing data: {r.dataGaps}</p>}
      {c.note && <p class="muted small">Your note: “{c.note}”</p>}
      <p class="muted small">Used {fmtCost(c)} of your monthly API credit.</p>
    </div>
  );
}

/** Seconds since the check-in started, so the wait doesn't look frozen. */
function Waiting() {
  const [start] = useState(Date.now());
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <div class="checkin-waiting">
      <span class="spinner" aria-hidden="true" />
      <span>
        Claude is looking at your week… {Math.round((Date.now() - start) / 1000)} s
        <span class="muted small block">Usually under a minute. You can leave this screen.</span>
      </span>
    </div>
  );
}

export function CheckInCard() {
  const [note, setNote] = useState('');
  const [past, setPast] = useState(false);
  const list = checkins.value;
  const latest = list[0];
  const today = todayStr.value;
  const sinceLast = latest ? daysBetween(latest.date, today) : null;

  if (!apiKey.value) {
    return (
      <section class="card">
        <div class="card-head">
          <h2>Weekly check-in</h2>
        </div>
        <p class="small">
          Once a week, Claude looks at your whole journey since day one (weight, waist, photos, workouts and its own
          earlier advice), spots patterns and plateaus, and tells you which lever to pull: <b>more training intensity</b>{' '}
          or <b>fix the diet</b>.
        </p>
        <button
          class="big-btn primary"
          onClick={() => {
            tab.value = 'settings';
            setTimeout(() => document.getElementById('checkin-settings')?.scrollIntoView({ block: 'start' }), 50);
          }}
        >
          Set it up in Settings (2 min)
        </button>
      </section>
    );
  }

  return (
    <section class="card">
      <div class="card-head">
        <h2>Weekly check-in</h2>
        {list.length > 1 && (
          <button class="pill-btn" onClick={() => setPast(true)}>
            Earlier ({list.length - 1})
          </button>
        )}
      </div>

      {checkinRunning.value ? (
        <Waiting />
      ) : (
        <>
          {checkinError.value && <div class="note warn">{checkinError.value}</div>}
          {latest && <Result c={latest} />}
          {(checkinDue.value || !latest || sinceLast! >= CHECKIN_EVERY_DAYS) && (
            <>
              <textarea
                class="note-input"
                rows={2}
                placeholder="Anything to add? Food, sleep, stress, how the workouts felt (optional)"
                value={note}
                onInput={(e) => setNote((e.target as HTMLTextAreaElement).value)}
              />
              <button class="big-btn primary" onClick={() => void runCheckIn(note).then(() => setNote(''))}>
                <Icon name="check" /> Run this week's check-in
              </button>
            </>
          )}
          {latest && sinceLast! < CHECKIN_EVERY_DAYS && (
            <p class="muted small center">
              Next check-in in {CHECKIN_EVERY_DAYS - sinceLast!} day{CHECKIN_EVERY_DAYS - sinceLast! === 1 ? '' : 's'}.{' '}
              <button
                class="link-btn inline"
                onClick={() => {
                  if (confirm('Run another check-in now? It uses a little more of your API credit.')) void runCheckIn(note);
                }}
              >
                Run one now
              </button>
            </p>
          )}
        </>
      )}

      {past && (
        <Sheet onClose={() => setPast(false)} title="Earlier check-ins">
          {list.slice(1).map((c) => (
            <div key={c.id} class="checkin-past">
              <Result c={c} />
              <button
                class="link-btn danger"
                onClick={() => confirm(`Delete the check-in from ${fmtDay(c.date)}?`) && void deleteCheckIn(c.id)}
              >
                Delete this check-in
              </button>
            </div>
          ))}
          <button class="big-btn" onClick={() => setPast(false)}>
            Close
          </button>
        </Sheet>
      )}
    </section>
  );
}

/** Settings: API key and the optional "About you" line. */
export function CheckInSettings() {
  const [draft, setDraft] = useState('');
  const [about, setAbout] = useState(checkinAbout.value);
  const key = apiKey.value;
  return (
    <>
      <h3 class="section-title" id="checkin-settings">
        Claude check-in
      </h3>
      <div class="card">
        {key ? (
          <>
            <p class="small">
              <span class="good-text">✓ API key saved</span> <span class="muted">(ends in …{key.slice(-4)})</span>
            </p>
            <button
              class="link-btn danger"
              onClick={() => confirm('Remove the API key from this phone? Check-ins stop until you add one again.') && void saveApiKey(null)}
            >
              Remove the key
            </button>
          </>
        ) : (
          <>
            <p class="small">To turn on the weekly check-in, give the app your own Claude API key:</p>
            <ol class="small steps">
              <li>
                On <b>claude.ai</b>: Settings → Billing → API credits → <b>Link organization</b> (one time).
              </li>
              <li>
                Open <b>platform.claude.com</b> → <b>API keys</b> → <b>Create key</b>. Name it "Kettlebell app".
              </li>
              <li>Copy the key and paste it here.</li>
            </ol>
            <input
              class="text-input"
              type="password"
              autoComplete="off"
              placeholder="Paste your API key"
              value={draft}
              onInput={(e) => setDraft((e.target as HTMLInputElement).value)}
            />
            <button
              class="big-btn primary"
              disabled={draft.trim().length < 20}
              onClick={() => {
                void saveApiKey(draft);
                setDraft('');
              }}
            >
              Save key
            </button>
          </>
        )}
        <p class="muted small">
          The key stays on this phone and is never put in backups. Your Max plan's monthly API credit pays for check-ins
          (about 20–30¢ each, so roughly $1 a month). Don't buy credits or turn on auto-reload in the Console: then nothing is ever charged, and
          check-ins just pause if the credit runs out.
        </p>
        <div class="mini-label">About you (optional, sent with each check-in)</div>
        <textarea
          class="note-input"
          rows={3}
          placeholder="E.g. age, goal weight and by when, old injuries, anything Claude should keep in mind"
          value={about}
          onInput={(e) => setAbout((e.target as HTMLTextAreaElement).value)}
          onBlur={() => about !== checkinAbout.value && void saveCheckinAbout(about)}
        />
      </div>
    </>
  );
}
