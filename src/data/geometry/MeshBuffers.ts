/** Plain typed-array mesh, transferable between the worker and the main thread. */
export interface MeshData {
  positions: Float32Array;
  indices: Uint32Array;
  /** RGB, 0-255. */
  colors?: Uint8Array;
  /** XYZ, -127..127. */
  normals?: Int8Array;
}

export class MeshBuilder {
  readonly positions: number[] = [];
  readonly indices: number[] = [];
  readonly colors: number[] = [];
  readonly normals: number[] = [];

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
    return mesh;
  }
}

export function transferables(mesh: MeshData): ArrayBuffer[] {
  const out = [mesh.positions.buffer, mesh.indices.buffer] as ArrayBuffer[];
  if (mesh.colors) out.push(mesh.colors.buffer as ArrayBuffer);
  if (mesh.normals) out.push(mesh.normals.buffer as ArrayBuffer);
  return out;
}
