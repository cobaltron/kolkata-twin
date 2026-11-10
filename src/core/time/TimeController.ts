import { Emitter } from '../Emitter';
import { fromIst, toIst, withYear } from './ist';
import type { Scenario, TimeEvents, TimeMode, TimeState } from './types';

export interface TimeControllerOptions {
  /** Wall clock, injectable for tests. */
  now?: () => number;
  minYear: number;
  scenarios?: Scenario[];
}

/**
 * Single source of truth for simulated time.
 *
 *  - live:       instant === wall clock; speed/pause/scrub are ignored.
 *  - historical: free-running clock inside a chosen year; year, day and time of day can be scrubbed.
 *  - event:      clock confined to a stored Scenario window; pauses at the end.
 *
 * The app calls advance() exactly once per frame; nothing else may move time forward.
 */
export class TimeController extends Emitter<TimeEvents> {
  readonly minYear: number;
  private readonly now: () => number;
  private readonly scenarios: Map<string, Scenario>;

  private mode: TimeMode = 'live';
  private instant: number;
  private speed = 1;
  private paused = false;
  private scenario: Scenario | null = null;
  private epoch = 0;
  private simDelta = 0;
  private snapshot: TimeState;

  constructor(options: TimeControllerOptions) {
    super();
    this.now = options.now ?? Date.now;
    this.minYear = options.minYear;
    this.scenarios = new Map((options.scenarios ?? []).map((s) => [s.id, s]));
    this.instant = this.now();
    this.snapshot = this.buildSnapshot();
  }

  get state(): TimeState {
    return this.snapshot;
  }
  get maxYear(): number {
    return toIst(this.now()).year;
  }
  get availableScenarios(): Scenario[] {
    return [...this.scenarios.values()];
  }

  /** Advance simulated time by one frame. `realDtSeconds` is wall time since the last call. */
  advance(realDtSeconds: number): TimeState {
    const previous = this.snapshot;
    let ended: Scenario | null = null;
    if (this.mode === 'live') {
      const t = this.now();
      this.simDelta = Math.max(0, (t - this.instant) / 1000);
      this.instant = t;
    } else if (this.paused) {
      this.simDelta = 0;
    } else {
      let next = this.instant + realDtSeconds * this.speed * 1000;
      if (this.mode === 'event' && this.scenario && next >= this.scenario.end) {
        next = this.scenario.end;
        this.paused = true;
        ended = this.scenario;
      }
      if (this.mode === 'historical') next = this.clampHistorical(next);
      this.simDelta = (next - this.instant) / 1000;
      this.instant = next;
    }
    this.commit(previous);
    if (ended) {
      this.emit('scenarioend', { scenario: ended, state: this.snapshot });
      this.emit('playstate', { paused: true, speed: this.speed, state: this.snapshot });
    }
    this.emit('tick', this.snapshot);
    return this.snapshot;
  }

  setMode(mode: TimeMode): void {
    if (mode === this.mode) return;
    const previous = this.snapshot;
    const previousMode = this.mode;
    this.mode = mode;
    if (mode === 'live') {
      this.instant = this.now();
      this.speed = 1;
      this.paused = false;
      this.scenario = null;
    } else if (mode === 'historical') {
      this.scenario = null;
      this.instant = this.clampHistorical(this.instant);
    } else {
      const first = this.scenario ?? this.scenarios.values().next().value;
      if (!first) {
        this.mode = previousMode;
        throw new Error('TimeController: event mode requires at least one scenario');
      }
      this.scenario = first;
      this.instant = first.start;
      this.paused = false;
    }
    this.discontinuity(previous, 'mode');
    this.emit('modechange', { mode, previous: previousMode, state: this.snapshot });
  }

  /** Historical mode: jump to `year`, keeping month, day and time of day. */
  setYear(year: number): void {
    this.requireMode('historical', 'setYear');
    const y = Math.min(Math.max(Math.round(year), this.minYear), this.maxYear);
    const previous = this.snapshot;
    this.instant = this.clampHistorical(withYear(this.instant, y));
    this.discontinuity(previous, 'year');
  }

  /** Historical mode: set day of year (1..366), keeping year and time of day. */
  setDayOfYear(dayOfYear: number): void {
    this.requireMode('historical', 'setDayOfYear');
    const p = toIst(this.instant);
    this.seekTo(fromIst(p.year, dayOfYear, p.hours));
  }

  /** Historical or event mode: set local (IST) time of day in fractional hours, keeping the date. */
  setTimeOfDay(hours: number): void {
    if (this.mode === 'live') throw new Error('TimeController: setTimeOfDay is not available in live mode');
    const p = toIst(this.instant);
    this.seekTo(fromIst(p.year, p.dayOfYear, Math.min(Math.max(hours, 0), 23.9999)));
  }

  /** Event mode: scrub to a 0..1 position within the active scenario. */
  setScenarioProgress(progress: number): void {
    this.requireMode('event', 'setScenarioProgress');
    const s = this.scenario!;
    this.seekTo(s.start + Math.min(Math.max(progress, 0), 1) * (s.end - s.start));
  }

  /** Event mode: switch to a stored scenario and rewind to its start. */
  loadScenario(id: string): void {
    const s = this.scenarios.get(id);
    if (!s) throw new Error(`TimeController: unknown scenario "${id}"`);
    if (this.mode !== 'event') {
      this.scenario = s;
      this.setMode('event');
    } else {
      const previous = this.snapshot;
      this.scenario = s;
      this.instant = s.start;
      this.paused = false;
      this.discontinuity(previous, 'scenario');
    }
    this.emit('scenariochange', { scenario: s, state: this.snapshot });
  }

  play(): void {
    this.setPaused(false);
  }
  pause(): void {
    this.setPaused(true);
  }

  /** Simulated seconds per real second (> 0). Ignored in live mode. */
  setSpeed(speed: number): void {
    if (this.mode === 'live') return;
    if (!(speed > 0) || !Number.isFinite(speed)) throw new Error('TimeController: speed must be > 0');
    this.speed = speed;
    this.snapshot = this.buildSnapshot();
    this.emit('playstate', { paused: this.paused, speed, state: this.snapshot });
  }

  private setPaused(paused: boolean): void {
    if (this.mode === 'live' || paused === this.paused) return;
    // Pressing play at the end of a scenario restarts it.
    if (!paused && this.mode === 'event' && this.scenario && this.instant >= this.scenario.end) {
      const previous = this.snapshot;
      this.instant = this.scenario.start;
      this.paused = false;
      this.discontinuity(previous, 'scrub');
    } else {
      this.paused = paused;
      this.snapshot = this.buildSnapshot();
    }
    this.emit('playstate', { paused: this.paused, speed: this.speed, state: this.snapshot });
  }

  private seekTo(instant: number): void {
    const previous = this.snapshot;
    let t = instant;
    if (this.mode === 'historical') t = this.clampHistorical(t);
    if (this.mode === 'event' && this.scenario) t = Math.min(Math.max(t, this.scenario.start), this.scenario.end);
    this.instant = t;
    this.discontinuity(previous, 'scrub');
  }

  private clampHistorical(instant: number): number {
    const min = fromIst(this.minYear, 1, 0);
    return Math.min(Math.max(instant, min), this.now());
  }

  private requireMode(mode: TimeMode, method: string): void {
    if (this.mode !== mode) throw new Error(`TimeController: ${method} is only available in ${mode} mode`);
  }

  private discontinuity(previous: TimeState, reason: TimeEvents['seek']['reason']): void {
    this.epoch++;
    this.simDelta = 0;
    this.commit(previous);
    this.emit('seek', { instant: this.instant, reason, state: this.snapshot });
  }

  /** Rebuild the snapshot and emit yearchange if the calendar year moved. */
  private commit(previous: TimeState): void {
    this.snapshot = this.buildSnapshot();
    if (this.snapshot.year !== previous.year) {
      this.emit('yearchange', { year: this.snapshot.year, previous: previous.year, state: this.snapshot });
    }
  }

  private buildSnapshot(): TimeState {
    const s = this.mode === 'event' ? this.scenario : null;
    return Object.freeze({
      mode: this.mode,
      instant: this.instant,
      year: toIst(this.instant).year,
      speed: this.mode === 'live' ? 1 : this.speed,
      paused: this.mode === 'live' ? false : this.paused,
      simDeltaSeconds: this.simDelta,
      scenario: s,
      scenarioProgress: s ? (this.instant - s.start) / (s.end - s.start) : 0,
      epoch: this.epoch,
    });
  }
}
