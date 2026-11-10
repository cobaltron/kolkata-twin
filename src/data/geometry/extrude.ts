import type { MeshBuilder } from './MeshBuffers';
import { signedArea, triangulate, type Rings } from './polygons';

export type RGB = readonly [number, number, number];

/**
 * Append an extruded footprint (walls + flat roof, no floor) to `out`.
 * Scene axes: X = east, Y = up, Z = -north. Wall bases are darkened for a cheap ground-contact cue.
 */
export function extrudeFootprint(out: MeshBuilder, rings: Rings, base: number, top: number, wall: RGB, roof: RGB): void {
  for (let r = 0; r < rings.length; r++) {
    const ring = rings[r]!;
    const n = ring.length / 2;
    // Outer rings counter-clockwise, holes clockwise, so (dy, -dx) always points out of the solid.
    const reverse = signedArea(ring) > 0 !== (r === 0);
    for (let i = 0; i < n; i++) {
      const a = reverse ? n - 1 - i : i;
      const b = reverse ? (n - 1 - i - 1 + n) % n : (i + 1) % n;
      const ax = ring[a * 2]!, ay = ring[a * 2 + 1]!;
      const bx = ring[b * 2]!, by = ring[b * 2 + 1]!;
      const dx = bx - ax, dy = by - ay;
      const len = Math.hypot(dx, dy);
      if (len < 0.01) continue;
      const nx = Math.round((dy / len) * 127), nz = Math.round((dx / len) * 127);
      const v = out.vertexCount;
      out.positions.push(ax, base, -ay, bx, base, -by, bx, top, -by, ax, top, -ay);
      for (let k = 0; k < 4; k++) {
        out.normals.push(nx, 0, nz);
        const shade = k < 2 ? 0.72 : 1;
        out.colors.push(wall[0] * shade, wall[1] * shade, wall[2] * shade);
      }
      out.indices.push(v, v + 1, v + 2, v, v + 2, v + 3);
    }
  }
  const { flat, indices } = triangulate(rings);
  const v0 = out.vertexCount;
  for (let i = 0; i < flat.length; i += 2) {
    out.positions.push(flat[i]!, top, -flat[i + 1]!);
    out.normals.push(0, 127, 0);
    out.colors.push(roof[0], roof[1], roof[2]);
  }
  for (const idx of indices) out.indices.push(v0 + idx);
}

/** Append a flat polygon at height `y`. */
export function flatPolygon(out: MeshBuilder, rings: Rings, y: number, color: RGB): void {
  const { flat, indices } = triangulate(rings);
  const v0 = out.vertexCount;
  for (let i = 0; i < flat.length; i += 2) {
    out.positions.push(flat[i]!, y, -flat[i + 1]!);
    out.colors.push(color[0], color[1], color[2]);
  }
  for (const idx of indices) out.indices.push(v0 + idx);
}
