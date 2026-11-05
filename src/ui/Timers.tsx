import { useState } from 'preact/hooks';
import { data } from '../lib/store';
import { amrapSpec, breathSpec, emomSpec, holdSpec, restSpec, roundsSpec, startTimer } from '../lib/timer';
import { Icon, Stepper, Toggle } from './common';

/** Standalone timers, for anything outside the day's recipe. */
export function Timers() {
  const [rest, setRest] = useState(60);
  const [hold, setHold] = useState(30);
  const [perSide, setPerSide] = useState(false);
  const [rounds, setRounds] = useState(5);
  const [work, setWork] = useState(40);
  const [gap, setGap] = useState(20);
  const [emom, setEmom] = useState(10);
  const [amrap, setAmrap] = useState(20);
  const patternKeys = Object.keys(data.plan.breathPatterns);
  const [pattern, setPattern] = useState(patternKeys[0]);
  const [breathMin, setBreathMin] = useState(4);

  return (
    <div class="screen">
      <h1>Timers</h1>

      <TimerCard title="Rest" hint="Countdown with beeps" onStart={() => startTimer(restSpec(rest))}>
        <Stepper value={rest} onChange={setRest} step={15} min={15} unit=" s" />
      </TimerCard>

      <TimerCard title="Hold" hint="For carries, hangs and mobility positions" onStart={() => startTimer(holdSpec('Hold', hold, perSide))}>
        <Stepper value={hold} onChange={setHold} step={15} min={15} unit=" s" />
        <Toggle on={perSide} onChange={setPerSide} label="Per side (left, then right)" />
      </TimerCard>

      <TimerCard
        title="Interval"
        hint="Work / rest rounds"
        onStart={() => startTimer(roundsSpec('Interval', rounds, work, gap))}
      >
        <div class="mini-label">Rounds</div>
        <Stepper value={rounds} onChange={setRounds} min={1} />
        <div class="mini-label">Work</div>
        <Stepper value={work} onChange={setWork} step={5} min={5} unit=" s" />
        <div class="mini-label">Rest</div>
        <Stepper value={gap} onChange={setGap} step={5} min={0} unit=" s" />
      </TimerCard>

      <TimerCard title="EMOM" hint="A beep at the top of every minute" onStart={() => startTimer(emomSpec(emom))}>
        <Stepper value={emom} onChange={setEmom} min={1} unit=" min" />
      </TimerCard>

      <TimerCard title="AMRAP" hint="As many rounds as possible; tap to count rounds" onStart={() => startTimer(amrapSpec(amrap))}>
        <Stepper value={amrap} onChange={setAmrap} min={1} unit=" min" />
      </TimerCard>

      <TimerCard
        title="Breathwork"
        hint="Paced breathing with a guide circle"
        onStart={() => startTimer(breathSpec(data.plan.breathPatterns[pattern], breathMin))}
      >
        <div class="seg">
          {patternKeys.map((k) => (
            <button key={k} class={pattern === k ? 'selected' : ''} onClick={() => setPattern(k)}>
              {data.plan.breathPatterns[k].name.replace(' breathing', '')}
            </button>
          ))}
        </div>
        <Stepper value={breathMin} onChange={setBreathMin} min={1} unit=" min" />
      </TimerCard>
    </div>
  );
}

function TimerCard(props: { title: string; hint: string; onStart: () => void; children: preact.ComponentChildren }) {
  return (
    <section class="card timer-card">
      <div class="timer-card-head">
        <div>
          <h3>{props.title}</h3>
          <div class="muted small">{props.hint}</div>
        </div>
        <button class="round-btn" aria-label={`Start ${props.title}`} onClick={props.onStart}>
          <Icon name="play" />
        </button>
      </div>
      {props.children}
    </section>
  );
}
