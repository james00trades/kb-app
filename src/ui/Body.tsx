// Weight, waist and progress photos: the "Body" half of the Progress tab, plus the entry sheet
// and photo viewer. Everything here stays on the phone.
import { useEffect, useMemo, useState } from 'preact/hooks';
import { PHOTO_EVERY_DAYS, WAIST_EVERY_DAYS, daysBetween, type WeightPoint } from '../engine/body';
import { addDays } from '../engine/streak';
import type { PhotoMeta, Pose } from '../lib/db';
import {
  body, bodyDue, bodySheet, checkinDue, deletePhoto, photoData, photoSession, photos, progressView, setBody, tab, todayStr, weightStats,
  weights,
} from '../lib/store';
import { CheckInCard } from './CheckIn';
import { Icon, Sheet, fmtDay } from './common';

export const POSE_LABEL: Record<Pose, string> = { front: 'Front', side: 'Side', back: 'Back' };
const POSES: Pose[] = ['front', 'side', 'back'];

// ---------- Formatting ----------

/** 231.4 → "231.4"; waist 40.25 → "40.25", 40.5 → "40.5". */
export function fmtNum(n: number, maxDigits = 1): string {
  return String(Number(n.toFixed(maxDigits)));
}

const fmtLb = (n: number) => `${n.toFixed(1)} lb`;
const fmtIn = (n: number) => `${fmtNum(n, 2)} in`;

/** Weight "−1.2 lb" / "+0.4 lb"; waist "−0.75 in"; "no change". */
function fmtDelta(n: number, unit: 'lb' | 'in'): string {
  if (Math.abs(n) < 0.05) return 'no change';
  const v = unit === 'lb' ? Math.abs(n).toFixed(1) : fmtNum(Math.abs(n), 2);
  return `${n < 0 ? '−' : '+'}${v} ${unit}`;
}

function shortDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function whenText(date: string, today: string): string {
  const n = daysBetween(date, today);
  if (n <= 0) return 'today';
  if (n === 1) return 'yesterday';
  return `${n} days ago`;
}

// ---------- Pictures ----------

function useBlobUrl(buf: ArrayBuffer | undefined | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!buf) {
      setUrl(null);
      return;
    }
    const u = URL.createObjectURL(new Blob([buf], { type: 'image/jpeg' }));
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [buf]);
  return url;
}

/** The full-size picture of a photo, loaded on demand. */
export function usePhotoUrl(id: string | null | undefined): string | null {
  const [buf, setBuf] = useState<ArrayBuffer | null>(null);
  useEffect(() => {
    let live = true;
    setBuf(null);
    if (id) void photoData(id).then((b) => live && setBuf(b ?? null));
    return () => {
      live = false;
    };
  }, [id]);
  return useBlobUrl(buf);
}

function Thumb({ photo, onOpen }: { photo: PhotoMeta; onOpen: () => void }) {
  const url = useBlobUrl(photo.thumb);
  return (
    <button class="thumb" onClick={onOpen} aria-label={`${POSE_LABEL[photo.pose]} photo, ${fmtDay(photo.date)}`}>
      {url && <img src={url} alt="" />}
    </button>
  );
}

// ---------- The Body view ----------

export function BodyView() {
  return (
    <>
      <CheckInCard />
      <WeightCard />
      <WaistCard />
      <PhotosCard />
    </>
  );
}

function WeightCard() {
  const stats = weightStats.value;
  const pts = weights.value;
  const [all, setAll] = useState(false);
  return (
    <section class="card">
      <div class="card-head">
        <h2>Weight</h2>
        <button class="pill-btn" onClick={() => (bodySheet.value = { kind: 'weight' })}>
          Log weight
        </button>
      </div>
      {!stats ? (
        <p class="muted small">
          Weigh in each morning. The app shows a 7-day average, so day-to-day swings (water, salt) don't throw you off.
        </p>
      ) : (
        <>
          <div class="stats">
            <div class="stat">
              <div class="stat-num">
                {stats.latest.avg.toFixed(1)}
                <span class="stat-unit"> lb</span>
              </div>
              <div class="muted small">7-day average</div>
            </div>
            <div class="stat">
              <div class={`stat-delta ${stats.weekChange !== null && stats.weekChange < 0 ? 'down' : ''}`}>
                {stats.weekChange === null ? '—' : fmtDelta(stats.weekChange, 'lb')}
              </div>
              <div class="muted small">this week</div>
            </div>
            <div class="stat">
              <div class={`stat-delta ${stats.sinceStart !== null && stats.sinceStart < 0 ? 'down' : ''}`}>
                {stats.sinceStart === null ? '—' : fmtDelta(stats.sinceStart, 'lb')}
              </div>
              <div class="muted small">since {shortDate(stats.first.date)}</div>
            </div>
          </div>
          {pts.length >= 2 ? (
            <WeightChart points={pts} today={todayStr.value} />
          ) : (
            <p class="muted small">Log a few more mornings to see your trend line.</p>
          )}
          <button class="link-btn muted" onClick={() => setAll(true)}>
            All weigh-ins ({pts.length})
          </button>
        </>
      )}
      {all && <WeighIns onClose={() => setAll(false)} />}
    </section>
  );
}

function WeighIns({ onClose }: { onClose: () => void }) {
  const today = todayStr.value;
  const rows = [...weights.value].reverse();
  return (
    <Sheet onClose={onClose} title="All weigh-ins">
      <div class="list sheet-list">
        {rows.map((p) => (
          <button
            key={p.date}
            class="list-row"
            onClick={() => {
              onClose();
              bodySheet.value = { kind: 'weight', date: p.date };
            }}
          >
            <span class="list-main">
              <span>{fmtDay(p.date)}</span>
              <span class="muted small">
                {whenText(p.date, today)} · 7-day average {p.avg.toFixed(1)}
              </span>
            </span>
            <span class="row-value">{fmtLb(p.weight)}</span>
          </button>
        ))}
      </div>
      <button class="big-btn" onClick={onClose}>Close</button>
    </Sheet>
  );
}

/** Daily weigh-ins as faint dots, the 7-day average as the line. Tap or drag to read a day. */
function WeightChart({ points, today }: { points: WeightPoint[]; today: string }) {
  const W = 320;
  const H = 170;
  const L = 34;
  const R = 44;
  const T = 12;
  const B = 22;
  const [sel, setSel] = useState<number | null>(null);

  const g = useMemo(() => {
    const lastDate = points[points.length - 1].date;
    const end = today > lastDate ? today : lastDate;
    let start = addDays(end, -55); // about 8 weeks
    if (points[0].date > start) start = points[0].date;
    if (daysBetween(start, end) < 13) start = addDays(end, -13);
    const shown = points.filter((p) => p.date >= start);
    const vals = shown.flatMap((p) => [p.weight, p.avg]);
    let lo = Math.min(...vals);
    let hi = Math.max(...vals);
    const step = [0.5, 1, 2, 5, 10, 20, 50].find((s) => s >= (hi - lo) / 3) ?? 50;
    lo = Math.floor(lo / step) * step;
    hi = Math.ceil(hi / step) * step;
    while ((hi - lo) / step < 2) {
      hi += step;
      if ((hi - lo) / step < 2) lo -= step;
    }
    const span = daysBetween(start, end);
    const x = (date: string) => L + (daysBetween(start, date) / span) * (W - L - R);
    const y = (v: number) => T + ((hi - v) / (hi - lo)) * (H - T - B);
    const ticks: number[] = [];
    for (let v = lo; v <= hi + 1e-9; v += step) ticks.push(Number(v.toFixed(1)));
    return { start, end, shown, x, y, ticks };
  }, [points, today]);

  const { shown, x, y, ticks } = g;
  const line = shown.map((p, i) => `${i ? 'L' : 'M'}${x(p.date).toFixed(1)},${y(p.avg).toFixed(1)}`).join(' ');
  const last = shown[shown.length - 1];
  const picked = sel !== null ? shown[sel] : null;

  const pick = (e: PointerEvent) => {
    const svg = e.currentTarget as SVGSVGElement;
    const r = svg.getBoundingClientRect();
    const sx = ((e.clientX - r.left) / r.width) * W;
    let best = 0;
    shown.forEach((p, i) => {
      if (Math.abs(x(p.date) - sx) < Math.abs(x(shown[best].date) - sx)) best = i;
    });
    setSel(best);
  };

  return (
    <div class="chart">
      {picked && (
        <div class="chart-tip" style={{ left: `${Math.min(78, Math.max(22, (x(picked.date) / W) * 100))}%` }}>
          <div class="muted small">{fmtDay(picked.date)}</div>
          <div>
            <b>{fmtLb(picked.weight)}</b> <span class="muted small">· 7-day avg {picked.avg.toFixed(1)}</span>
          </div>
        </div>
      )}
      <svg
        viewBox={`0 0 ${W} ${H}`}
        class="chart-svg"
        role="img"
        aria-label={`Weight, last 8 weeks. 7-day average ${last.avg.toFixed(1)} pounds on ${fmtDay(last.date)}.`}
        onPointerDown={(e) => {
          (e.currentTarget as SVGSVGElement).setPointerCapture?.(e.pointerId);
          pick(e as unknown as PointerEvent);
        }}
        onPointerMove={(e) => (e.buttons || e.pointerType === 'mouse') && pick(e as unknown as PointerEvent)}
        onPointerLeave={(e) => e.pointerType === 'mouse' && setSel(null)}
      >
        {ticks.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} class="chart-grid" />
            <text x={L - 6} y={y(v) + 4} class="chart-axis" text-anchor="end">
              {fmtNum(v)}
            </text>
          </g>
        ))}
        <text x={L} y={H - 4} class="chart-axis" text-anchor="start">
          {shortDate(g.start)}
        </text>
        <text x={W - R} y={H - 4} class="chart-axis" text-anchor="end">
          {shortDate(g.end)}
        </text>
        {picked && <line x1={x(picked.date)} x2={x(picked.date)} y1={T} y2={H - B} class="chart-cursor" />}
        {shown.map((p, i) => (
          <circle key={p.date} cx={x(p.date)} cy={y(p.weight)} r={i === sel ? 5 : 4} class={`chart-dot ${i === sel ? 'on' : ''}`} />
        ))}
        {shown.length > 1 && <path d={line} class="chart-line" />}
        <circle cx={x(last.date)} cy={y(last.avg)} r={5} class="chart-end" />
        <text x={x(last.date) + 9} y={y(last.avg) + 4} class="chart-end-label">
          {last.avg.toFixed(1)}
        </text>
      </svg>
      <div class="chart-key muted small">
        <span>
          <i class="key-dot" /> daily weigh-in
        </span>
        <span>
          <i class="key-line" /> 7-day average
        </span>
      </div>
    </div>
  );
}

function WaistCard() {
  const today = todayStr.value;
  const rows = Object.values(body.value)
    .filter((e): e is { date: string; waist: number } => typeof e.waist === 'number')
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  const due = bodyDue.value;
  const latest = rows[0];
  const first = rows[rows.length - 1];
  const nextIn = due.lastWaist ? WAIST_EVERY_DAYS - daysBetween(due.lastWaist, today) : 0;
  return (
    <section class="card">
      <div class="card-head">
        <h2>Waist</h2>
        <button class="pill-btn" onClick={() => (bodySheet.value = { kind: 'waist' })}>
          Log waist
        </button>
      </div>
      {!latest ? (
        <p class="muted small">Measure once a month. Waist often shows progress the scale misses.</p>
      ) : (
        <>
          <div class="stats">
            <div class="stat">
              <div class="stat-num">
                {fmtNum(latest.waist, 2)}
                <span class="stat-unit"> in</span>
              </div>
              <div class="muted small">{whenText(latest.date, today)}</div>
            </div>
            <div class="stat">
              <div class={`stat-delta ${latest.waist < first.waist ? 'down' : ''}`}>
                {rows.length > 1 ? fmtDelta(latest.waist - first.waist, 'in') : '—'}
              </div>
              <div class="muted small">since {shortDate(first.date)}</div>
            </div>
            <div class="stat">
              <div class="stat-delta">{nextIn > 0 ? `${nextIn} days` : 'Now'}</div>
              <div class="muted small">next measure</div>
            </div>
          </div>
          <div class="list sheet-list">
            {rows.slice(0, 6).map((r) => (
              <button key={r.date} class="list-row" onClick={() => (bodySheet.value = { kind: 'waist', date: r.date })}>
                <span>{fmtDay(r.date)}</span>
                <span class="row-value">{fmtIn(r.waist)}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function PhotosCard() {
  const today = todayStr.value;
  const due = bodyDue.value;
  const [open, setOpen] = useState<PhotoMeta | null>(null);
  const byDate = new Map<string, Partial<Record<Pose, PhotoMeta>>>();
  for (const p of photos.value) {
    const set = byDate.get(p.date) ?? {};
    if (!set[p.pose]) set[p.pose] = p;
    byDate.set(p.date, set);
  }
  const dates = [...byDate.keys()].sort((a, b) => (a < b ? 1 : -1));
  const nextIn = due.lastPhoto ? PHOTO_EVERY_DAYS - daysBetween(due.lastPhoto, today) : 0;
  return (
    <section class="card">
      <div class="card-head">
        <h2>Progress photos</h2>
        <button class="pill-btn" onClick={() => (photoSession.value = true)}>
          <Icon name="camera" size={18} /> Take
        </button>
      </div>
      <p class="muted small">
        {!dates.length
          ? 'Front, side and back, once a week. Your first set is the "before" picture. Photos stay in this app (and your backup), never your camera roll.'
          : nextIn > 0
            ? `Next set due in ${nextIn} day${nextIn === 1 ? '' : 's'}.`
            : 'A new set is due.'}
      </p>
      {dates.map((d) => (
        <div key={d} class="photo-set">
          <div class="small">
            {fmtDay(d)} <span class="muted">· {whenText(d, today)}</span>
          </div>
          <div class="thumbs">
            {POSES.map((pose) => {
              const p = byDate.get(d)![pose];
              return p ? (
                <Thumb key={pose} photo={p} onOpen={() => setOpen(p)} />
              ) : (
                <div key={pose} class="thumb empty">
                  {POSE_LABEL[pose]}
                </div>
              );
            })}
          </div>
        </div>
      ))}
      {open && <PhotoViewer start={open} onClose={() => setOpen(null)} />}
    </section>
  );
}

/** Full-screen photo, with older/newer of the same pose to see the change. */
function PhotoViewer({ start, onClose }: { start: PhotoMeta; onClose: () => void }) {
  const [cur, setCur] = useState(start);
  const same = photos.value.filter((p) => p.pose === cur.pose).sort((a, b) => (a.date < b.date ? -1 : 1));
  const i = same.findIndex((p) => p.id === cur.id);
  const url = usePhotoUrl(cur.id);
  return (
    <div class="viewer" role="dialog" aria-label="Progress photo">
      <header class="viewer-head">
        <span>
          {POSE_LABEL[cur.pose]} · {fmtDay(cur.date)}
        </span>
        <button class="icon-btn" aria-label="Close photo" onClick={onClose}>
          <Icon name="close" />
        </button>
      </header>
      <div class="viewer-img">{url && <img src={url} alt={`${POSE_LABEL[cur.pose]} photo, ${fmtDay(cur.date)}`} />}</div>
      <div class="viewer-nav">
        <button class="pill-btn" disabled={i <= 0} onClick={() => setCur(same[i - 1])}>
          ‹ Older
        </button>
        <span class="muted small">
          {i + 1} of {same.length}
        </span>
        <button class="pill-btn" disabled={i >= same.length - 1} onClick={() => setCur(same[i + 1])}>
          Newer ›
        </button>
      </div>
      <button
        class="link-btn danger"
        onClick={async () => {
          if (!confirm(`Delete this ${cur.pose} photo from ${fmtDay(cur.date)}? This can't be undone.`)) return;
          const rest = same.filter((p) => p.id !== cur.id);
          await deletePhoto(cur.id);
          if (!rest.length) onClose();
          else setCur(rest[Math.min(i, rest.length - 1)]);
        }}
      >
        Delete this photo
      </button>
    </div>
  );
}

// ---------- Entry sheet (opened from the 7-day screen or the Progress tab) ----------

const KINDS = {
  weight: {
    title: 'Weight',
    unit: 'lb',
    step: 0.2,
    digits: 1,
    min: 60,
    max: 700,
    hint: 'Weigh in each morning: after the bathroom, before eating or drinking.',
  },
  waist: {
    title: 'Waist',
    unit: 'in',
    step: 0.25,
    digits: 2,
    min: 15,
    max: 90,
    hint: 'At belly-button height, standing relaxed, after a normal breath out. Tape snug, not tight.',
  },
} as const;

export function BodySheet() {
  const open = bodySheet.value;
  if (!open) return null;
  return <BodyEntrySheet key={`${open.kind}-${open.date ?? ''}`} kind={open.kind} date={open.date} />;
}

function BodyEntrySheet({ kind, date: startDate }: { kind: 'weight' | 'waist'; date?: string }) {
  const k = KINDS[kind];
  const today = todayStr.value;
  const [date, setDate] = useState(startDate ?? today);
  const existing = body.value[date]?.[kind];
  // Start from this date's value, or else the most recent one
  const recent = Object.values(body.value)
    .filter((e) => typeof e[kind] === 'number')
    .sort((a, b) => (a.date < b.date ? 1 : -1))[0]?.[kind];
  const [text, setText] = useState(() => {
    const v = body.value[startDate ?? today]?.[kind] ?? recent;
    return v === undefined ? '' : fmtNum(v, k.digits);
  });
  const value = Number(text.replace(',', '.'));
  const valid = text.trim() !== '' && Number.isFinite(value) && value >= k.min && value <= k.max;
  const close = () => (bodySheet.value = null);
  const bump = (d: number) => {
    const base = Number.isFinite(value) && text.trim() !== '' ? value : recent;
    if (base === undefined) return;
    setText(fmtNum(Math.max(0, base + d), k.digits));
  };

  return (
    <Sheet onClose={close} title={date === today ? `Today's ${k.title.toLowerCase()}` : `${k.title} · ${fmtDay(date)}`}>
      <div class="num-entry">
        <button class="step-btn" aria-label="less" onClick={() => bump(-k.step)}>
          −
        </button>
        <label class="num-field">
          <input
            type="text"
            inputMode="decimal"
            value={text}
            placeholder={kind === 'weight' ? '230.0' : '40'}
            aria-label={`${k.title} in ${k.unit === 'lb' ? 'pounds' : 'inches'}`}
            onInput={(e) => setText((e.target as HTMLInputElement).value)}
          />
          <span class="num-unit">{k.unit}</span>
        </label>
        <button class="step-btn" aria-label="more" onClick={() => bump(k.step)}>
          +
        </button>
      </div>
      <p class="muted small center">{k.hint}</p>
      <label class="date-row">
        <span class="muted">Date</span>
        <input type="date" value={date} max={today} onInput={(e) => setDate((e.target as HTMLInputElement).value || today)} />
      </label>
      {existing !== undefined && date !== startDate && (
        <p class="small warn-text">This replaces {fmtNum(existing, k.digits)} {k.unit} already logged for that day.</p>
      )}
      <button
        class="big-btn primary"
        disabled={!valid}
        onClick={async () => {
          await setBody(date, { [kind]: Number(value.toFixed(k.digits)) });
          close();
        }}
      >
        <Icon name="check" /> Save
      </button>
      {existing !== undefined && (
        <button
          class="link-btn danger"
          onClick={async () => {
            if (!confirm(`Delete the ${k.title.toLowerCase()} logged for ${fmtDay(date)}?`)) return;
            await setBody(date, { [kind]: undefined });
            close();
          }}
        >
          Delete this entry
        </button>
      )}
    </Sheet>
  );
}

// ---------- Reminders on the 7-day screen ----------

export function BodyCheckIn() {
  const due = bodyDue.value;
  const today = todayStr.value;
  const checkin = checkinDue.value;
  if (!due.weight && !due.photos && !due.waist && !checkin) return null;
  const lastWeight = weights.value[weights.value.length - 1];
  return (
    <div class="list body-checkin">
      {due.weight && (
        <button class="list-row" onClick={() => (bodySheet.value = { kind: 'weight' })}>
          <Icon name="weight" />
          <span class="list-main grow">
            <span>Log today's weight</span>
            <span class="muted small">
              {lastWeight ? `Last: ${fmtLb(lastWeight.weight)}, ${whenText(lastWeight.date, today)}` : 'Each morning, before breakfast'}
            </span>
          </span>
          <Icon name="next" size={20} />
        </button>
      )}
      {due.photos && (
        <button class="list-row" onClick={() => (photoSession.value = true)}>
          <Icon name="camera" />
          <span class="list-main grow">
            <span>Progress photos are due</span>
            <span class="muted small">
              {due.lastPhoto ? `Last set ${whenText(due.lastPhoto, today)}` : 'Your first set: the "before" pictures'}
            </span>
          </span>
          <Icon name="next" size={20} />
        </button>
      )}
      {checkin && (
        <button
          class="list-row"
          onClick={() => {
            progressView.value = 'body';
            tab.value = 'history';
            window.scrollTo(0, 0);
          }}
        >
          <Icon name="check" />
          <span class="list-main grow">
            <span>Weekly check-in with Claude</span>
            <span class="muted small">See which lever to pull this week</span>
          </span>
          <Icon name="next" size={20} />
        </button>
      )}
      {due.waist && (
        <button class="list-row" onClick={() => (bodySheet.value = { kind: 'waist' })}>
          <Icon name="ruler" />
          <span class="list-main grow">
            <span>Measure your waist</span>
            <span class="muted small">{due.lastWaist ? `Monthly · last ${whenText(due.lastWaist, today)}` : 'Once a month'}</span>
          </span>
          <Icon name="next" size={20} />
        </button>
      )}
    </div>
  );
}
