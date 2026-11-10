/**
 * Offline step 2: data/raw/osm.json -> public/data/city.bin (+ city.meta.json for humans).
 * Run: npm run data:build
 *
 * Projects everything to the local metric frame (UTM 45N minus study-area centre), resolves
 * building heights, clips to the study area and writes the compact container defined in
 * src/shared/cityFormat.ts. Triangulation happens later, in the browser's web worker.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import osmtogeojson from 'osmtogeojson';
import { BUILDING_FLAG, encodeCity, HEIGHT_SOURCE, RAIL_CLASS, ROAD_FLAG, type CityStats, type Landmark, type SectionArray } from '../src/shared/cityFormat.ts';
import { LocalFrame, type BBox } from '../src/shared/projection.ts';
import { clipLine, clipRing, ringArea, type Pt } from './lib/clip.ts';
import { parseMetres, resolveHeight } from './lib/heights.ts';
import { OpenBuildingsGrid } from './lib/openBuildings.ts';

const ROOT = new URL('..', import.meta.url);
const area = JSON.parse(await readFile(new URL('config/study-area.json', ROOT), 'utf8')) as {
  id: string; bbox: BBox; utmZone: number; tileSizeMetres: number;
};
const raw = JSON.parse(await readFile(new URL('data/raw/osm.json', ROOT), 'utf8'));
const meta = JSON.parse(await readFile(new URL('data/raw/osm.meta.json', ROOT), 'utf8')) as { osmBaseTimestamp: string | null };
const bbox = area.bbox;
interface WikidataRecord { label: string | null; heightM: number | null; floors: number | null }
let wikidata: Record<string, WikidataRecord> = {};
try {
  wikidata = (JSON.parse(await readFile(new URL('data/wikidata.json', ROOT), 'utf8')) as { entities: Record<string, WikidataRecord> }).entities;
} catch {
  console.warn('data/wikidata.json not found: no landmark labels or Wikidata heights (run npm run data:wikidata)');
}
const frame = LocalFrame.fromBBox(area.utmZone, bbox);
let openBuildings: OpenBuildingsGrid | null = null;
try {
  openBuildings = new OpenBuildingsGrid(new URL('data/open-buildings/', ROOT), frame.originUtm);
} catch (err) {
  if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  console.warn('data/open-buildings not found: no modelled heights (run python tools/open_buildings.py)');
}

/** Rendering widths in metres by highway class. A drawing heuristic, not surveyed carriageway widths. */
const ROAD_CLASSES: Array<[string, number]> = [
  ['motorway', 14], ['trunk', 14], ['primary', 12], ['secondary', 10], ['tertiary', 8],
  ['motorway_link', 7], ['trunk_link', 7], ['primary_link', 6], ['secondary_link', 6], ['tertiary_link', 6],
  ['unclassified', 6], ['residential', 6], ['busway', 6], ['living_street', 4.5], ['pedestrian', 4],
  ['service', 3.5], ['track', 3], ['footway', 1.6], ['path', 1.6], ['steps', 1.6],
];
const ROAD_CLASS_INDEX = new Map(ROAD_CLASSES.map(([k], i) => [k, i]));
const RAIL_CLASS_INDEX: Record<string, number> = {
  rail: RAIL_CLASS.rail, narrow_gauge: RAIL_CLASS.rail, tram: RAIL_CLASS.tram,
  subway: RAIL_CLASS.subway, light_rail: RAIL_CLASS.light,
};
const WATERWAY_WIDTH: Record<string, number> = { river: 12, canal: 8, stream: 3, drain: 2.5, ditch: 2 };
const GREEN_LEISURE = new Set(['park', 'garden', 'pitch', 'golf_course', 'recreation_ground', 'playground', 'stadium', 'sports_centre']);
const GREEN_LANDUSE = new Set(['grass', 'recreation_ground', 'forest', 'meadow', 'cemetery', 'village_green']);
const GREEN_NATURAL = new Set(['wood', 'grassland', 'scrub']);

class PolygonSet {
  ringCounts: number[] = [];
  ringSizes: number[] = [];
  xy: number[] = [];
  get count(): number { return this.ringCounts.length; }
  /** Projected rings of the most recently added polygon, local metres. */
  last: Pt[][] = [];
  /** rings in lon/lat, closed-without-repeat. Returns outer-ring area in m2 (0 if rejected). */
  add(rings: Pt[][]): number {
    const projected = rings.map((r) => r.map(([lon, lat]) => { const p = frame.toLocal(lon, lat); return [p.x, p.y] as Pt; }));
    const outer = projected[0];
    if (!outer || outer.length < 3) return 0;
    const area2 = Math.abs(ringArea(outer));
    if (area2 < 1) return 0;
    const kept = projected.filter((r, i) => i === 0 || (r.length >= 3 && Math.abs(ringArea(r)) > 0.5));
    this.last = kept;
    this.ringCounts.push(kept.length);
    for (const r of kept) {
      this.ringSizes.push(r.length);
      for (const p of r) this.xy.push(p[0], p[1]);
    }
    return area2;
  }
  sections(prefix: string): Record<string, SectionArray> {
    return {
      [`${prefix}_ringCounts`]: Uint16Array.from(this.ringCounts),
      [`${prefix}_ringSizes`]: Uint32Array.from(this.ringSizes),
      [`${prefix}_xy`]: Float32Array.from(this.xy),
    };
  }
}
class LineSet {
  sizes: number[] = [];
  xy: number[] = [];
  get count(): number { return this.sizes.length; }
  add(line: Pt[]): void {
    this.sizes.push(line.length);
    for (const [lon, lat] of line) { const p = frame.toLocal(lon, lat); this.xy.push(p.x, p.y); }
  }
}

const openRing = (ring: number[][]): Pt[] => {
  const pts = ring.map((p) => [p[0]!, p[1]!] as Pt);
  const a = pts[0], z = pts[pts.length - 1];
  if (a && z && a[0] === z[0] && a[1] === z[1]) pts.pop();
  return pts;
};
const inBBox = (p: Pt): boolean => p[0] >= bbox.west && p[0] <= bbox.east && p[1] >= bbox.south && p[1] <= bbox.north;
const centroid = (ring: Pt[]): Pt => {
  let x = 0, y = 0;
  for (const p of ring) { x += p[0]; y += p[1]; }
  return [x / ring.length, y / ring.length];
};

const buildings = new PolygonSet();
const bHeight: number[] = [], bMinHeight: number[] = [], bSrc: number[] = [], bFlags: number[] = [];
const landmarks = new Map<string, Landmark & { rank: number }>();
const KIND_RANK: Record<Landmark['kind'], number> = { building: 4, bridge: 3, green: 2, water: 1, other: 0 };
/** Keep one label per Wikidata item: buildings beat grounds, then the larger footprint wins. */
function addLandmark(tags: Record<string, string>, kind: Landmark['kind'], lonLat: Pt, height: number, areaM2: number): void {
  const qid = tags['wikidata'];
  const record = qid ? wikidata[qid] : undefined;
  if (!qid || !record || !inBBox(lonLat)) return;
  const name = tags['name:en'] ?? record.label ?? tags['name'];
  if (!name) return;
  const rank = KIND_RANK[kind] * 1e9 + areaM2;
  const existing = landmarks.get(qid);
  if (existing && existing.rank >= rank) return;
  const p = frame.toLocal(lonLat[0], lonLat[1]);
  landmarks.set(qid, { qid, name, kind, x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10, height: Math.round(height * 10) / 10, area: Math.round(areaM2), rank });
}
const water = new PolygonSet();
const green = new PolygonSet();
const roads = new LineSet();
const rClass: number[] = [], rWidth: number[] = [], rName: number[] = [], rFlags: number[] = [], rOsmId: number[] = [];
const rails = new LineSet();
const tClass: number[] = [], tFlags: number[] = [];
const waterways = new LineSet();
const cWidth: number[] = [];
const roadNames: string[] = [''];
const roadNameIndex = new Map<string, number>([['', 0]]);
const srcCounts = [0, 0, 0, 0, 0];

const geojson = osmtogeojson(raw) as GeoJSON.FeatureCollection;
for (const f of geojson.features) {
  const tags = (f.properties ?? {}) as Record<string, string>;
  const osmId = Number(String(f.id ?? '').split('/')[1] ?? 0);
  const g = f.geometry;
  const flags = (tags['bridge'] && tags['bridge'] !== 'no' ? ROAD_FLAG.bridge : 0) | (tags['tunnel'] && tags['tunnel'] !== 'no' ? ROAD_FLAG.tunnel : 0);

  if (g.type === 'Polygon' || g.type === 'MultiPolygon') {
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    for (const poly of polys) {
      const rings = poly.map(openRing);
      const outer = rings[0];
      if (!outer || outer.length < 3) continue;
      if (tags['building'] && tags['building'] !== 'no') {
        if (tags['location'] === 'underground' || !inBBox(centroid(outer))) continue;
        const areaM2 = buildings.add(rings);
        if (areaM2 === 0) continue;
        const record = tags['wikidata'] ? wikidata[tags['wikidata']] : undefined;
        const h = resolveHeight(tags, areaM2, osmId, record, openBuildings?.heightFor(buildings.last));
        bHeight.push(h.height); bMinHeight.push(h.minHeight); bSrc.push(h.source);
        bFlags.push(record ? BUILDING_FLAG.landmark : 0);
        addLandmark(tags, 'building', centroid(outer), h.height, areaM2);
        srcCounts[h.source]!++;
      } else {
        const isWater = tags['natural'] === 'water' || tags['waterway'] === 'riverbank';
        const isGreen = GREEN_LEISURE.has(tags['leisure'] ?? '') || GREEN_LANDUSE.has(tags['landuse'] ?? '') || GREEN_NATURAL.has(tags['natural'] ?? '');
        if (!isWater && !isGreen) continue;
        const clipped = rings.map((r) => clipRing(r, bbox)).filter((r, i) => i === 0 || r.length >= 3);
        if (!clipped[0] || clipped[0].length < 3) continue;
        const areaM2 = (isWater ? water : green).add(clipped);
        if (areaM2 > 0) addLandmark(tags, isWater ? 'water' : 'green', centroid(clipped[0]), 0, areaM2);
      }
    }
  } else if (g.type === 'LineString') {
    const line = g.coordinates.map((p) => [p[0]!, p[1]!] as Pt);
    // Named bridges with a Wikidata item (e.g. Howrah Bridge) get a label at mid-span, anchored at deck level.
    if (flags & ROAD_FLAG.bridge) addLandmark(tags, 'bridge', line[Math.floor(line.length / 2)]!, 0, line.length);
    if (tags['highway'] && ROAD_CLASS_INDEX.has(tags['highway']) && tags['area'] !== 'yes') {
      const cls = ROAD_CLASS_INDEX.get(tags['highway'])!;
      const name = tags['name'] ?? '';
      let nameIdx = roadNameIndex.get(name);
      if (nameIdx === undefined) { nameIdx = roadNames.length; roadNames.push(name); roadNameIndex.set(name, nameIdx); }
      const width = parseMetres(tags['width']) ?? ROAD_CLASSES[cls]![1];
      for (const piece of clipLine(line, bbox)) {
        roads.add(piece);
        rClass.push(cls); rWidth.push(Math.min(width, 40)); rName.push(nameIdx); rFlags.push(flags); rOsmId.push(osmId);
      }
    } else if (tags['railway'] && tags['railway'] in RAIL_CLASS_INDEX) {
      for (const piece of clipLine(line, bbox)) { rails.add(piece); tClass.push(RAIL_CLASS_INDEX[tags['railway']]!); tFlags.push(flags); }
    } else if (tags['waterway'] && tags['waterway'] in WATERWAY_WIDTH && !(flags & ROAD_FLAG.tunnel)) {
      for (const piece of clipLine(line, bbox)) { waterways.add(piece); cWidth.push(WATERWAY_WIDTH[tags['waterway']]!); }
    }
  }
}
if (roadNames.length > 65535) throw new Error('too many road names for u16 index');

const sw = frame.toLocal(bbox.west, bbox.south), ne = frame.toLocal(bbox.east, bbox.north);
const nw = frame.toLocal(bbox.west, bbox.north), se = frame.toLocal(bbox.east, bbox.south);
const stats: CityStats = {
  buildings: buildings.count,
  heightFromWikidata: srcCounts[HEIGHT_SOURCE.wikidata]!,
  heightFromOpenBuildings: srcCounts[HEIGHT_SOURCE.openBuildings]!,
  heightFromTag: srcCounts[HEIGHT_SOURCE.tag]!, heightFromLevels: srcCounts[HEIGHT_SOURCE.levels]!, heightEstimated: srcCounts[HEIGHT_SOURCE.estimated]!,
  roads: roads.count, rails: rails.count, waterPolygons: water.count, waterways: waterways.count, greenPolygons: green.count,
};
const header = {
  version: 1 as const,
  studyAreaId: area.id,
  utmZone: area.utmZone,
  origin: { ...frame.originLonLat, utmE: frame.originUtm.x, utmN: frame.originUtm.y },
  extent: { minX: Math.min(sw.x, nw.x), minY: Math.min(sw.y, se.y), maxX: Math.max(ne.x, se.x), maxY: Math.max(ne.y, nw.y) },
  tileSizeMetres: area.tileSizeMetres,
  generatedAt: new Date().toISOString(),
  osmBaseTimestamp: meta.osmBaseTimestamp,
  attribution: '© OpenStreetMap contributors, ODbL 1.0; building heights partly from Google Open Buildings 2.5D Temporal, CC BY 4.0',
  stats,
  landmarks: [...landmarks.values()].map(({ rank: _rank, ...l }) => l).sort((a, b) => b.area - a.area),
  roadNames,
};
const bin = encodeCity(header, {
  ...buildings.sections('b'),
  b_height: Float32Array.from(bHeight), b_minHeight: Float32Array.from(bMinHeight), b_src: Uint8Array.from(bSrc), b_flags: Uint8Array.from(bFlags),
  ...water.sections('w'),
  ...green.sections('g'),
  r_sizes: Uint32Array.from(roads.sizes), r_xy: Float32Array.from(roads.xy), r_class: Uint8Array.from(rClass),
  r_width: Float32Array.from(rWidth), r_name: Uint16Array.from(rName), r_flags: Uint8Array.from(rFlags), r_osmId: Float64Array.from(rOsmId),
  t_sizes: Uint32Array.from(rails.sizes), t_xy: Float32Array.from(rails.xy), t_class: Uint8Array.from(tClass), t_flags: Uint8Array.from(tFlags),
  c_sizes: Uint32Array.from(waterways.sizes), c_xy: Float32Array.from(waterways.xy), c_width: Float32Array.from(cWidth),
});
await mkdir(new URL('public/data/', ROOT), { recursive: true });
await writeFile(new URL('public/data/city.bin', ROOT), bin);
await writeFile(new URL('public/data/city.meta.json', ROOT), JSON.stringify({ ...header, landmarks: `${landmarks.size} landmarks (see city.bin)`, roadNames: `${roadNames.length} names (see city.bin)` }, null, 2));
console.log(stats);
console.log(`landmarks: ${landmarks.size}`);
console.log(`extent (m):`, header.extent, `\ncity.bin: ${(bin.length / 1e6).toFixed(2)} MB`);
