/**
 * Building height resolution. Documented in data/SOURCES.md ("Building heights").
 *
 * Priority:
 *   1. `height` tag (metres; feet/inches and unit suffixes parsed)       -> source "tag"
 *   2. Wikidata height (P2048) of the item named by the `wikidata` tag    -> source "wikidata"
 *   3. `building:levels` (else Wikidata floors above ground, P1101)
 *      x LEVEL_HEIGHT_M + ROOF_ALLOWANCE_M                                -> source "levels" / "wikidata"
 *   4. FALLBACK HEURISTIC (not real data): levels guessed from the
 *      building type and footprint area, plus a deterministic 0/+1 level
 *      variation keyed on the OSM id so blocks are not perfectly uniform -> source "estimated"
 *
 * Estimated buildings are tinted differently in the renderer and counted in the UI legend.
 */
import { HEIGHT_SOURCE } from '../../src/shared/cityFormat.ts';

export const LEVEL_HEIGHT_M = 3.2; // assumption, not a surveyed value
export const ROOF_ALLOWANCE_M = 1.0; // parapet / plinth allowance, assumption

const SINGLE_STOREY = new Set([
  'hut', 'shed', 'garage', 'garages', 'kiosk', 'roof', 'carport', 'cabin', 'toilets', 'service', 'guardhouse',
  'container', 'greenhouse', 'stable', 'slum',
]);

export interface ResolvedHeight {
  height: number;
  minHeight: number;
  source: number;
}

export function parseMetres(raw: string | undefined): number | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase();
  const feet = /^(\d+(?:\.\d+)?)\s*(?:'|ft|feet)\s*(?:(\d+(?:\.\d+)?)\s*(?:"|in)?)?$/.exec(s);
  if (feet) return Number(feet[1]) * 0.3048 + Number(feet[2] ?? 0) * 0.0254;
  const m = /^(\d+(?:[.,]\d+)?)\s*(?:m|metres?|meters?)?$/.exec(s);
  if (!m) return null;
  const v = Number(m[1]!.replace(',', '.'));
  return Number.isFinite(v) && v > 0 && v < 1000 ? v : null;
}

export function estimateLevels(buildingTag: string, footprintM2: number, osmId: number): number {
  if (SINGLE_STOREY.has(buildingTag)) return 1;
  let levels: number;
  if (footprintM2 < 40) levels = 1;
  else if (footprintM2 < 150) levels = 2;
  else if (footprintM2 < 600) levels = 3;
  else if (footprintM2 < 2500) levels = 4;
  else levels = 5;
  // Deterministic variation: one building in three gets an extra level.
  const hash = Math.imul(osmId | 0, 2654435761) >>> 0;
  return levels + (hash % 3 === 0 ? 1 : 0);
}

export interface WikidataHeight {
  heightM: number | null;
  floors: number | null;
}

export function resolveHeight(tags: Record<string, string>, footprintM2: number, osmId: number, wikidata?: WikidataHeight): ResolvedHeight {
  const minFromTag = parseMetres(tags['min_height']);
  const minLevel = Number(tags['building:min_level']);
  const minHeight = minFromTag ?? (Number.isFinite(minLevel) && minLevel > 0 ? minLevel * LEVEL_HEIGHT_M : 0);

  const tagged = parseMetres(tags['height']);
  if (tagged !== null && tagged > minHeight) return { height: tagged, minHeight, source: HEIGHT_SOURCE.tag };

  if (wikidata?.heightM && wikidata.heightM > minHeight) return { height: wikidata.heightM, minHeight, source: HEIGHT_SOURCE.wikidata };

  const levels = Number(tags['building:levels']);
  if (Number.isFinite(levels) && levels > 0 && levels < 200) {
    return { height: levels * LEVEL_HEIGHT_M + ROOF_ALLOWANCE_M, minHeight, source: HEIGHT_SOURCE.levels };
  }
  if (wikidata?.floors) return { height: wikidata.floors * LEVEL_HEIGHT_M + ROOF_ALLOWANCE_M, minHeight, source: HEIGHT_SOURCE.wikidata };
  const guess = estimateLevels(tags['building'] ?? 'yes', footprintM2, osmId);
  return { height: Math.max(guess * LEVEL_HEIGHT_M + ROOF_ALLOWANCE_M, minHeight + LEVEL_HEIGHT_M), minHeight: 0, source: HEIGHT_SOURCE.estimated };
}
