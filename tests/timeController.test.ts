import { describe, expect, it } from 'vitest';
import { fromIst, toIst, withYear } from '../src/core/time/ist';
import { TimeController } from '../src/core/time/TimeController';
import type { Scenario, TimeEvents } from '../src/core/time/types';

const T0 = Date.UTC(2026, 10, 10, 6, 30); // 10 Nov 2026, 12:00 IST
const SCENARIO: Scenario = { id: 's', label: 'test', start: 1_000_000, end: 1_000_000 + 3600_000, synthetic: true, source: 'test' };

function make() {
  let wall = T0;
  const time = new TimeController({ now: () => wall, minYear: 1873, scenarios: [SCENARIO] });
  const log: Array<keyof TimeEvents> = [];
  for (const type of ['modechange', 'yearchange', 'seek', 'playstate', 'scenariochange', 'scenarioend'] as const) {
    time.on(type, () => log.push(type));
  }
  return { time, log, tickWall: (ms: number) => (wall += ms) };
}

describe('IST calendar helpers', () => {
  it('converts across the UTC date line', () => {
    const p = toIst(Date.UTC(2024, 11, 31, 19, 0)); // 00:30 IST on 1 Jan 2025
    expect([p.year, p.month, p.day, p.dayOfYear]).toEqual([2025, 1, 1, 1]);
    expect(p.hours).toBeCloseTo(0.5, 9);
  });
  it('round-trips, including years on the historical slider', () => {
    for (const year of [1873, 1900, 2024]) {
      const p = toIst(fromIst(year, 60, 13.25));
      expect([p.year, p.dayOfYear]).toEqual([year, 60]);
      expect(p.hours).toBeCloseTo(13.25, 9);
    }
  });
  it('maps 29 Feb to 28 Feb in a non-leap year', () => {
    const p = toIst(withYear(fromIst(2024, 60, 9), 1900)); // day 60 of 2024 is 29 Feb
    expect([p.year, p.month, p.day]).toEqual([1900, 2, 28]);
  });
});

describe('TimeController', () => {
  it('live mode tracks the wall clock and ignores speed and pause', () => {
    const { time, tickWall } = make();
    time.setSpeed(3600);
    time.pause();
    tickWall(5000);
    const s = time.advance(0.016);
    expect(s.mode).toBe('live');
    expect(s.instant).toBe(T0 + 5000);
    expect(s.simDeltaSeconds).toBeCloseTo(5, 9);
    expect([s.speed, s.paused]).toEqual([1, false]);
    expect(() => time.setYear(1900)).toThrow();
  });

  it('historical mode advances by dt x speed and stops when paused', () => {
    const { time } = make();
    time.setMode('historical');
    time.setYear(1900);
    time.setSpeed(3600);
    const before = time.state.instant;
    expect(time.advance(2).instant).toBe(before + 7200_000);
    expect(time.state.simDeltaSeconds).toBe(7200);
    time.pause();
    expect(time.advance(2).instant).toBe(before + 7200_000);
    expect(time.state.simDeltaSeconds).toBe(0);
  });

  it('setYear keeps the date and time of day, clamps to the slider range, and emits events', () => {
    const { time, log } = make();
    time.setMode('historical');
    log.length = 0;
    const epoch = time.state.epoch;
    time.setYear(1873);
    const p = toIst(time.state.instant);
    expect([p.year, p.month, p.day]).toEqual([1873, 11, 10]);
    expect(p.hours).toBeCloseTo(12, 9);
    expect(log).toEqual(['yearchange', 'seek']);
    expect(time.state.epoch).toBe(epoch + 1);
    time.setYear(1500);
    expect(time.state.year).toBe(1873);
    time.setYear(3000);
    expect(time.state.year).toBe(2026);
    expect(time.state.instant).toBeLessThanOrEqual(T0); // never ahead of the present
  });

  it('emits yearchange when playback rolls over New Year', () => {
    const { time, log } = make();
    time.setMode('historical');
    time.setYear(1950);
    time.setDayOfYear(365);
    time.setTimeOfDay(23.5);
    time.setSpeed(3600);
    log.length = 0;
    time.advance(1);
    expect(time.state.year).toBe(1951);
    expect(log).toEqual(['yearchange']);
  });

  it('scrubbing time of day is a discontinuity with zero sim delta', () => {
    const { time } = make();
    time.setMode('historical');
    const epoch = time.state.epoch;
    time.setTimeOfDay(6.5);
    expect(toIst(time.state.instant).hours).toBeCloseTo(6.5, 9);
    expect(time.state.simDeltaSeconds).toBe(0);
    expect(time.state.epoch).toBe(epoch + 1);
  });

  it('event mode replays a scenario, pauses at its end, and restarts on play', () => {
    const { time, log } = make();
    time.setMode('event');
    expect(time.state.scenario?.id).toBe('s');
    expect(time.state.instant).toBe(SCENARIO.start);
    time.setSpeed(60);
    time.advance(30); // 30 simulated minutes
    expect(time.state.scenarioProgress).toBeCloseTo(0.5, 9);
    log.length = 0;
    time.advance(60); // overshoots the end
    expect(time.state.instant).toBe(SCENARIO.end);
    expect(time.state.paused).toBe(true);
    expect(log).toEqual(['scenarioend', 'playstate']);
    time.play();
    expect(time.state.instant).toBe(SCENARIO.start);
    expect(time.state.paused).toBe(false);
  });

  it('scenario scrubbing clamps to the scenario window', () => {
    const { time } = make();
    time.loadScenario('s');
    time.setScenarioProgress(0.25);
    expect(time.state.instant).toBe(SCENARIO.start + 900_000);
    time.setScenarioProgress(7);
    expect(time.state.scenarioProgress).toBe(1);
    expect(() => time.loadScenario('nope')).toThrow();
  });

  it('returning to live snaps back to the wall clock', () => {
    const { time, log } = make();
    time.setMode('historical');
    time.setYear(1900);
    log.length = 0;
    time.setMode('live');
    expect(time.state.instant).toBe(T0);
    expect(log).toEqual(['yearchange', 'seek', 'modechange']);
  });

  it('unsubscribe stops delivery', () => {
    const { time } = make();
    let n = 0;
    const off = time.on('tick', () => n++);
    time.advance(0.016);
    off();
    time.advance(0.016);
    expect(n).toBe(1);
  });
});
