import { daysInYear, formatIst, fromIst, toIst } from '../core/time/ist';
import type { TimeController } from '../core/time/TimeController';
import type { TimeMode, TimeState } from '../core/time/types';
import { el } from './dom';

const SPEEDS: Array<[number, string]> = [
  [1, '1× real time'],
  [60, '1 min / s'],
  [600, '10 min / s'],
  [3600, '1 hour / s'],
  [86400, '1 day / s'],
];
const MODES: Array<[TimeMode, string]> = [
  ['live', 'Live'],
  ['historical', 'Historical'],
  ['event', 'Event replay'],
];

interface Slider {
  row: HTMLElement;
  input: HTMLInputElement;
  output: HTMLOutputElement;
  dragging: boolean;
}

/** Mode switch, transport controls and scrubbers. Purely a view over TimeController. */
export class TimeBar {
  private readonly modeButtons = new Map<TimeMode, HTMLButtonElement>();
  private readonly readout = el('span', { class: 'readout' });
  private readonly badge = el('span', { class: 'badge', hidden: true }, 'SYNTHETIC');
  private readonly playButton = el('button', { type: 'button', 'aria-label': 'Play or pause' });
  private readonly speedSelect = el('select', { 'aria-label': 'Playback speed' });
  private readonly scenarioSelect = el('select', { 'aria-label': 'Scenario' });
  private readonly hint = el('span', { class: 'hint' });
  private readonly year: Slider;
  private readonly day: Slider;
  private readonly hour: Slider;
  private readonly progress: Slider;
  private lastPaint = 0;

  constructor(root: HTMLElement, time: TimeController) {
    root.classList.add('panel');

    const seg = el('div', { class: 'seg', role: 'group', 'aria-label': 'Time mode' });
    for (const [mode, label] of MODES) {
      const b = el('button', { type: 'button' }, label);
      b.addEventListener('click', () => time.setMode(mode));
      this.modeButtons.set(mode, b);
      seg.append(b);
    }
    for (const [value, label] of SPEEDS) this.speedSelect.append(el('option', { value }, label));
    this.speedSelect.value = '600';
    this.speedSelect.addEventListener('change', () => time.setSpeed(Number(this.speedSelect.value)));
    this.playButton.addEventListener('click', () => (time.state.paused ? time.play() : time.pause()));
    for (const s of time.availableScenarios) this.scenarioSelect.append(el('option', { value: s.id }, s.label));
    this.scenarioSelect.addEventListener('change', () => time.loadScenario(this.scenarioSelect.value));

    this.year = this.slider('Year', time.minYear, time.maxYear, 1, (v) => time.setYear(v));
    this.day = this.slider('Date', 1, 366, 1, (v) => time.setDayOfYear(v));
    this.hour = this.slider('Time of day', 0, 23.98, 0.02, (v) => time.setTimeOfDay(v));
    this.progress = this.slider('Scenario', 0, 1, 0.001, (v) => time.setScenarioProgress(v));

    root.append(
      el('div', { class: 'tb-row' }, seg, this.readout, this.badge, el('span', { class: 'spacer' }), this.playButton, this.speedSelect),
      el('div', { class: 'tb-row' }, this.scenarioSelect, this.hint),
      this.year.row,
      this.day.row,
      this.hour.row,
      this.progress.row,
    );

    time.on('modechange', ({ state }) => {
      if (state.mode !== 'live') time.setSpeed(Number(this.speedSelect.value));
      this.paint(time.state, true);
    });
    time.on('playstate', ({ state }) => this.paint(state, true));
    time.on('seek', ({ state }) => this.paint(state, true));
    time.on('tick', (state) => this.paint(state, false));
    this.paint(time.state, true);
  }

  private slider(label: string, min: number, max: number, step: number, onInput: (v: number) => void): Slider {
    const input = el('input', { type: 'range', min, max, step, 'aria-label': label });
    const output = el('output');
    const s: Slider = { row: el('div', { class: 'slider' }, el('label', {}, label), input, output), input, output, dragging: false };
    input.addEventListener('input', () => onInput(Number(input.value)));
    input.addEventListener('pointerdown', () => (s.dragging = true));
    const release = (): void => void (s.dragging = false);
    input.addEventListener('pointerup', release);
    input.addEventListener('pointercancel', release);
    input.addEventListener('blur', release);
    return s;
  }

  private paint(state: TimeState, force: boolean): void {
    const now = performance.now();
    if (!force && now - this.lastPaint < 100) return; // 10 Hz is plenty for text and thumbs
    this.lastPaint = now;

    const { mode } = state;
    for (const [m, b] of this.modeButtons) b.setAttribute('aria-pressed', String(m === mode));
    this.readout.textContent = formatIst(state.instant);
    this.badge.hidden = !(state.scenario?.synthetic ?? false);

    const live = mode === 'live';
    this.playButton.textContent = live ? '● Live' : state.paused ? '▶ Play' : '❚❚ Pause';
    this.playButton.disabled = live;
    this.speedSelect.disabled = live;

    this.scenarioSelect.hidden = mode !== 'event';
    this.year.row.hidden = this.day.row.hidden = mode !== 'historical';
    this.hour.row.hidden = live;
    this.progress.row.hidden = mode !== 'event';
    this.hint.textContent = live
      ? 'Tracking the wall clock. Switch to Historical or Event replay to scrub time.'
      : mode === 'historical'
        ? 'Phase 0 shows the present-day city in every year; time-aware layers arrive from Phase 3.'
        : (state.scenario?.synthetic ?? false)
          ? 'Placeholder window with no real event data behind it.'
          : `Source: ${state.scenario?.source ?? ''}`;

    const p = toIst(state.instant);
    this.set(this.year, p.year, String(p.year));
    this.day.input.max = String(daysInYear(p.year));
    this.set(this.day, p.dayOfYear, formatIst(fromIst(p.year, p.dayOfYear, 0)).split(',')[0]!);
    const hh = Math.floor(p.hours), mm = Math.floor((p.hours - hh) * 60);
    this.set(this.hour, p.hours, `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`);
    this.set(this.progress, state.scenarioProgress, `${(state.scenarioProgress * 100).toFixed(1)} %`);
  }

  private set(s: Slider, value: number, text: string): void {
    if (!s.dragging) s.input.value = String(value);
    s.output.textContent = text;
  }
}
