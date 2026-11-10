import type { MeshBuilder } from './MeshBuffers';
import type { RGB } from './extrude';

const MITER_LIMIT = 2.5;

/** Append a flat ribbon of `width` metres along a polyline ([x0, y0, x1, y1, ...], local metres). */
export function ribbon(out: MeshBuilder, line: ArrayLike<number>, width: number, y: number, color: RGB): void {
  // Drop consecutive duplicates.
  const pts: number[] = [];
  for (let i = 0; i < line.length; i += 2) {
    const x = line[i]!, yy = line[i + 1]!;
    const n = pts.length;
    if (n >= 2 && Math.hypot(x - pts[n - 2]!, yy - pts[n - 1]!) < 0.05) continue;
    pts.push(x, yy);
  }
  const n = pts.length / 2;
  if (n < 2) return;
  const half = width / 2;
  const v0 = out.vertexCount;
  for (let i = 0; i < n; i++) {
    const px = pts[i * 2]!, py = pts[i * 2 + 1]!;
    // Left-hand normals of the incoming and outgoing segments.
    let inX = 0, inY = 0, outX = 0, outY = 0;
    if (i > 0) {
      const dx = px - pts[i * 2 - 2]!, dy = py - pts[i * 2 - 1]!;
      const l = Math.hypot(dx, dy);
      inX = -dy / l; inY = dx / l;
    }
    if (i < n - 1) {
      const dx = pts[i * 2 + 2]! - px, dy = pts[i * 2 + 3]! - py;
      const l = Math.hypot(dx, dy);
      outX = -dy / l; outY = dx / l;
    }
    if (i === 0) { inX = outX; inY = outY; }
    if (i === n - 1) { outX = inX; outY = inY; }
    let mx = inX + outX, my = inY + outY;
    const ml = Math.hypot(mx, my);
    if (ml < 1e-6) { mx = inX; my = inY; } else { mx /= ml; my /= ml; }
    const scale = half * Math.min(1 / Math.max(mx * inX + my * inY, 1e-3), MITER_LIMIT);
    out.positions.push(px + mx * scale, y, -(py + my * scale), px - mx * scale, y, -(py - my * scale));
    out.colors.push(color[0], color[1], color[2], color[0], color[1], color[2]);
  }
  for (let i = 0; i < n - 1; i++) {
    const l0 = v0 + i * 2, r0 = l0 + 1, l1 = l0 + 2, r1 = l0 + 3;
    out.indices.push(r0, r1, l1, r0, l1, l0);
  }
}
