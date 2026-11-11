import { useState } from 'preact/hooks';
import type { Movement, Pattern } from '../engine/schema';
import { data, isUnlocked, moveSheet, unlockMove } from '../lib/store';
import { Icon, Sheet } from './common';

const TIER_NAMES = ['Tier 0 · Prep and mobility', 'Tier 1 · Slow strength', 'Tier 2 · Fast / explosive', 'Tier 3 · Compound and flow'];
const PATTERNS: Pattern[] = ['hinge', 'squat', 'lunge', 'push', 'pull', 'carry', 'rotation', 'mobility', 'compound'];
/** Name plus badge words, so "best guess" or "shoulder" in the search lists those moves. */
const searchText = (m: Movement) => [m.name, m.shoulder && 'shoulder hold', m.guess && 'best guess'].filter(Boolean).join(' ').toLowerCase();

export function Library() {
  const [q, setQ] = useState('');
  const [tier, setTier] = useState<number | null>(null);
  const [pattern, setPattern] = useState<Pattern | null>(null);

  const query = q.trim().toLowerCase();
  const list = data.movements.filter(
    (m) =>
      (tier === null || m.tier === tier) &&
      (pattern === null || m.pattern === pattern) &&
      (!query || searchText(m).includes(query)),
  );

  return (
    <div class="screen">
      <h1>Library</h1>
      <input
        class="search"
        type="search"
        placeholder={`Search ${data.movements.length} moves`}
        value={q}
        onInput={(e) => setQ((e.target as HTMLInputElement).value)}
      />
      <div class="chips">
        <button class={`chip ${tier === null ? 'selected' : ''}`} onClick={() => setTier(null)}>All tiers</button>
        {[0, 1, 2, 3].map((t) => (
          <button key={t} class={`chip ${tier === t ? 'selected' : ''}`} onClick={() => setTier(tier === t ? null : t)}>
            Tier {t}
          </button>
        ))}
      </div>
      <div class="chips">
        {PATTERNS.map((p) => (
          <button key={p} class={`chip ${pattern === p ? 'selected' : ''}`} onClick={() => setPattern(pattern === p ? null : p)}>
            {p}
          </button>
        ))}
      </div>

      {[0, 1, 2, 3].map((t) => {
        const moves = list.filter((m) => m.tier === t);
        if (!moves.length) return null;
        return (
          <section key={t}>
            <h3 class="section-title">{TIER_NAMES[t]}</h3>
            <div class="list">
              {moves.map((m) => {
                const open = isUnlocked(m.id);
                return (
                  <button key={m.id} class="list-row" onClick={() => (moveSheet.value = m.id)}>
                    <span class="list-main">
                      <span class={open ? '' : 'muted'}>{m.name}</span>
                      <span class="muted small">
                        {m.pattern}
                        {m.shoulder && <span class="tag hold">Shoulder hold</span>}
                        {m.guess && <span class="tag guess">Best guess</span>}
                      </span>
                    </span>
                    {!open && <Icon name="lock" size={18} />}
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
      {!list.length && <p class="muted">No moves match.</p>}
    </div>
  );
}

export function MoveSheet() {
  const id = moveSheet.value;
  if (!id) return null;
  const m = data.moveById.get(id);
  if (!m) return null;
  const open = isUnlocked(m.id);
  const close = () => (moveSheet.value = null);
  const related = [...new Set([...(m.related ?? []), ...data.movements.filter((x) => x.related?.includes(m.id)).map((x) => x.id)])];
  return (
    <Sheet onClose={close} title={m.name}>
      <div class="muted">
        Tier {m.tier} · {m.pattern} · {open ? 'Unlocked' : 'Locked'}
        {m.startBell ? ` · Start with the ${m.startBell} lb` : ''}
      </div>
      {m.shoulder && (
        <div class="note warn">
          <b>Shoulder hold.</b> Hard on the shoulders. With a shoulder that's sore or unsteady, use the good arm only, or skip it, until it's been checked.
        </div>
      )}
      {m.guess && (
        <div class="note">
          <b>Best guess.</b> The path and cues were read from the video frames. Check them against the video and say what's off.
        </div>
      )}
      {m.cues?.length ? (
        <ul class="cues">
          {m.cues.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      ) : (
        <p class="muted">Form cues for this move are coming later.</p>
      )}
      <div class="clip-placeholder">Demo clip: coming in version 2</div>
      {m.prereqs?.length ? (
        <>
          <h3>Before this move</h3>
          <div class="chips wrap">
            {m.prereqs.map((p) => (
              <button key={p} class={`chip ${isUnlocked(p) ? '' : 'locked'}`} onClick={() => (moveSheet.value = p)}>
                {!isUnlocked(p) && <Icon name="lock" size={14} />} {data.moveById.get(p)?.name ?? p}
              </button>
            ))}
          </div>
        </>
      ) : null}
      {related.length ? (
        <>
          <h3>Related moves</h3>
          <div class="chips wrap">
            {related.map((r) => (
              <button key={r} class={`chip ${isUnlocked(r) ? '' : 'locked'}`} onClick={() => (moveSheet.value = r)}>
                {!isUnlocked(r) && <Icon name="lock" size={14} />} {data.moveById.get(r)?.name ?? r}
              </button>
            ))}
          </div>
        </>
      ) : null}
      {m.unlockNote && <p class="small muted">{m.unlockNote}</p>}
      {!open && (
        <button
          class="big-btn"
          onClick={() => {
            if (confirm(`Unlock ${m.name}? Only if its prerequisites feel solid: clean sets, no joint pain the next day.`)) void unlockMove(m.id);
          }}
        >
          Unlock this move
        </button>
      )}
      <button class="big-btn" onClick={close}>Close</button>
    </Sheet>
  );
}
