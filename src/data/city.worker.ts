/// <reference lib="webworker" />
/**
 * Fetches and decodes city.bin, then triangulates/extrudes everything off the main thread.
 * Result arrays are transferred (zero-copy) back to the page.
 */
import { decodeCity, HEIGHT_SOURCE, RAIL_CLASS, ROAD_FLAG } from '../shared/cityFormat';
import { extrudeFootprint, flatPolygon, type RGB } from './geometry/extrude';
import { MeshBuilder, transferables } from './geometry/MeshBuffers';
import { iteratePolygons } from './geometry/polygons';
import { ribbon } from './geometry/ribbon';
import type { BuildingTile, CityGeometry, WorkerRequest, WorkerResponse } from './protocol';

// Wall palette for buildings whose height comes from OSM tags: weathered lime-wash tones.
const WALLS_SOURCED: RGB[] = [[224, 205, 164], [214, 176, 128], [209, 152, 130], [196, 204, 170], [226, 219, 203]];
// Estimated-height buildings use the same palette pulled towards a cool grey, so they read as "not surveyed".
const ESTIMATE_TINT: RGB = [150, 158, 176];
const ESTIMATE_MIX = 0.42;
const ROOF_SOURCED: RGB = [150, 104, 84];
const ROOF_ESTIMATED: RGB = [112, 118, 132];

const ROAD_COLORS: RGB[] = [
  [92, 90, 96], [92, 90, 96], [86, 84, 90], [80, 79, 84], [76, 75, 80], // motorway..tertiary
  [84, 82, 88], [84, 82, 88], [80, 79, 84], [78, 77, 82], [76, 75, 80], // links
  [72, 71, 76], [72, 71, 76], [72, 71, 76], [78, 76, 78], [120, 110, 98], // unclassified..pedestrian
  [70, 69, 73], [104, 92, 76], [136, 124, 106], [136, 124, 106], [136, 124, 106], // service..steps
];
const RAIL_STYLE: Record<number, { width: number; color: RGB }> = {
  [RAIL_CLASS.rail]: { width: 3.2, color: [52, 46, 44] },
  [RAIL_CLASS.tram]: { width: 1.8, color: [150, 96, 60] },
  [RAIL_CLASS.subway]: { width: 3.0, color: [60, 60, 90] },
  [RAIL_CLASS.light]: { width: 2.6, color: [70, 60, 56] },
};
const WATER: RGB = [104, 118, 104];
const GREEN: RGB = [98, 128, 78];

const hash = (n: number): number => (Math.imul(n + 1, 2654435761) >>> 0) / 4294967296;
const mix = (a: RGB, b: RGB, t: number, gain: number): RGB => [
  (a[0] + (b[0] - a[0]) * t) * gain, (a[1] + (b[1] - a[1]) * t) * gain, (a[2] + (b[2] - a[2]) * t) * gain,
];

function build(buffer: ArrayBuffer): CityGeometry {
  const city = decodeCity(buffer);
  const { header } = city;
  const tileSize = header.tileSizeMetres;

  // Buildings, bucketed into square tiles so the renderer can frustum-cull them.
  const heights = city.section<Float32Array>('b_height');
  const minHeights = city.section<Float32Array>('b_minHeight');
  const sources = city.section<Uint8Array>('b_src');
  const tiles = new Map<string, MeshBuilder>();
  let b = 0;
  for (const rings of iteratePolygons(city.section('b_ringCounts'), city.section('b_ringSizes'), city.section('b_xy'))) {
    const outer = rings[0]!;
    const key = `${Math.floor(outer[0]! / tileSize)},${Math.floor(outer[1]! / tileSize)}`;
    let tile = tiles.get(key);
    if (!tile) tiles.set(key, (tile = new MeshBuilder()));
    const estimated = sources[b] === HEIGHT_SOURCE.estimated;
    const base = WALLS_SOURCED[Math.floor(hash(b) * WALLS_SOURCED.length)]!;
    const gain = 0.9 + hash(b * 7 + 3) * 0.2;
    const wall = estimated ? mix(base, ESTIMATE_TINT, ESTIMATE_MIX, gain) : mix(base, base, 0, gain);
    extrudeFootprint(tile, rings, minHeights[b]!, heights[b]!, wall, estimated ? ROOF_ESTIMATED : ROOF_SOURCED);
    b++;
  }
  const buildings: BuildingTile[] = [];
  for (const builder of tiles.values()) {
    const mesh = builder.build(true);
    const min: [number, number, number] = [Infinity, Infinity, Infinity];
    const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < mesh.positions.length; i++) {
      const axis = i % 3, v = mesh.positions[i]!;
      if (v < min[axis]!) min[axis] = v;
      if (v > max[axis]!) max[axis] = v;
    }
    buildings.push({ mesh, min, max });
  }

  const flat = (prefix: string, color: RGB): MeshBuilder => {
    const out = new MeshBuilder();
    for (const rings of iteratePolygons(city.section(`${prefix}_ringCounts`), city.section(`${prefix}_ringSizes`), city.section(`${prefix}_xy`))) {
      flatPolygon(out, rings, 0, color);
    }
    return out;
  };
  const green = flat('g', GREEN);
  const water = flat('w', WATER);

  // Open waterways (canals, drains) are centre lines in OSM; draw them as water ribbons.
  const cSizes = city.section<Uint32Array>('c_sizes'), cXy = city.section<Float32Array>('c_xy'), cWidth = city.section<Float32Array>('c_width');
  for (let i = 0, cursor = 0; i < cSizes.length; i++) {
    const len = cSizes[i]! * 2;
    ribbon(water, cXy.subarray(cursor, cursor + len), cWidth[i]!, 0, WATER);
    cursor += len;
  }

  // Roads: minor classes first so major roads overdraw them at junctions. Tunnels are not drawn.
  const rSizes = city.section<Uint32Array>('r_sizes'), rXy = city.section<Float32Array>('r_xy');
  const rClass = city.section<Uint8Array>('r_class'), rWidth = city.section<Float32Array>('r_width'), rFlags = city.section<Uint8Array>('r_flags');
  const offsets = new Uint32Array(rSizes.length);
  for (let i = 0, cursor = 0; i < rSizes.length; i++) { offsets[i] = cursor; cursor += rSizes[i]! * 2; }
  const order = Array.from(rSizes.keys()).sort((p, q) => rWidth[p]! - rWidth[q]!);
  const roads = new MeshBuilder();
  for (const i of order) {
    if (rFlags[i]! & ROAD_FLAG.tunnel) continue;
    ribbon(roads, rXy.subarray(offsets[i]!, offsets[i]! + rSizes[i]! * 2), rWidth[i]!, 0, ROAD_COLORS[rClass[i]!]!);
  }

  const tSizes = city.section<Uint32Array>('t_sizes'), tXy = city.section<Float32Array>('t_xy');
  const tClass = city.section<Uint8Array>('t_class'), tFlags = city.section<Uint8Array>('t_flags');
  const rail = new MeshBuilder();
  for (let i = 0, cursor = 0; i < tSizes.length; i++) {
    const len = tSizes[i]! * 2;
    const style = RAIL_STYLE[tClass[i]!]!;
    if (!(tFlags[i]! & ROAD_FLAG.tunnel)) ribbon(rail, tXy.subarray(cursor, cursor + len), style.width, 0, style.color);
    cursor += len;
  }

  return { header, buildings, green: green.build(false), water: water.build(false), roads: roads.build(false), rail: rail.build(false) };
}

self.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const post = (msg: WorkerResponse, transfer: Transferable[] = []): void => self.postMessage(msg, { transfer });
  try {
    const res = await fetch(ev.data.url);
    if (!res.ok) throw new Error(`HTTP ${res.status} loading ${ev.data.url}`);
    const city = build(await res.arrayBuffer());
    const buffers = [city.green, city.water, city.roads, city.rail, ...city.buildings.map((t) => t.mesh)].flatMap(transferables);
    post({ ok: true, city }, buffers);
  } catch (err) {
    post({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
