import type { Layer, LayerContext } from '../../core/layers/Layer';
import type { TimeState } from '../../core/time/types';
import { Movers, type MoverKind } from '../traffic/Movers';
import { PathNetwork } from '../traffic/PathNetwork';
import { barge, countryBoat, ferry } from '../traffic/vehicleModels';

const BOAT_KINDS: MoverKind[] = [
  { weight: 2, model: ferry, colors: [0xf2f2ee, 0xdfe7ee], speed: 3.2 },
  { weight: 3.5, model: countryBoat, colors: [0xffffff], speed: 1.3 },
  { weight: 0.8, model: barge, colors: [0x7d3b2b, 0x3c4650, 0x4a5a3a], speed: 2.0 },
];

/**
 * SIMULATED river traffic: ferry launches, country boats and barges moving along lanes derived from OSM's river centre lines, kept to the
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
    this.fleets.push(new Movers(network, BOAT_KINDS, Math.max(4, Math.round(network.totalLength / 700)), 0, -0.25, 77)); // hulls sit a little into the water
    for (const fleet of this.fleets) ctx.scene.add(...fleet.meshes);
  }

  update(time: TimeState, dt: number): void {
    for (const fleet of this.fleets) fleet.update(time.paused ? 0 : dt, 1);
  }

  setVisible(visible: boolean): void {
    for (const fleet of this.fleets) fleet.setVisible(visible);
  }

  dispose(): void {
    for (const fleet of this.fleets) {
      this.ctx?.scene.remove(...fleet.meshes);
      fleet.dispose();
    }
    this.fleets = [];
  }
}
