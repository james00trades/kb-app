import { useState } from 'preact/hooks';
import { chosen, type SessionLog } from '../engine/engine';
import { engine, sessions } from '../lib/store';
import { Sheet, bellText, fmtDay, fmtDuration } from './common';

const STATUS_TEXT = { done: 'Done', partial: 'Partial', skipped: 'Skipped', rest: 'Rest day' } as const;

export function History() {
  const [open, setOpen] = useState<SessionLog | null>(null);
  const week = engine.value.pointer.cycle + 1;
  const all = sessions.value;
  const workouts = (w: number) => all.filter((s) => s.session.week === w && (s.status === 'done' || s.status === 'partial'));
  const reps = (w: number) => workouts(w).reduce((sum, s) => sum + s.kbReps, 0);
  const thisReps = reps(week);
  const lastReps = reps(week - 1);
  const change = lastReps > 0 ? Math.round(((thisReps - lastReps) / lastReps) * 100) : null;

  return (
    <div class="screen">
      <h1>History</h1>
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
    </div>
  );
}

function SessionDetail({ s, onClose }: { s: SessionLog; onClose: () => void }) {
  return (
    <Sheet onClose={onClose} title={`${fmtDay(s.date)} · ${s.session.title}`}>
      <div class="muted">
        Week {s.session.week} · {STATUS_TEXT[s.status]}
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
                    : done.length
                      ? done.map((x) => `${x.actual}${unit}`).join(', ') +
                        (it.plan.perSide ? ` ${it.plan.sideLabel ?? 'per side'}` : '') +
                        (it.bell !== null ? ` · ${bellText(done[done.length - 1].bell ?? it.bell)}` : '')
                      : 'not done'}
                  {it.choice === 'up' && it.plan.up ? ' · moved up' : ''}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <button class="big-btn" onClick={onClose}>Close</button>
    </Sheet>
  );
}
