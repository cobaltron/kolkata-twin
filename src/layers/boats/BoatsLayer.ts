import type { Layer, LayerContext } from '../../core/layers/Layer';
import type { TimeState } from '../../core/time/types';
import { Movers, type MoverKind } from '../traffic/Movers';
import { PathNetwork } from '../traffic/PathNetwork';

const BOAT_KINDS: MoverKind[] = [
  { weight: 2, length: 22, width: 6, height: 3.2, colors: [0xf0f0ec, 0xd9e2ea], speed: 3.2 }, // ferry launch
  { weight: 3, length: 9, width: 2.2, height: 1.1, colors: [0x6b4a2f, 0x54402e, 0x2f2b28], speed: 1.4 }, // country boat
  { weight: 1, length: 36, width: 8, height: 3, colors: [0x7d3b2b, 0x3c4650], speed: 2.2 }, // barge
];

/**
 * SIMULATED river traffic: boxes moving along lanes derived from OSM's river centre lines, kept to the
 * stretches that lie on mapped water (see city.worker.ts).
 * Not ferry routes or AIS data; vessel types, counts and speeds are invented for atmosphere.
 */
export class BoatsLayer implements Layer {
  readonly id = 'boats';
  readonly label = 'River boats (simulated)';
  private ctx: LayerContext | null = null;
  private fleets: Movers[] = [];

  async load(ctx: LayerContext): Promise<void> {
    this.ctx = ctx;
    const network = new PathNetwork((await ctx.cityData.load()).paths.river, 200);
    if (network.paths.length === 0) throw new Error('No river centre line in the map data');
    // About one vessel per 700 m of lane.
    this.fleets.push(new Movers(network, BOAT_KINDS, Math.max(4, Math.round(network.totalLength / 700)), 0, 0.15, 77));
    for (const fleet of this.fleets) ctx.scene.add(fleet.mesh);
  }

  update(time: TimeState, dt: number): void {
    for (const fleet of this.fleets) fleet.update(time.paused ? 0 : dt, 1);
  }

  setVisible(visible: boolean): void {
    for (const fleet of this.fleets) fleet.mesh.visible = visible;
  }

  dispose(): void {
    for (const fleet of this.fleets) {
      this.ctx?.scene.remove(fleet.mesh);
      fleet.dispose();
    }
    this.fleets = [];
  }
}
