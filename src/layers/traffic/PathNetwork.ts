import type { PathSet } from '../../data/protocol';

interface Path {
  /** x, y pairs in local metres. */
  xy: Float32Array;
  /** Cumulative length at each vertex. */
  cum: Float32Array;
  length: number;
}
interface Link {
  path: number;
  /** True when the link joins at the path's first vertex (so travel continues forwards). */
  atStart: boolean;
}

/** A mover's position on the network. */
export interface Cursor {
  path: number;
  /** Distance from the path's first vertex, metres. */
  s: number;
  /** +1 travelling first-to-last vertex, -1 the other way. */
  dir: 1 | -1;
  /** Cached segment index, to avoid searching every frame. */
  seg: number;
}

export interface Pose {
  x: number;
  y: number;
  /** Unit direction of travel in local metres. */
  dx: number;
  dy: number;
}

/**
 * Polylines joined at shared end points, so movers can run from one OSM way onto the next.
 * Purely geometric: no turn restrictions, one-way rules or signals are modelled.
 */
export class PathNetwork {
  readonly paths: Path[] = [];
  private readonly nodes = new Map<string, Link[]>();

  constructor(set: PathSet, minLength = 15) {
    for (let i = 0; i < set.offsets.length - 1; i++) {
      const xy = set.xy.subarray(set.offsets[i]!, set.offsets[i + 1]!);
      const n = xy.length / 2;
      if (n < 2) continue;
      const cum = new Float32Array(n);
      for (let k = 1; k < n; k++) cum[k] = cum[k - 1]! + Math.hypot(xy[k * 2]! - xy[k * 2 - 2]!, xy[k * 2 + 1]! - xy[k * 2 - 1]!);
      const length = cum[n - 1]!;
      if (length < minLength) continue;
      const index = this.paths.push({ xy, cum, length }) - 1;
      this.link(xy[0]!, xy[1]!, { path: index, atStart: true });
      this.link(xy[n * 2 - 2]!, xy[n * 2 - 1]!, { path: index, atStart: false });
    }
  }

  get totalLength(): number {
    return this.paths.reduce((sum, p) => sum + p.length, 0);
  }

  private key(x: number, y: number): string {
    return `${Math.round(x)},${Math.round(y)}`; // 1 m snap joins ways split at a shared node
  }
  private link(x: number, y: number, link: Link): void {
    const k = this.key(x, y);
    const list = this.nodes.get(k);
    if (list) list.push(link);
    else this.nodes.set(k, [link]);
  }

  /** A cursor at a pseudo-random place, weighted by path length. `u` and `v` are in 0..1. */
  place(u: number, v: number): Cursor {
    let target = u * this.totalLength;
    let path = 0;
    for (; path < this.paths.length - 1; path++) {
      if (target < this.paths[path]!.length) break;
      target -= this.paths[path]!.length;
    }
    return { path, s: Math.min(target, this.paths[path]!.length), dir: v < 0.5 ? 1 : -1, seg: 0 };
  }

  /** Move along the network. `pick` (0..1) chooses the branch at a junction. */
  advance(c: Cursor, distance: number, pick: number): void {
    let remaining = distance;
    for (let hops = 0; hops < 8; hops++) {
      const p = this.paths[c.path]!;
      const room = c.dir === 1 ? p.length - c.s : c.s;
      if (remaining <= room) {
        c.s += remaining * c.dir;
        return;
      }
      remaining -= room;
      const n = p.xy.length / 2;
      const end = c.dir === 1 ? n - 1 : 0;
      const options = (this.nodes.get(this.key(p.xy[end * 2]!, p.xy[end * 2 + 1]!)) ?? []).filter((l) => l.path !== c.path);
      if (options.length === 0) {
        c.dir = c.dir === 1 ? -1 : 1; // dead end: turn round
        c.s = c.dir === 1 ? 0 : p.length;
      } else {
        const next = options[Math.min(options.length - 1, Math.floor(pick * options.length))]!;
        c.path = next.path;
        c.dir = next.atStart ? 1 : -1;
        c.s = next.atStart ? 0 : this.paths[next.path]!.length;
      }
      c.seg = 0;
    }
  }

  pose(c: Cursor, out: Pose): Pose {
    const p = this.paths[c.path]!;
    const n = p.xy.length / 2;
    let seg = Math.min(c.seg, n - 2);
    while (seg < n - 2 && p.cum[seg + 1]! < c.s) seg++;
    while (seg > 0 && p.cum[seg]! > c.s) seg--;
    c.seg = seg;
    const x0 = p.xy[seg * 2]!, y0 = p.xy[seg * 2 + 1]!, x1 = p.xy[seg * 2 + 2]!, y1 = p.xy[seg * 2 + 3]!;
    const len = p.cum[seg + 1]! - p.cum[seg]! || 1;
    const t = (c.s - p.cum[seg]!) / len;
    out.x = x0 + (x1 - x0) * t;
    out.y = y0 + (y1 - y0) * t;
    out.dx = ((x1 - x0) / len) * c.dir;
    out.dy = ((y1 - y0) / len) * c.dir;
    return out;
  }
}
