import areas from '../../config/areas.json';
import type { BBox } from './projection';

export interface AreaConfig {
  name: string;
  /** "North Kolkata", "South Kolkata" or "Overview". */
  region: string;
  description: string;
  bbox: BBox;
  utmZone: number;
  tileSizeMetres: number;
  /** Name of a painted map built for this area (tools/pixelmap), if any. */
  paintedMap?: string;
}

export const AREAS: Record<string, AreaConfig> = areas;
export const DEFAULT_AREA = 'college-street';

/** The area chosen by the page address (?area=<id>), or the default. */
export function currentAreaId(): string {
  const wanted = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('area');
  return wanted && wanted in AREAS ? wanted : DEFAULT_AREA;
}

export const AREA_ID = currentAreaId();
export const STUDY_AREA: AreaConfig = AREAS[AREA_ID]!;

/** Earliest year the time controller accepts. */
export const HISTORICAL_MIN_YEAR = 1873;
