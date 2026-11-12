/**
 * Compact binary container shared by the offline tool (writer) and the web worker (reader).
 *
 * Layout: "KOL1" | u32 headerBytes | UTF-8 JSON header | pad to 8 | section payloads (8-aligned).
 * All coordinates are local-frame metres (see shared/projection.ts).
 */
export type SectionType = 'u8' | 'u16' | 'u32' | 'f32' | 'f64';
export type SectionArray = Uint8Array | Uint16Array | Uint32Array | Float32Array | Float64Array;

export interface SectionInfo {
  type: SectionType;
  offset: number;
  length: number;
}

export interface CityStats {
  buildings: number;
  heightFromTag: number;
  heightFromLevels: number;
  heightEstimated: number;
  heightFromWikidata: number;
  heightFromOpenBuildings: number;
  roads: number;
  rails: number;
  waterPolygons: number;
  waterways: number;
  greenPolygons: number;
  /** Trees placed from the canopy-height map (0 when the area has none). */
  trees: number;
}

export interface CityHeader {
  version: 1;
  studyAreaId: string;
  utmZone: number;
  origin: { lon: number; lat: number; utmE: number; utmN: number };
  /** Study-area extent in local metres. */
  extent: { minX: number; minY: number; maxX: number; maxY: number };
  tileSizeMetres: number;
  generatedAt: string;
  osmBaseTimestamp: string | null;
  attribution: string;
  stats: CityStats;
  /** Named places that have a Wikidata item, for the label layer. Coordinates are local metres. */
  landmarks: Landmark[];
  /** Where the trees come from, for the legend; null when the area has no tree data. */
  treeSource: string | null;
  /** Hand-specified landmark models, anchored on OSM geometry. */
  models: LandmarkModel[];
  /** Street names; index 0 is "" (unnamed). Referenced by the r_name section. */
  roadNames: string[];
  sections: Record<string, SectionInfo>;
}

/** A procedural landmark model: sourced overall dimensions, schematic detail (see config/landmark-models.json). */
export interface LandmarkModel {
  id: string;
  name: string;
  kind: 'cantilever-bridge' | 'domed-hall' | 'minar' | 'spired-church';
  /** Anchor in local metres. */
  x: number;
  y: number;
  /** Compass bearing of the feature's long axis, radians clockwise from grid north. */
  bearing: number;
  /** Height of the extruded OSM footprint the model stands on (0 when it stands on the ground). */
  baseHeight: number;
  dimensions: Record<string, number>;
  source: string;
}

export interface Landmark {
  qid: string;
  /** English name where one exists (OSM name:en, else Wikidata label), else the local name. */
  name: string;
  kind: 'building' | 'green' | 'water' | 'bridge' | 'other';
  x: number;
  y: number;
  /** Height in metres at which to anchor the label (the rendered building height, 0 for flat features). */
  height: number;
  /** Footprint area in m2, used to rank labels. */
  area: number;
}

export const HEIGHT_SOURCE = { tag: 0, levels: 1, estimated: 2, wikidata: 3, openBuildings: 4 } as const;
export const BUILDING_FLAG = { landmark: 1 } as const;
export const ROAD_FLAG = { bridge: 1, tunnel: 2 } as const;
export const RAIL_CLASS = { rail: 0, tram: 1, subway: 2, light: 3 } as const;

const MAGIC = 0x314c4f4b; // "KOL1" little-endian
const CTORS = { u8: Uint8Array, u16: Uint16Array, u32: Uint32Array, f32: Float32Array, f64: Float64Array } as const;

function typeOf(a: SectionArray): SectionType {
  if (a instanceof Uint8Array) return 'u8';
  if (a instanceof Uint16Array) return 'u16';
  if (a instanceof Uint32Array) return 'u32';
  if (a instanceof Float32Array) return 'f32';
  return 'f64';
}
const align8 = (n: number): number => (n + 7) & ~7;

export function encodeCity(header: Omit<CityHeader, 'sections'>, sections: Record<string, SectionArray>): Uint8Array {
  const infos: Record<string, SectionInfo> = {};
  let cursor = 0;
  for (const [name, arr] of Object.entries(sections)) {
    infos[name] = { type: typeOf(arr), offset: cursor, length: arr.length };
    cursor = align8(cursor + arr.byteLength);
  }
  const headerBytes = new TextEncoder().encode(JSON.stringify({ ...header, sections: infos }));
  const payloadStart = align8(8 + headerBytes.length);
  const out = new Uint8Array(payloadStart + cursor);
  const view = new DataView(out.buffer);
  view.setUint32(0, MAGIC, true);
  view.setUint32(4, headerBytes.length, true);
  out.set(headerBytes, 8);
  for (const [name, arr] of Object.entries(sections)) {
    out.set(new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength), payloadStart + infos[name]!.offset);
  }
  return out;
}

export interface DecodedCity {
  header: CityHeader;
  section<T extends SectionArray>(name: string): T;
}

export function decodeCity(buffer: ArrayBuffer): DecodedCity {
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== MAGIC) throw new Error('city.bin: bad magic');
  const headerLen = view.getUint32(4, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 8, headerLen))) as CityHeader;
  if (header.version !== 1) throw new Error(`city.bin: unsupported version ${String(header.version)}`);
  const payloadStart = align8(8 + headerLen);
  return {
    header,
    section<T extends SectionArray>(name: string): T {
      const info = header.sections[name];
      if (!info) throw new Error(`city.bin: missing section ${name}`);
      const Ctor = CTORS[info.type];
      return new Ctor(buffer, payloadStart + info.offset, info.length) as unknown as T;
    },
  };
}
