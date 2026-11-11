// Weekly check-in with Claude: the app sends the whole journey so far (summarized week by week
// from day one, with the last few weeks in detail, every past check-in, and photo sets from the
// start, a month ago and now) to the Claude API with James's own key. Claude answers with the
// patterns it sees, the big picture, and which lever to pull: more training intensity, or diet.
// Nothing personal is written in this file (the repo is public); "About you" lives on the phone.
import { z } from 'zod';
import { daysBetween, round1, type WeightPoint } from '../engine/body';
import { chosen, type SessionLog } from '../engine/engine';
import { addDays } from '../engine/streak';
import type { BodyEntry, Daily, Pose } from './db';

export const CHECKIN_MODEL = 'claude-opus-5-5';
export const CHECKIN_EVERY_DAYS = 7;
/** Days shown in full detail; everything older is summarized by week. */
const DETAIL_WEIGHT_DAYS = 28;
const DETAIL_TRAINING_DAYS = 14;
/** Claude Opus 5.5 list prices per million tokens (Nov 2026), for the "about 20¢" line. */
const PRICE_IN = 4;
const PRICE_OUT = 20;

export const Lever = z.enum(['intensity', 'diet', 'both', 'stay']);
export type Lever = z.infer<typeof Lever>;

export const CheckInResult = z.object({
  headline: z.string(),
  bigPicture: z.string(),
  patterns: z.array(z.string()),
  lever: Lever,
  leverWhy: z.string(),
  actions: z.array(z.string()),
  photos: z.string(),
  dataGaps: z.string(),
});
export type CheckInResult = z.infer<typeof CheckInResult>;

export interface CheckInImage {
  label: string;
  /** Base64 JPEG. */
  data: string;
}

export interface CheckIn {
  id: string;
  date: string;
  at: number;
  model: string;
  note?: string;
  result: CheckInResult;
  usage: { input: number; output: number };
}

export const LEVER_TEXT: Record<Lever, string> = {
  intensity: 'Raise the training intensity',
  diet: 'Fix the diet',
  both: 'Both: training and diet',
  stay: 'Stay the course',
};

export const SCHEMA = {
  type: 'object',
  properties: {
    headline: { type: 'string', description: 'One short sentence: the single most important thing right now.' },
    bigPicture: {
      type: 'string',
      description:
        'Two or three sentences on the whole journey since day one: total change, whether the pace is realistic for this stage, and any plateau (how long, in what).',
    },
    patterns: {
      type: 'array',
      items: { type: 'string' },
      description: '2 to 4 short observations, each tied to the numbers (trend, plateaus, consistency, effort, lifts, photos).',
    },
    lever: {
      type: 'string',
      enum: ['intensity', 'diet', 'both', 'stay'],
      description: 'Which lever to pull next week. "stay" means things are on track: keep going.',
    },
    leverWhy: { type: 'string', description: 'One or two sentences on why that lever, using the long-run picture as well as this week.' },
    actions: {
      type: 'array',
      items: { type: 'string' },
      description: '1 to 3 specific things to do in the coming week.',
    },
    photos: { type: 'string', description: 'One or two sentences on visible change in the photos, or an empty string if none were sent.' },
    dataGaps: { type: 'string', description: 'What data is missing or too thin to be sure, or an empty string.' },
  },
  required: ['headline', 'bigPicture', 'patterns', 'lever', 'leverWhy', 'actions', 'photos', 'dataGaps'],
  additionalProperties: false,
};

export const SYSTEM = `You are a strength coach doing a weekly check-in for someone on a long kettlebell journey, tracked in a training app. They have two levers they will pull based on what you say: (a) raise training intensity, or (b) fix their diet. Spot the patterns fast and tell them which lever to pull.

You get the whole journey from the first day: weekly summaries from the start, the last few weeks in detail, how each lift has progressed, every earlier check-in, and photo sets from the start, about a month ago and now. Use all of it. Good advice here depends on the long run, not just this week.

Assume the goal is to lose fat while getting stronger, unless the user's own notes say otherwise.

Reading the data:
- Weight: judge the 7-day average and the weekly averages, not single days. Single weigh-ins swing with water, salt and food timing.
- Plateaus: look for a weight trend, waist, or lift that has stopped moving for several weeks, and say how long it has been flat. A flat stretch right after a change in training or diet can be normal; a long one is the signal to pull a lever.
- Expected progress: judge the pace since the start against what is realistic for someone at this stage of training (early weeks, months in, or years in). Say plainly if they are ahead, on pace, or behind, and if a goal in their notes looks too fast or too slow.
- Waist and photos change slowly. Treat small differences cautiously, and differences in lighting, pose or distance as noise.
- Training: consistency over the weeks, effort ratings against the program's target, kettlebell reps per week, whether lifts are still moving up, and joint-pain flags.
- Earlier check-ins: check whether the advice was followed and whether it worked. Don't repeat the same advice week after week if it isn't working; change the approach and say why.

Choosing the lever:
- "diet" when training is consistent and effort is on target but the weight and waist trend has stalled or is too slow.
- "intensity" when the trend or the lifts are stalling, training effort or volume is below what the program allows, and the body is handling the work (no joint pain).
- "both" when both are clearly lagging. "stay" when the trend is moving at a good pace: say so plainly and encourage them.

Rules:
- Intensity suggestions must fit the program: move up one dial at a time (harder variation, heavier bell, faster tempo, or more volume); weekly kettlebell volume up no more than 10 to 15 percent; if joint pain was reported, hold volume rather than increase it. Do not invent a new program or change its overall structure.
- Diet suggestions should be simple, specific habits they can start this week. No crash diets or extreme restriction.
- If you see something that could be a health concern (very fast unexplained weight loss, pain that keeps coming back), say they should check with a doctor.
- If the data is thin (few weigh-ins, no photos, few workouts, early in the journey), say so in dataGaps and keep the call tentative.
- Write plainly for a non-expert: short sentences, no jargon, no filler. Keep every item to one or two sentences.`;

// ---------- The report sent to Claude (pure, so it can be tested) ----------

export interface ReportInput {
  today: string;
  program: {
    name: string;
    week: number;
    effort?: string;
    rotation: string[];
    phases: { name: string; weeks: [number, number]; effort?: string }[];
  };
  about: string;
  note: string;
  streak: { current: number; best: number };
  weights: WeightPoint[];
  body: BodyEntry[];
  sessions: SessionLog[];
  daily: Record<string, Daily>;
  /** Every earlier check-in, newest first. */
  checkins: CheckIn[];
  photoSets: { label: string; date: string; poses: Pose[] }[];
  /** Rest between sets from Settings (one setting for every move). */
  restSeconds?: number;
  /** Set for the copy James pastes into a chat with Claude: no pictures, only the days photos were taken. */
  copyPhotoDates?: string[];
}

const STATUS_WORD = { done: 'done (every move)', partial: 'ended early', skipped: 'skipped', rest: 'rest day' } as const;

const signed = (n: number) => `${n > 0 ? '+' : ''}${n.toFixed(1)}`;
const avg = (ns: number[]) => ns.reduce((a, b) => a + b, 0) / ns.length;
const trained = (s: SessionLog) => s.status === 'done' || s.status === 'partial';

/** One line per main move: "3×8/side @45 lb". */
function moveText(it: SessionLog['items'][number]): { name: string; text: string } {
  const p = chosen(it);
  const unit = it.plan.kind === 'time' ? ' s' : '';
  const side = it.plan.perSide ? '/side' : '';
  const bell = it.bell === null ? '' : it.bell === 'BW' ? ' bodyweight' : ` @${it.bell} lb`;
  return { name: p.name, text: `${p.sets}×${p.target}${unit}${side}${bell}` };
}

function sessionLine(s: SessionLog, daily?: Daily): string {
  const parts = [`${s.date}`, s.session.day === 'REST' ? 'Rest day' : `Day ${s.session.day} (${s.session.title})`, STATUS_WORD[s.status]];
  if (trained(s)) {
    parts.push(`effort ${s.effort ?? '?'}/10`);
    parts.push(`${Math.round((s.endedAt - s.startedAt) / 60000)} min`);
    parts.push(`${s.kbReps} kettlebell reps`);
    parts.push(s.pain ? 'JOINT PAIN reported' : 'no joint pain');
  }
  if (s.status === 'rest') parts.push(s.walk ? 'walked' : 'no walk logged');
  const warm = daily?.warmup || daily?.morning;
  parts.push(`warm-up ${warm ? 'done' : 'not done'}`, `evening holds ${daily?.evening ? 'done' : 'not done'}`);
  let line = `- ${parts.join(' · ')}`;
  const moves = s.items
    .filter((it) => it.plan.section === 'main' && !it.skipped)
    .map((it) => {
      const done = it.sets.filter((x) => x.done);
      const unit = it.plan.kind === 'time' ? 's' : '';
      const m = moveText(it);
      const up = it.choice === 'up' && it.plan.up ? ' (moved up)' : '';
      return `${m.name} ${done.length}/${it.sets.length} sets [${done.map((x) => `${x.actual}${unit}`).join(', ')}] planned ${m.text}${up}`;
    });
  if (moves.length) line += `\n    ${moves.join('; ')}`;
  return line;
}

/** 7-day blocks ending today, oldest first, back to the start of the journey. */
function weekBlocks(start: string, today: string): { n: number; from: string; to: string }[] {
  const count = Math.max(1, Math.ceil((daysBetween(start, today) + 1) / 7));
  const out: { n: number; from: string; to: string }[] = [];
  for (let k = count - 1; k >= 0; k--) {
    const to = addDays(today, -7 * k);
    out.push({ n: count - k, from: addDays(to, -6), to });
  }
  return out;
}

/** Each main move's prescription over time: only the dates it changed. */
export function moveHistory(sessions: SessionLog[]): string[] {
  const byMove = new Map<string, { date: string; text: string }[]>();
  for (const s of [...sessions].filter(trained).sort((a, b) => a.startedAt - b.startedAt)) {
    for (const it of s.items) {
      if (it.plan.section !== 'main' || it.skipped || !it.sets.some((x) => x.done)) continue;
      const m = moveText(it);
      const steps = byMove.get(m.name) ?? [];
      if (steps[steps.length - 1]?.text !== m.text) steps.push({ date: s.date, text: m.text });
      byMove.set(m.name, steps);
    }
  }
  return [...byMove].map(([name, steps]) => {
    const last = sessions.filter((s) => trained(s) && s.items.some((it) => chosen(it).name === name)).map((s) => s.date).sort().pop();
    return `- ${name}: ${steps.map((st) => `${st.date} ${st.text}`).join(' → ')} (last done ${last})`;
  });
}

export function buildReport(r: ReportInput): string {
  const out: string[] = [];
  const firsts = [
    r.weights[0]?.date,
    r.body.map((b) => b.date).sort()[0],
    r.sessions.map((s) => s.date).sort()[0],
    r.photoSets.map((p) => p.date).sort()[0],
  ].filter((d): d is string => !!d);
  const start = firsts.length ? firsts.sort()[0] : r.today;
  const weeksIn = Math.floor(daysBetween(start, r.today) / 7) + 1;

  out.push(r.copyPhotoDates ? `Stats copied from the kettlebell app on ${r.today}.` : `Check-in date: ${r.today}`);
  out.push(`Journey started: ${start} (week ${weeksIn} of the journey).`);
  out.push(
    `Program: now in "${r.program.name}", program week ${r.program.week}${r.program.effort ? `, target effort ${r.program.effort}` : ''}. Rotation: ${r.program.rotation.join(', ')} (missed days don't skip workouts; the rotation picks up where it left off).`,
  );
  out.push(
    `Program phases loaded so far: ${r.program.phases.map((p) => `${p.name} (weeks ${p.weeks[0]}–${p.weeks[1]}${p.effort ? `, effort ${p.effort}` : ''})`).join('; ')}. More phases get added as the journey goes on.`,
  );
  if (r.restSeconds !== undefined) out.push(`Rest between sets: ${r.restSeconds} s (one setting for every move).`);
  out.push(`About the user: ${r.about.trim() || 'not given'}`);
  out.push(`User's note this week: ${r.note.trim() || 'none'}`);
  out.push(
    `Streak: ${r.streak.current} day(s) in a row (best ${r.streak.best}). A day counts only when the warm-up and the full workout (or rest-day wake-up and walk) are both done; the evening holds don't count toward it (since Nov 10, 2026).`,
  );

  // Where they started and where they are
  const w = r.weights;
  const waists = r.body.filter((b) => typeof b.waist === 'number').sort((a, b) => (a.date < b.date ? -1 : 1));
  out.push('', 'SINCE THE START');
  if (w.length) {
    const first = w[0];
    const last = w[w.length - 1];
    out.push(
      `- Weight: first weigh-in ${first.weight.toFixed(1)} lb (${first.date}); current 7-day average ${last.avg.toFixed(1)} lb (${last.date}); change ${signed(last.avg - first.weight)} lb over ${Math.max(1, Math.round(daysBetween(first.date, last.date) / 7))} week(s).`,
    );
  } else out.push('- Weight: no weigh-ins yet');
  if (waists.length) {
    const a = waists[0];
    const b = waists[waists.length - 1];
    out.push(`- Waist: ${a.waist} in (${a.date}) → ${b.waist} in (${b.date}).`);
  } else out.push('- Waist: no measurements yet');
  out.push(`- Workouts: ${r.sessions.filter((s) => s.status === 'done').length} full, ${r.sessions.filter((s) => s.status === 'partial').length} ended early, ${r.sessions.filter((s) => s.status === 'skipped').length} skipped.`);

  // Week by week, the whole way
  const blocks = weekBlocks(start, r.today);
  out.push('', 'WEEK BY WEEK SINCE THE START (7-day blocks ending today, oldest first)');
  for (const b of blocks) {
    const ws = w.filter((p) => p.date >= b.from && p.date <= b.to).map((p) => p.weight);
    const wx = waists.filter((x) => x.date >= b.from && x.date <= b.to).map((x) => x.waist!);
    const ss = r.sessions.filter((s) => s.date >= b.from && s.date <= b.to);
    const count = (st: SessionLog['status']) => ss.filter((s) => s.status === st).length;
    const efforts = ss.filter((s) => trained(s) && typeof s.effort === 'number').map((s) => s.effort!);
    const allThree = new Set(
      ss
        .filter((s) => (s.status === 'done' || s.status === 'rest') && r.daily[s.date]?.evening && (r.daily[s.date]?.warmup || r.daily[s.date]?.morning))
        .map((s) => s.date),
    ).size;
    const weight = ws.length
      ? `weight avg ${round1(avg(ws)).toFixed(1)} (${ws.length} weigh-ins, ${Math.min(...ws).toFixed(1)}–${Math.max(...ws).toFixed(1)})`
      : 'no weigh-ins';
    const pain = ss.filter((s) => s.pain).length;
    out.push(
      `- Week ${b.n} (${b.from} to ${b.to}): ${weight}${wx.length ? `; waist ${wx.join(', ')} in` : ''}; ${count('done')} full workouts, ${count('partial')} ended early, ${count('skipped')} skipped, ${count('rest')} rest days; ${ss.reduce((n, s) => n + s.kbReps, 0)} kettlebell reps${efforts.length ? `; effort avg ${round1(avg(efforts))}` : ''}${pain ? `; JOINT PAIN ${pain}×` : ''}; ${allThree} day(s) with all three parts done`,
    );
  }

  // Lifts over time
  out.push('', 'HOW EACH MOVE HAS PROGRESSED (planned sets × reps and bell, only when it changed)');
  const moves = moveHistory(r.sessions);
  if (!moves.length) out.push('- no workouts yet');
  out.push(...moves);

  // Recent detail
  const fromW = addDays(r.today, -(DETAIL_WEIGHT_DAYS - 1));
  out.push('', `WEIGHT, LAST ${DETAIL_WEIGHT_DAYS} DAYS (lb) — date: weigh-in / 7-day average`);
  const recentW = w.filter((p) => p.date >= fromW);
  if (!recentW.length) out.push('- no weigh-ins');
  for (const p of recentW) out.push(`- ${p.date}: ${p.weight.toFixed(1)} / ${p.avg.toFixed(1)}`);

  const fromT = addDays(r.today, -(DETAIL_TRAINING_DAYS - 1));
  out.push('', `TRAINING, LAST ${DETAIL_TRAINING_DAYS} DAYS (oldest first; minutes = the workout itself with its breathwork, warm-up not included)`);
  const recent = r.sessions.filter((s) => s.date >= fromT).sort((a, b) => a.startedAt - b.startedAt);
  if (!recent.length) out.push('- nothing logged');
  for (const s of recent) out.push(sessionLine(s, r.daily[s.date]));
  const logged = new Set(recent.map((s) => s.date));
  let empty = 0;
  for (let d = fromT; d < r.today; d = addDays(d, 1)) if (d >= start && !logged.has(d)) empty++;
  out.push(`Days in that stretch (before today) with nothing logged: ${empty}.`);

  // Every earlier check-in
  out.push('', 'EARLIER CHECK-INS (oldest first)');
  if (!r.checkins.length) out.push('- none: this is the first check-in');
  for (const c of [...r.checkins].reverse()) {
    out.push(
      `- ${c.date}: lever "${c.result.lever}". ${c.result.headline} Actions: ${c.result.actions.join(' | ')}${c.note ? ` (user's note that week: ${c.note})` : ''}`,
    );
  }

  out.push('', 'PHOTOS');
  if (r.copyPhotoDates) {
    out.push(`- not included in this copy. Days with photos: ${r.copyPhotoDates.join(', ') || 'none yet'}`);
    return out.join('\n');
  }
  if (!r.photoSets.length) out.push('- none yet');
  for (const s of r.photoSets) out.push(`- ${s.label} (${s.date}): ${s.poses.join(', ')}, attached above in that order`);
  return out.join('\n');
}

/** Rough cost in US dollars, from the token counts. */
export function costOf(usage: { input: number; output: number }): number {
  return (usage.input * PRICE_IN + usage.output * PRICE_OUT) / 1_000_000;
}

export function checkInDue(list: CheckIn[], today: string): boolean {
  const last = list[0];
  return !last || daysBetween(last.date, today) >= CHECKIN_EVERY_DAYS;
}

/** Which photo sets to send: the first, the one closest to 4 weeks ago, and the latest. */
export function pickPhotoDates(dates: string[], today: string): { label: string; date: string }[] {
  const sorted = [...new Set(dates)].sort();
  if (!sorted.length) return [];
  const first = sorted[0];
  const latest = sorted[sorted.length - 1];
  const monthAgo = [...sorted].reverse().find((d) => d <= addDays(today, -21) && d !== first && d !== latest);
  const out = [{ label: sorted.length === 1 ? 'Photo set' : 'First photo set', date: first }];
  if (monthAgo) out.push({ label: 'Photo set from about a month ago', date: monthAgo });
  if (latest !== first) out.push({ label: 'Latest photo set', date: latest });
  return out;
}
