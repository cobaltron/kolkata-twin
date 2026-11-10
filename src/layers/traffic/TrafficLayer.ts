import type { Layer, LayerContext } from '../../core/layers/Layer';
import { toIst } from '../../core/time/ist';
import type { TimeState } from '../../core/time/types';
import { Movers, type MoverKind } from './Movers';
import { PathNetwork } from './PathNetwork';

// Vehicle mix: colours and proportions are a stylised impression, not a survey.
const ROAD_KINDS: MoverKind[] = [
  { weight: 3, length: 4.3, width: 1.7, height: 1.6, colors: [0xf2c200], speed: 9 }, // yellow taxi
  { weight: 6, length: 4.2, width: 1.7, height: 1.5, colors: [0xf1f1ee, 0xb9bcc0, 0x8a8f96, 0x9c2f2a, 0x2f3a4a], speed: 10 }, // cars
  { weight: 1.2, length: 10.5, width: 2.5, height: 3.1, colors: [0x2c5fa5, 0xc23b32], speed: 7.5 }, // buses
  { weight: 1.5, length: 2.7, width: 1.3, height: 1.8, colors: [0x2f6b3c, 0xe2c21a], speed: 7 }, // auto-rickshaws
];
const TRAM_KINDS: MoverKind[] = [{ weight: 1, length: 16, width: 2.3, height: 3.3, colors: [0xe9edf1, 0x3d6da8], speed: 5 }];

/** Share of the fleet on the road by hour of day (IST). An assumed curve: quiet at night, peaks morning and evening. */
export function activityByHour(hour: number): number {
  const peak = (centre: number, width: number): number => Math.exp(-(((hour - centre) / width) ** 2));
  return Math.min(1, 0.12 + 0.9 * Math.max(peak(10, 2.6), peak(18.5, 3)) + 0.45 * peak(14, 3));
}

/**
 * SIMULATED traffic and trams. Vehicles are boxes that follow OSM main-road centre lines (keeping left)
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
    this.road = new Movers(new PathNetwork(paths.roads), ROAD_KINDS, ctx.quality.maxVehicles, 2.6, 0.25, 20261);
    const tramNetwork = new PathNetwork(paths.trams);
    // One tram per ~1.2 km of track that still exists in OSM.
    this.tram = new Movers(tramNetwork, TRAM_KINDS, Math.min(40, Math.round(tramNetwork.totalLength / 1200)), 0, 0.3, 1873);
    ctx.scene.add(this.road.mesh, this.tram.mesh);
  }

  update(time: TimeState, dt: number): void {
    const step = time.paused ? 0 : dt;
    const activity = activityByHour(toIst(time.instant).hours);
    this.road?.update(step, activity);
    this.tram?.update(step, activity > 0.3 ? 1 : 0.25);
  }

  setVisible(visible: boolean): void {
    if (this.road) this.road.mesh.visible = visible;
    if (this.tram) this.tram.mesh.visible = visible;
  }

  dispose(): void {
    for (const fleet of [this.road, this.tram]) {
      if (!fleet) continue;
      this.ctx?.scene.remove(fleet.mesh);
      fleet.dispose();
    }
  }
}
