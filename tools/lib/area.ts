/** Which area a tool is working on, and where that area's files live. Usage: `tsx tools/x.ts <area-id>`. */
import { readFileSync } from 'node:fs';
import type { BBox } from '../../src/shared/projection.ts';

export interface AreaConfig {
  name: string;
  region: string;
  description: string;
  bbox: BBox;
  utmZone: number;
  tileSizeMetres: number;
  paintedMap?: string;
}

export const ROOT = new URL('../..', import.meta.url);
export const AREAS = JSON.parse(readFileSync(new URL('config/areas.json', ROOT), 'utf8')) as Record<string, AreaConfig>;

export interface Area {
  id: string;
  config: AreaConfig;
  /** Git-ignored downloads: data/raw/<id>/ */
  raw: URL;
  /** Files the app loads: public/data/<id>/ */
  out: URL;
  /** Cropped Open Buildings heights: data/open-buildings/<id>/ */
  openBuildings: URL;
  /** Trees derived from the canopy-height map: data/canopy/<id>/ */
  canopy: URL;
}

export function areaFiles(id: string): Area {
  const config = AREAS[id];
  if (!config) throw new Error(`Unknown area "${id}". Known areas: ${Object.keys(AREAS).join(', ')}`);
  return {
    id, config,
    raw: new URL(`data/raw/${id}/`, ROOT),
    out: new URL(`public/data/${id}/`, ROOT),
    openBuildings: new URL(`data/open-buildings/${id}/`, ROOT),
    canopy: new URL(`data/canopy/${id}/`, ROOT),
  };
}

/** The area named on the command line (first argument that is not a flag). */
export function areaFromArgs(): Area {
  const id = process.argv.slice(2).find((a) => !a.startsWith('--'));
  if (!id) throw new Error(`Name an area: ${Object.keys(AREAS).join(', ')}`);
  return areaFiles(id);
}
