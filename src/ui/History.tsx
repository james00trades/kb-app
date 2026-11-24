import { useState } from 'preact/hooks';
import { chosen, moveTime, type SessionLog } from '../engine/engine';
import { copyStatsForClaude, engine, lookAtWorkout, progressView as view, sessions } from '../lib/store';
import { BodyView } from './Body';
import { Icon, Sheet, bellShort, bellText, fmtDay, fmtDuration, fmtTime } from './common';
import { hasBell } from '../engine/schema';

const STATUS_TEXT = { done: 'Done', partial: 'Partial', skipped: 'Skipped', rest: 'Rest day' } as const;

export function History() {
  return (
    <div class="screen">
      <h1>Progress</h1>
      <div class="seg">
        <button class={view.value === 'body' ? 'selected' : ''} onClick={() => (view.value = 'body')}>
          Body
        </button>
        <button class={view.value === 'workouts' ? 'selected' : ''} onClick={() => (view.value = 'workouts')}>
          Workouts
        </button>
      </div>
      <CopyStats />
      {view.value === 'body' ? <BodyView /> : <Workouts />}
    </div>
  );
}

/** One tap copies workouts, weight and waist as text, for James to paste into his chat with Claude (James, Nov 10). */
function CopyStats() {
  const [state, setState] = useState<'' | 'copied' | 'shared' | 'failed'>('');
  const hint = {
    '': 'Workouts, weight and waist as text, to paste into your chat with Claude. No photos.',
    copied: 'Copied. Now paste it into your chat with Claude.',
    shared: 'Sent from the share sheet.',
    failed: "Couldn't copy. Try again.",
  }[state];
  return (
    <div class="copy-stats">
      <button class="pill-btn" onClick={async () => setState(await copyStatsForClaude())}>
        {state === 'copied' ? 'Copied' : 'Copy my stats for Claude'}
      </button>
      <span class="muted small">{hint}</span>
    </div>
  );
}

function Workouts() {
  const [open, setOpen] = useState<SessionLog | null>(null);
  const week = engine.value.pointer.cycle + 1;
  const all = sessions.value;
  const workouts = (w: number) => all.filter((s) => s.session.week === w && (s.status === 'done' || s.status === 'partial'));
  const reps = (w: number) => workouts(w).reduce((sum, s) => sum + s.kbReps, 0);
  const thisReps = reps(week);
  const lastReps = reps(week - 1);
  const change = lastReps > 0 ? Math.round(((thisReps - lastReps) / lastReps) * 100) : null;

  return (
    <>
      <section class="card stats">
        <div class="stat">
          <div class="stat-num">{workouts(week).length}</div>
          <div class="muted small">sessions in Week {week}</div>
        </div>
        <div class="stat">
          <div class="stat-num">{thisReps}</div>
          <div class="muted small">kettlebell reps this week</div>
        </div>
        <div class="stat">
          <div class="stat-num">{week > 1 ? lastReps : '—'}</div>
          <div class="muted small">
            last week{change !== null && ` (${change >= 0 ? '+' : ''}${change}% now)`}
          </div>
        </div>
      </section>
      {change !== null && change > 15 && (
        <div class="note warn">This week's kettlebell reps are more than 15% above last week. The plan's limit is 10–15%.</div>
      )}

      {!all.length && <p class="muted">No sessions yet. Your workouts will show up here.</p>}
      <div class="list">
        {all.map((s) => (
          <button key={s.id} class="list-row history-row" onClick={() => setOpen(s)}>
            <span class="list-main">
              <span>
                {fmtDay(s.date)} · {s.session.day === 'REST' ? 'Rest' : `Day ${s.session.day}`} · Week {s.session.week}
              </span>
              <span class="muted small">
                {STATUS_TEXT[s.status]}
                {s.status === 'done' || s.status === 'partial'
                  ? ` · ${fmtDuration(s.endedAt - s.startedAt)} · effort ${s.effort} · ${s.kbReps} KB reps`
                  : ''}
                {s.status === 'rest' && s.walk ? ' · walked' : ''}
              </span>
            </span>
            {s.pain && <span class="pain-flag">pain</span>}
          </button>
        ))}
      </div>
      {open && <SessionDetail s={open} onClose={() => setOpen(null)} />}
    </>
  );
}

/** Each set's bell when they weren't all the same, and the rest after each set (Nov 23). */
function setBellsAndRests(it: SessionLog['items'][number]): string {
  if (it.plan.kind === 'breath' || it.plan.kind === 'routine') return '';
  const done = it.sets.filter((x) => x.done);
  const bells = done.map((x) => x.bell);
  const mixed = new Set(bells.map(String)).size > 1;
  const out: string[] = [];
  if (mixed) out.push(`bells ${bells.map((b) => (b === null ? '–' : bellShort(b))).join(', ')}`);
  const rests = done.map((x) => x.rest);
  if (rests.some((r) => r !== undefined)) out.push(`rests ${rests.map((r) => (r === undefined ? '–' : fmtTime(r * 1000))).join(', ')}`);
  return out.map((x) => ` · ${x}`).join('');
}

function SessionDetail({ s, onClose }: { s: SessionLog; onClose: () => void }) {
  return (
    <Sheet onClose={onClose} title={`${fmtDay(s.date)} · ${s.session.title}`}>
      <div class="muted">
        {s.session.level ? `${s.session.phaseName} · ` : ''}Week {s.session.week} · {STATUS_TEXT[s.status]}
        {s.effort !== undefined && ` · effort ${s.effort}/10`}
        {s.pain !== undefined && ` · joint pain: ${s.pain ? 'yes' : 'no'}`}
      </div>
      {s.items.length > 0 && (
        <div class="detail-list">
          {s.items.map((it) => {
            const p = chosen(it);
            const done = it.sets.filter((x) => x.done);
            const unit = it.plan.kind === 'time' ? ' s' : '';
            return (
              <div key={it.plan.itemId} class="detail-row">
                <div>{p.name}</div>
                <div class="muted small">
                  {it.plan.kind === 'breath' || it.plan.kind === 'routine'
                    ? done.length
                      ? it.plan.kind === 'breath'
                        ? `${it.plan.breath?.pattern.name ?? 'Breathwork'} ✓`
                        : 'done ✓'
                      : 'not done'
                    : done.length && it.plan.kind === 'circuit'
                      ? `${done.length} round${done.length === 1 ? '' : 's'} of ${done.map((x) => x.actual).join(', ')} each`
                      : done.length && it.plan.kind === 'flow'
                        ? `${done.length} set${done.length === 1 ? '' : 's'} of ${done.map((x) => x.actual).join(', ')} cycles` +
                          (it.plan.perSide ? ' per side' : '') +
                          (hasBell(it.bell) ? ` · ${bellText(it.bell)}` : '')
                    : done.length
                      ? done.map((x) => `${x.actual}${unit}`).join(', ') +
                        (it.plan.perSide ? ` ${it.plan.sideLabel ?? 'per side'}` : '') +
                        (it.bell !== null ? ` · ${bellText(done[done.length - 1].bell ?? it.bell)}` : '')
                      : 'not done'}
                  {setBellsAndRests(it)}
                  {it.choice === 'up' && it.plan.up ? ' · moved up' : ''}
                  {moveTime(it) !== undefined && ` · ${fmtTime(moveTime(it)!)}`}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {s.items.some((it) => it.sets.length > 0) && (
        <button
          class="big-btn"
          onClick={() => {
            onClose();
            lookAtWorkout(`${fmtDay(s.date)} · Week ${s.session.week}`, s.session, s);
          }}
        >
          See the workout <Icon name="next" size={18} />
        </button>
      )}
      <button class="big-btn" onClick={onClose}>Close</button>
    </Sheet>
  );
}
