import type { CityHeader } from '../shared/cityFormat';
import type { MeshData } from './geometry/MeshBuffers';

export interface BuildingTile {
  mesh: MeshData;
  /** Tile bounds in scene coordinates, for culling. */
  min: [number, number, number];
  max: [number, number, number];
}

/** Render-ready geometry produced by the worker. Y offsets of flat layers are applied by each layer. */
export interface CityGeometry {
  header: CityHeader;
  buildings: BuildingTile[];
  green: MeshData;
  water: MeshData;
  roads: MeshData;
  rail: MeshData;
}

export type WorkerRequest = { url: string };
export type WorkerResponse = { ok: true; city: CityGeometry } | { ok: false; error: string };
