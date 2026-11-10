/**
 * Per-building height from the cropped Open Buildings 2.5D grid written by tools/open_buildings.py.
 * A building gets a modelled height only when the grid actually shows a building under its footprint.
 */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import type { Pt } from './clip.ts';

interface GridMeta { cols: number; rows: number; cellMetres: number; westUtm: number; northUtm: number; valueUnitMetres: number; epoch: string }

/** Share of a footprint's cells that the model must mark as building before its height is trusted. */
const MIN_COVERAGE = 0.4;
const MIN_CELLS = 2;
/** Roof height = this percentile of the building cells under the footprint (robust to edge bleed). */
const PERCENTILE = 0.75;

export class OpenBuildingsGrid {
  readonly meta: GridMeta;
  private readonly data: Uint8Array;

  constructor(dir: URL, private readonly originUtm: { x: number; y: number }) {
    this.meta = JSON.parse(readFileSync(new URL('meta.json', dir), 'utf8')) as GridMeta;
    this.data = gunzipSync(readFileSync(new URL('height_2m.u8.gz', dir)));
    if (this.data.length !== this.meta.cols * this.meta.rows) throw new Error('open-buildings grid size mismatch');
  }

  /** `rings` in local metres (ring 0 outer, others holes). Returns metres, or null if not covered. */
  heightFor(rings: Pt[][]): number | null {
    const { cols, rows, cellMetres: cell, westUtm, northUtm, valueUnitMetres } = this.meta;
    const outer = rings[0]!;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [x, y] of outer) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    const offX = westUtm - this.originUtm.x, offY = northUtm - this.originUtm.y;
    const c0 = Math.max(0, Math.floor((minX - offX) / cell)), c1 = Math.min(cols - 1, Math.floor((maxX - offX) / cell));
    const r0 = Math.max(0, Math.floor((offY - maxY) / cell)), r1 = Math.min(rows - 1, Math.floor((offY - minY) / cell));
    const values: number[] = [];
    let inside = 0;
    for (let r = r0; r <= r1; r++) {
      const y = offY - (r + 0.5) * cell;
      for (let c = c0; c <= c1; c++) {
        const x = offX + (c + 0.5) * cell;
        if (!contains(rings, x, y)) continue;
        inside++;
        const v = this.data[r * cols + c]!;
        if (v > 0) values.push(v);
      }
    }
    if (inside < MIN_CELLS || values.length < inside * MIN_COVERAGE) return null;
    values.sort((a, b) => a - b);
    return values[Math.min(values.length - 1, Math.floor(values.length * PERCENTILE))]! * valueUnitMetres;
  }
}

/** Even-odd point-in-polygon over all rings, so holes are excluded. */
function contains(rings: Pt[][], x: number, y: number): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i]!, [xj, yj] = ring[j]!;
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}
