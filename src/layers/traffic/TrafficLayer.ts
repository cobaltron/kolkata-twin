import type { Layer, LayerContext } from '../../core/layers/Layer';
import { toIst } from '../../core/time/ist';
import type { TimeState } from '../../core/time/types';
import { Movers, type MoverKind } from './Movers';
import { ambassadorTaxi, autoRickshaw, bus, cycleRickshaw, handRickshaw, hatchback, tram } from './vehicleModels';
import { PathNetwork } from './PathNetwork';

// Vehicle mix: proportions, colours and speeds are a stylised impression, not a survey.
const ROAD_KINDS: MoverKind[] = [
  { weight: 3, model: ambassadorTaxi, colors: [0xffffff], speed: 9 },
  { weight: 5, model: hatchback, colors: [0xf1f1ee, 0xb9bcc0, 0x8a8f96, 0x9c2f2a, 0x2f3a4a, 0x1f1f22], speed: 10 },
  { weight: 1.2, model: bus, colors: [0x2c5fa5, 0xc23b32, 0xe8e2d0], speed: 7.5 },
  { weight: 1.8, model: autoRickshaw, colors: [0xffffff], speed: 7 },
  { weight: 0.9, model: cycleRickshaw, colors: [0xffffff], speed: 3, kerbOffset: 2.2 },
  { weight: 0.35, model: handRickshaw, colors: [0xffffff], speed: 1.6, kerbOffset: 2.6 },
];
const TRAM_KINDS: MoverKind[] = [{ weight: 1, model: tram, colors: [0xffffff], speed: 5 }];

/** Share of the fleet on the road by hour of day (IST). An assumed curve: quiet at night, peaks morning and evening. */
export function activityByHour(hour: number): number {
  const peak = (centre: number, width: number): number => Math.exp(-(((hour - centre) / width) ** 2));
  return Math.min(1, 0.12 + 0.9 * Math.max(peak(10, 2.6), peak(18.5, 3)) + 0.45 * peak(14, 3));
}

/**
 * SIMULATED traffic and trams. Low-poly vehicles (yellow Ambassador cabs, cars, buses, auto-, cycle- and
 * hand-pulled rickshaws) follow OSM main-road centre lines, keeping left,
 * and trams follow OSM tram track. There is no real traffic, timetable or signal data behind this:
 * counts, routes, speeds and the daily rhythm are invented for atmosphere. Movement runs in real time
 * (not at the playback speed) and stops when time is paused.
 */
export class TrafficLayer implements Layer {
  readonly id = 'traffic';
  readonly label = 'Traffic & trams (simulated)';
  private ctx: LayerContext | null = null;
  private road: Movers | null = null;
  private tram: Movers | null = null;

  async load(ctx: LayerContext): Promise<void> {
    this.ctx = ctx;
    const { paths } = await ctx.cityData.load();
    this.road = new Movers(new PathNetwork(paths.roads), ROAD_KINDS, ctx.quality.maxVehicles, 2.6, 0.08, 20261);
    const tramNetwork = new PathNetwork(paths.trams);
    // One tram per ~1.2 km of track that still exists in OSM.
    this.tram = new Movers(tramNetwork, TRAM_KINDS, Math.min(40, Math.round(tramNetwork.totalLength / 1200)), 0, 0.1, 1873);
    ctx.scene.add(...this.road.meshes, ...this.tram.meshes);
  }

  update(time: TimeState, dt: number): void {
    const step = time.paused ? 0 : dt;
    const activity = activityByHour(toIst(time.instant).hours);
    this.road?.update(step, activity);
    this.tram?.update(step, activity > 0.3 ? 1 : 0.25);
  }

  setVisible(visible: boolean): void {
    this.road?.setVisible(visible);
    this.tram?.setVisible(visible);
  }

  dispose(): void {
    for (const fleet of [this.road, this.tram]) {
      if (!fleet) continue;
      this.ctx?.scene.remove(...fleet.meshes);
      fleet.dispose();
    }
  }
}
