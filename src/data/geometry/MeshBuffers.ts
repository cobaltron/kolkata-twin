/** Plain typed-array mesh, transferable between the worker and the main thread. */
export interface MeshData {
  positions: Float32Array;
  indices: Uint32Array;
  /** RGB, 0-255. */
  colors?: Uint8Array;
  /** XYZ, -127..127. */
  normals?: Int8Array;
  /** Per vertex: distance along the wall (m), height above the building base (m), per-building seed 0..1. */
  facade?: Float32Array;
}

export class MeshBuilder {
  readonly positions: number[] = [];
  readonly indices: number[] = [];
  readonly colors: number[] = [];
  readonly normals: number[] = [];
  readonly facade: number[] = [];

  get vertexCount(): number {
    return this.positions.length / 3;
  }

  build(withNormals: boolean): MeshData {
    const mesh: MeshData = {
      positions: Float32Array.from(this.positions),
      indices: Uint32Array.from(this.indices),
      colors: Uint8Array.from(this.colors),
    };
    if (withNormals) mesh.normals = Int8Array.from(this.normals);
    if (this.facade.length > 0) mesh.facade = Float32Array.from(this.facade);
    return mesh;
  }
}

export function transferables(mesh: MeshData): ArrayBuffer[] {
  const out = [mesh.positions.buffer, mesh.indices.buffer] as ArrayBuffer[];
  if (mesh.colors) out.push(mesh.colors.buffer as ArrayBuffer);
  if (mesh.normals) out.push(mesh.normals.buffer as ArrayBuffer);
  if (mesh.facade) out.push(mesh.facade.buffer as ArrayBuffer);
  return out;
}
