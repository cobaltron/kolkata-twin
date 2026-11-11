import { WebGLRenderer } from 'three';
import type { PathSet } from '../data/protocol';
import { randomStream } from '../layers/traffic/Movers';
import { PathNetwork, type Cursor, type Pose } from '../layers/traffic/PathNetwork';
import { ambassadorTaxi, autoRickshaw, barge, bus, countryBoat, cycleRickshaw, ferry, handRickshaw, hatchback, tram } from '../layers/traffic/vehicleModels';
import { HEADINGS, renderSpriteSheet, type SpriteSheet } from './sprites';

interface Kind {
  sheets: SpriteSheet[];
  speed: number;
  /** Metres to the left of the centre line. */
  lateral: number;
}
interface Mover {
  cursor: Cursor;
  kind: Kind;
  sheet: SpriteSheet;
  speed: number;
}
interface Fleet {
  network: PathNetwork;
  movers: Mover[];
  /** True for road traffic, whose numbers follow the time of day. */
  daily: boolean;
}

export interface DrawTransform {
  /** Screen pixels per full-zoom map pixel. */
  scale: number;
  /** Screen position of map pixel (0, 0). */
  originX: number;
  originY: number;
  width: number;
  height: number;
}

/**
 * SIMULATED vehicles and boats for the painted map: sprites that follow OSM road, tram and river
 * centre lines. Same invented fleet as the 3D view's traffic layer; not traffic data.
 */
export class PaintedTraffic {
  private readonly fleets: Fleet[] = [];
  private readonly random = randomStream(4711);
  private readonly pose: Pose = { x: 0, y: 0, dx: 1, dy: 0 };
  private readonly visible: Array<{ x: number; y: number; m: Mover; heading: number }> = [];

  /**
   * @param paths centre lines in the map's area frame (metres east and north of its centre)
   * @param project area-frame point -> full-zoom map pixel
   */
  constructor(paths: { roads: PathSet; trams: PathSet; river: PathSet }, private readonly project: (east: number, north: number) => [number, number], azimuthDeg: number, elevationDeg: number, metresPerPixel: number) {
    const renderer = new WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
    const sheet = (model: () => ReturnType<typeof bus>, tints: number[]): SpriteSheet[] => tints.map((t) => renderSpriteSheet(renderer, model(), t, azimuthDeg, elevationDeg, metresPerPixel));
    const road: Array<[Kind, number]> = [
      [{ sheets: sheet(ambassadorTaxi, [0xffffff]), speed: 9, lateral: 2.6 }, 3],
      [{ sheets: sheet(hatchback, [0xf1f1ee, 0xb9bcc0, 0x9c2f2a, 0x2f3a4a]), speed: 10, lateral: 2.6 }, 5],
      [{ sheets: sheet(bus, [0x2c5fa5, 0xc23b32, 0xe8e2d0]), speed: 7.5, lateral: 2.8 }, 1.2],
      [{ sheets: sheet(autoRickshaw, [0xffffff]), speed: 7, lateral: 2.8 }, 1.8],
      [{ sheets: sheet(cycleRickshaw, [0xffffff]), speed: 3, lateral: 4.6 }, 0.9],
      [{ sheets: sheet(handRickshaw, [0xffffff]), speed: 1.6, lateral: 5 }, 0.35],
    ];
    const trams: Array<[Kind, number]> = [[{ sheets: sheet(tram, [0xffffff]), speed: 5, lateral: 0 }, 1]];
    const boats: Array<[Kind, number]> = [
      [{ sheets: sheet(ferry, [0xf2f2ee]), speed: 3.2, lateral: 0 }, 2],
      [{ sheets: sheet(countryBoat, [0xffffff]), speed: 1.3, lateral: 0 }, 3.5],
      [{ sheets: sheet(barge, [0x7d3b2b, 0x3c4650]), speed: 2, lateral: 0 }, 0.8],
    ];
    renderer.dispose();
    // Fleet sizes follow the length of line inside the map: invented densities, chosen to look busy but readable.
    this.addFleet(new PathNetwork(paths.roads), road, 1 / 55, true);
    this.addFleet(new PathNetwork(paths.trams), trams, 1 / 900, true);
    this.addFleet(new PathNetwork(paths.river, 200), boats, 1 / 450, false);
  }

  private addFleet(network: PathNetwork, kinds: Array<[Kind, number]>, perMetre: number, daily: boolean): void {
    const movers: Mover[] = [];
    if (network.paths.length > 0) {
      const count = Math.round(network.totalLength * perMetre);
      const total = kinds.reduce((sum, [, w]) => sum + w, 0);
      for (let i = 0; i < count; i++) {
        let pick = this.random() * total;
        const kind = (kinds.find(([, w]) => (pick -= w) < 0) ?? kinds[0]!)[0];
        movers.push({ cursor: network.place(this.random(), this.random()), kind, sheet: kind.sheets[Math.floor(this.random() * kind.sheets.length)]!, speed: kind.speed * (0.8 + 0.4 * this.random()) });
      }
    }
    this.fleets.push({ network, movers, daily });
  }

  get count(): number {
    return this.fleets.reduce((sum, f) => sum + f.movers.length, 0);
  }

  /** Advance every mover by `dt` seconds; `activity` (0..1) is the share of road traffic on the move. */
  step(dt: number, activity: number): void {
    if (dt <= 0) return;
    for (const fleet of this.fleets) {
      const active = fleet.daily ? Math.round(fleet.movers.length * activity) : fleet.movers.length;
      for (let i = 0; i < active; i++) fleet.network.advance(fleet.movers[i]!.cursor, fleet.movers[i]!.speed * dt, this.random());
    }
  }

  draw(ctx: CanvasRenderingContext2D, t: DrawTransform, activity: number): void {
    this.visible.length = 0;
    for (const fleet of this.fleets) {
      const active = fleet.daily ? Math.round(fleet.movers.length * activity) : fleet.movers.length;
      for (let i = 0; i < active; i++) {
        const m = fleet.movers[i]!;
        const p = fleet.network.pose(m.cursor, this.pose);
        // Left of the direction of travel is (-dy, dx): India drives on the left.
        const [px, py] = this.project(p.x - p.dy * m.kind.lateral, p.y + p.dx * m.kind.lateral);
        const x = t.originX + px * t.scale, y = t.originY + py * t.scale;
        if (x < -80 || y < -80 || x > t.width + 80 || y > t.height + 80) continue;
        this.visible.push({ x, y, m, heading: Math.atan2(p.dy, p.dx) });
      }
    }
    // Painter's order: things lower on the screen are nearer the camera.
    this.visible.sort((a, b) => a.y - b.y);
    ctx.imageSmoothingEnabled = t.scale < 1.5;
    for (const v of this.visible) {
      const s = v.m.sheet;
      const index = ((Math.round((v.heading / (Math.PI * 2)) * HEADINGS) % HEADINGS) + HEADINGS) % HEADINGS;
      const size = s.cell * s.scale * t.scale;
      ctx.drawImage(s.canvas, index * s.cell, 0, s.cell, s.cell, v.x - size / 2, v.y - size / 2, size, size);
    }
  }
}
