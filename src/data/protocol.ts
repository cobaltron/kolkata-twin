import type { CityHeader } from '../shared/cityFormat';
import type { MeshData } from './geometry/MeshBuffers';

export interface BuildingTile {
  mesh: MeshData;
  /** Tile bounds in scene coordinates, for culling. */
  min: [number, number, number];
  max: [number, number, number];
}

/** Polylines packed end to end: line i is xy[offsets[i] .. offsets[i + 1]) as x, y pairs in local metres. */
export interface PathSet {
  xy: Float32Array;
  offsets: Uint32Array;
}

/** Render-ready geometry produced by the worker. Y offsets of flat layers are applied by each layer. */
export interface CityGeometry {
  header: CityHeader;
  /** Centre lines used by the simulated-movement layers. */
  paths: { roads: PathSet; trams: PathSet; river: PathSet };
  buildings: BuildingTile[];
  green: MeshData;
  water: MeshData;
  roads: MeshData;
  rail: MeshData;
}

export type WorkerRequest = { url: string };
export type WorkerResponse = { ok: true; city: CityGeometry } | { ok: false; error: string };
