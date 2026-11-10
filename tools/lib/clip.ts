/** Rectangle clipping in lon/lat space, applied before projection. */
import type { BBox } from '../../src/shared/projection.ts';

export type Pt = [number, number];

/** Sutherland-Hodgman clip of a closed ring (first point not repeated) against a rectangle. */
export function clipRing(ring: Pt[], b: BBox): Pt[] {
  const edges: Array<{ inside: (p: Pt) => boolean; cut: (a: Pt, c: Pt) => Pt }> = [
    { inside: (p) => p[0] >= b.west, cut: (a, c) => atX(a, c, b.west) },
    { inside: (p) => p[0] <= b.east, cut: (a, c) => atX(a, c, b.east) },
    { inside: (p) => p[1] >= b.south, cut: (a, c) => atY(a, c, b.south) },
    { inside: (p) => p[1] <= b.north, cut: (a, c) => atY(a, c, b.north) },
  ];
  let out = ring;
  for (const e of edges) {
    const input = out;
    out = [];
    for (let i = 0; i < input.length; i++) {
      const cur = input[i]!;
      const prev = input[(i + input.length - 1) % input.length]!;
      const curIn = e.inside(cur);
      const prevIn = e.inside(prev);
      if (curIn) {
        if (!prevIn) out.push(e.cut(prev, cur));
        out.push(cur);
      } else if (prevIn) out.push(e.cut(prev, cur));
    }
    if (out.length < 3) return [];
  }
  return out;
}

/** Clip a polyline; returns zero or more pieces inside the rectangle. */
export function clipLine(line: Pt[], b: BBox): Pt[][] {
  const pieces: Pt[][] = [];
  let current: Pt[] = [];
  for (let i = 0; i < line.length - 1; i++) {
    const seg = clipSegment(line[i]!, line[i + 1]!, b);
    if (!seg) {
      if (current.length > 1) pieces.push(current);
      current = [];
      continue;
    }
    const [p, q, qClipped] = seg;
    if (current.length === 0) current.push(p);
    else {
      const last = current[current.length - 1]!;
      if (last[0] !== p[0] || last[1] !== p[1]) {
        if (current.length > 1) pieces.push(current);
        current = [p];
      }
    }
    current.push(q);
    if (qClipped) {
      pieces.push(current);
      current = [];
    }
  }
  if (current.length > 1) pieces.push(current);
  return pieces;
}

/** Liang-Barsky. Returns [start, end, endWasClipped] or null if fully outside. */
function clipSegment(a: Pt, c: Pt, b: BBox): [Pt, Pt, boolean] | null {
  const dx = c[0] - a[0];
  const dy = c[1] - a[1];
  let t0 = 0;
  let t1 = 1;
  const tests: Array<[number, number]> = [
    [-dx, a[0] - b.west],
    [dx, b.east - a[0]],
    [-dy, a[1] - b.south],
    [dy, b.north - a[1]],
  ];
  for (const [p, q] of tests) {
    if (p === 0) {
      if (q < 0) return null;
    } else {
      const r = q / p;
      if (p < 0) {
        if (r > t1) return null;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return null;
        if (r < t1) t1 = r;
      }
    }
  }
  return [
    t0 > 0 ? [a[0] + t0 * dx, a[1] + t0 * dy] : a,
    t1 < 1 ? [a[0] + t1 * dx, a[1] + t1 * dy] : c,
    t1 < 1,
  ];
}

function atX(a: Pt, c: Pt, x: number): Pt {
  return [x, a[1] + ((c[1] - a[1]) * (x - a[0])) / (c[0] - a[0])];
}
function atY(a: Pt, c: Pt, y: number): Pt {
  return [a[0] + ((c[0] - a[0]) * (y - a[1])) / (c[1] - a[1]), y];
}

export function ringArea(ring: ArrayLike<number>[]): number {
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i]!;
    const q = ring[(i + 1) % ring.length]!;
    s += p[0]! * q[1]! - q[0]! * p[1]!;
  }
  return s / 2;
}
