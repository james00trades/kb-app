import { chosen, type DraftItem } from '../engine/engine';
import { lookAt, moveSheet } from '../lib/store';
import { Icon, prescText } from './common';
import { Parts, SECTION_TITLES, SetBoxes } from './Workout';

/** Another day's workout, or one already done, to look at but not start (James, Nov 24): every move with
 *  its sets as boxes, planned reps and bell, or green with what he did. */
export function WorkoutLook() {
  const l = lookAt.value;
  if (!l) return null;
  let lastSection = '';
  return (
    <div class="screen">
      <header class="workout-head">
        <button
          class="back-btn"
          aria-label="Back"
          onClick={() => {
            lookAt.value = null;
            window.scrollTo(0, 0);
          }}
        >
          <Icon name="back" size={22} />
          Back
        </button>
        <div class="workout-head-text">
          <div class="eyebrow">{l.eyebrow}</div>
          <div class="workout-title">{l.title}</div>
        </div>
      </header>
      {l.note && <div class="note">{l.note}</div>}
      {l.items.map((it) => {
        const heading = it.plan.section !== lastSection ? SECTION_TITLES[it.plan.section] : null;
        lastSection = it.plan.section;
        return (
          <div key={it.plan.itemId}>
            {heading && <h3 class="section-title">{heading}</h3>}
            <LookItem it={it} />
          </div>
        );
      })}
    </div>
  );
}

function LookItem({ it }: { it: DraftItem }) {
  const p = chosen(it);
  return (
    <section class="item-card look">
      <div class="item-top">
        <button class="item-name" disabled={!p.move} onClick={() => p.move && (moveSheet.value = p.move)}>
          {p.name} {p.move && <Icon name="info" size={16} />}
        </button>
        {it.skipped && <span class="muted small">skipped</span>}
      </div>
      <div class="item-presc">{prescText(it.plan, { ...p, bell: it.bell })}</div>
      {it.plan.parts && <Parts it={it} count={p.target} />}
      {!it.skipped && <SetBoxes it={it} />}
    </section>
  );
}
