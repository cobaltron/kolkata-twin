export type TimeMode = 'live' | 'historical' | 'event';

/** A stored, replayable window of simulated time (cyclone, monsoon day, ...). */
export interface Scenario {
  id: string;
  label: string;
  /** Epoch ms, inclusive start / exclusive end. */
  start: number;
  end: number;
  /** True when the scenario is a placeholder with no sourced real-world data behind it. */
  synthetic: boolean;
  /** Where the scenario's data comes from; must match an entry in data/SOURCES.md. */
  source: string;
}

/** Immutable snapshot handed to every Layer. Layers must not read any other clock. */
export interface TimeState {
  readonly mode: TimeMode;
  /** Simulated moment, epoch ms UTC. */
  readonly instant: number;
  /** Calendar year of `instant` in IST. Drives "what existed when" filtering. */
  readonly year: number;
  /** Simulated seconds per real second. Always 1 in live mode. */
  readonly speed: number;
  readonly paused: boolean;
  /** Simulated seconds elapsed since the previous tick (0 when paused or after a seek). */
  readonly simDeltaSeconds: number;
  /** Active scenario in event mode, else null. */
  readonly scenario: Scenario | null;
  /** 0..1 position within the scenario in event mode, else 0. */
  readonly scenarioProgress: number;
  /** Incremented on every discontinuity (mode change, scrub, year jump). Stateful sims reset on change. */
  readonly epoch: number;
}

export interface TimeEvents {
  /** Fired once per frame after time advances. */
  tick: TimeState;
  modechange: { mode: TimeMode; previous: TimeMode; state: TimeState };
  /** Fired when the IST calendar year changes, by slider or by playback rollover. */
  yearchange: { year: number; previous: number; state: TimeState };
  /** Fired on any discontinuity in simulated time. */
  seek: { instant: number; reason: 'scrub' | 'mode' | 'year' | 'scenario'; state: TimeState };
  playstate: { paused: boolean; speed: number; state: TimeState };
  scenariochange: { scenario: Scenario; state: TimeState };
  /** Playback reached the end of the scenario; the controller pauses there. */
  scenarioend: { scenario: Scenario; state: TimeState };
}
