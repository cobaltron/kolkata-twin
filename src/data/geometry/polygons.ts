import earcut from 'earcut';

/** A polygon as rings of [x0, y0, x1, y1, ...] in local metres; ring 0 is the outer ring. */
export type Rings = Float32Array[];

export function signedArea(ring: ArrayLike<number>): number {
  let s = 0;
  const n = ring.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    s += ring[i * 2]! * ring[j * 2 + 1]! - ring[j * 2]! * ring[i * 2 + 1]!;
  }
  return s / 2;
}

/** Iterate polygons stored as (ringCounts, ringSizes, xy) sections. Rings are views, not copies. */
export function* iteratePolygons(ringCounts: Uint16Array, ringSizes: Uint32Array, xy: Float32Array): Generator<Rings> {
  let ringCursor = 0;
  let xyCursor = 0;
  for (let p = 0; p < ringCounts.length; p++) {
    const rings: Rings = [];
    for (let r = 0; r < ringCounts[p]!; r++) {
      const len = ringSizes[ringCursor++]! * 2;
      rings.push(xy.subarray(xyCursor, xyCursor + len));
      xyCursor += len;
    }
    yield rings;
  }
}

export interface Triangulated {
  /** Flat [x, y] vertex list of all rings concatenated. */
  flat: number[];
  /** Triangle indices into `flat`, wound counter-clockwise in map view (x east, y north). */
  indices: number[];
}

export function triangulate(rings: Rings): Triangulated {
  const flat: number[] = [];
  const holes: number[] = [];
  for (let r = 0; r < rings.length; r++) {
    if (r > 0) holes.push(flat.length / 2);
    const ring = rings[r]!;
    for (let i = 0; i < ring.length; i++) flat.push(ring[i]!);
  }
  const indices = earcut(flat, holes, 2);
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t]! * 2;
    const b = indices[t + 1]! * 2;
    const c = indices[t + 2]! * 2;
    const cross = (flat[b]! - flat[a]!) * (flat[c + 1]! - flat[a + 1]!) - (flat[c]! - flat[a]!) * (flat[b + 1]! - flat[a + 1]!);
    if (cross < 0) {
      const tmp = indices[t + 1]!;
      indices[t + 1] = indices[t + 2]!;
      indices[t + 2] = tmp;
    }
  }
  return { flat, indices };
}
