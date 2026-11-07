import type { ComponentChildren } from 'preact';
import type { PlannedItem, Prescription } from '../engine/engine';
import type { Bell } from '../engine/schema';

export function bellText(b: Bell | null | undefined): string {
  if (b === null || b === undefined) return '';
  return b === 'BW' ? 'bodyweight' : `${b} lb`;
}

export function bellShort(b: Bell): string {
  return b === 'BW' ? 'BW' : String(b);
}

export function sideText(item: PlannedItem): string {
  return item.perSide ? ` ${item.sideLabel ?? 'per side'}` : '';
}

/** "3 × 8 per side · 45 lb" */
export function prescText(item: PlannedItem, p: Prescription, withBell = true): string {
  let s: string;
  if (item.kind === 'breath' && item.breath) {
    const steps = item.breath.pattern.steps.map(([k, n]) => `${k} ${n}`).join(' · ');
    return `${item.breath.minutes} min · ${steps}`;
  } else if (item.kind === 'routine' && item.routine) {
    const r = item.routine;
    return `${fmtSeconds(r.seconds)}${r.transition ? '' : ', no breaks'} · ${r.stations.map((st) => st.label).join(', ')}`;
  } else if (item.kind === 'time') {
    s = p.sets === 1 ? `${p.target} s` : `${p.sets} × ${p.target} s`;
  } else {
    s = p.sets === 1 ? `${p.target} reps` : `${p.sets} × ${p.target}`;
  }
  s += sideText(item);
  if (p.range && p.target < p.range[1]) s += ` (up to ${p.range[1]})`;
  const b = bellText(p.bell);
  if (withBell && b) s += ` · ${b}`;
  return s;
}

/** What changes when moving up, e.g. "9 reps (was 8)" or "25 lb (was bodyweight)". */
export function upText(item: PlannedItem): string {
  const { stay, up } = item;
  if (!up) return '';
  const unit = item.kind === 'time' ? ' s' : ' reps';
  const parts: string[] = [];
  if (up.target !== stay.target) parts.push(`${up.target}${unit} (was ${stay.target})`);
  if (up.bell !== stay.bell) parts.push(`${bellText(up.bell)} (was ${bellText(stay.bell)})`);
  if (up.sets !== stay.sets) parts.push(`${up.sets} sets (was ${stay.sets})`);
  return parts.join(', ');
}

/** 450 → "7 min 30 s", 300 → "5 min", 45 → "45 s". */
export function fmtSeconds(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  if (!m) return `${s} s`;
  return s ? `${m} min ${s} s` : `${m} min`;
}

export function fmtDuration(ms: number): string {
  const min = Math.round(ms / 60000);
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`;
}

export function fmtDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

export function daysAgo(ms: number): string {
  const days = Math.floor((Date.now() - ms) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

export function Sheet(props: { onClose: () => void; children: ComponentChildren; title?: string }) {
  return (
    <div class="sheet-backdrop" onClick={props.onClose}>
      <div class="sheet" onClick={(e) => e.stopPropagation()} role="dialog">
        <div class="sheet-grip" />
        {props.title && <h2 class="sheet-title">{props.title}</h2>}
        {props.children}
      </div>
    </div>
  );
}

export function Stepper(props: { value: number; onChange: (v: number) => void; step?: number; min?: number; unit?: string }) {
  const step = props.step ?? 1;
  const min = props.min ?? 0;
  return (
    <div class="stepper">
      <button class="step-btn" aria-label="less" onClick={() => props.onChange(Math.max(min, props.value - step))}>−</button>
      <div class="step-value">
        {props.value}
        {props.unit && <span class="step-unit">{props.unit}</span>}
      </div>
      <button class="step-btn" aria-label="more" onClick={() => props.onChange(props.value + step)}>+</button>
    </div>
  );
}

export function Toggle(props: { on: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <button class="row toggle-row" onClick={() => props.onChange(!props.on)} aria-pressed={props.on}>
      <span>
        <span class="row-label">{props.label}</span>
        {props.hint && <span class="row-hint">{props.hint}</span>}
      </span>
      <span class={`switch ${props.on ? 'on' : ''}`}><span /></span>
    </button>
  );
}

const ICONS: Record<string, string> = {
  today: 'M7 3v3M17 3v3M4 8h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM9 14l2 2 4-4',
  timers: 'M10 2h4M12 14l3-3M12 22a8 8 0 1 0 0-16 8 8 0 0 0 0 16z',
  library: 'M4 4h6a2 2 0 0 1 2 2v14a2 2 0 0 0-2-2H4zM20 4h-6a2 2 0 0 0-2 2v14a2 2 0 0 1 2-2h6z',
  history: 'M4 20V10M10 20V4M16 20v-8M22 20H2',
  settings:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01',
  lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4',
  check: 'M5 12l5 5L20 7',
  play: 'M7 4l13 8-13 8z',
  pause: 'M7 4h4v16H7zM13 4h4v16h-4z',
  close: 'M6 6l12 12M18 6L6 18',
  up: 'M12 19V5M5 12l7-7 7 7',
  back: 'M15 18l-6-6 6-6',
  next: 'M9 6l6 6-6 6',
  circle: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
  // Flame, from Lucide (ISC license)
  flame:
    'M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z',
};

export function Icon(props: { name: keyof typeof ICONS | string; size?: number; filled?: boolean }) {
  const s = props.size ?? 24;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill={props.filled ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d={ICONS[props.name]} />
    </svg>
  );
}
