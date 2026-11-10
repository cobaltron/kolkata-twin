import { IST_OFFSET_MS } from './ist';
import type { Scenario } from './types';

/**
 * Stored scenarios for event mode.
 *
 * SYNTHETIC PLACEHOLDER: Phase 0 ships no real event data. The single entry below is only a
 * 24-hour window that exercises event-mode playback (sun and shadows). It does not represent
 * any real cyclone, storm or monsoon day. Real scenarios arrive with Phase 1 (hourly weather
 * series) and must record their source in data/SOURCES.md.
 */
export const SCENARIOS: Scenario[] = [
  {
    id: 'synthetic-24h',
    label: 'SYNTHETIC placeholder: 24 h test window (no real event data)',
    start: Date.UTC(2024, 5, 21) - IST_OFFSET_MS,
    end: Date.UTC(2024, 5, 22) - IST_OFFSET_MS,
    synthetic: true,
    source: 'none (synthetic placeholder)',
  },
];
