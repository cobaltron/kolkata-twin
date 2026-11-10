import { IST_OFFSET_MS } from './ist';
import type { Scenario } from './types';

/**
 * SYNTHETIC PLACEHOLDER scenario. A 24-hour window driven by the artificial storm in
 * src/layers/weather/providers.ts (syntheticStorm). It represents no real event and exists so that
 * rain, cloud and haze can be exercised without stored data. Badged SYNTHETIC in the UI.
 */
export const SYNTHETIC_SCENARIO: Scenario = {
  id: 'synthetic-storm',
  label: 'SYNTHETIC storm: 24 h rendering test (not real data)',
  start: Date.UTC(2024, 5, 21) - IST_OFFSET_MS,
  end: Date.UTC(2024, 5, 22) - IST_OFFSET_MS,
  synthetic: true,
  source: 'none (synthetic placeholder)',
};

/**
 * Real scenarios are listed in public/data/scenarios/index.json, written by tools/fetch-scenarios.ts
 * from config/scenarios.json. Only scenarios whose hourly series was actually downloaded appear there.
 */
export async function loadScenarios(): Promise<Scenario[]> {
  try {
    const res = await fetch(new URL('data/scenarios/index.json', document.baseURI));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const stored = (await res.json()) as Scenario[];
    return [...stored, SYNTHETIC_SCENARIO];
  } catch (err) {
    console.warn('No stored scenarios available; only the synthetic placeholder is offered.', err);
    return [SYNTHETIC_SCENARIO];
  }
}
