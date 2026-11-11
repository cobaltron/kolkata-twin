import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { TimeState } from '../core/time/types';
import { toIst } from '../core/time/ist';
import type { CityGeometry, PathSet } from '../data/protocol';
import { activityByHour } from '../layers/traffic/TrafficLayer';
import { areaFrame, mapProjector } from '../shared/pixelmap';
import type { LocalFrame } from '../shared/projection';
import { PaintedTraffic } from './PaintedTraffic';

export interface PaintedMeta {
  name: string;
  description: string;
  width: number;
  height: number;
  tileSize: number;
  maxZoom: number;
  camera: { lat: number; lon: number; azimuthDeg: number; elevationDeg: number; metresPerPixel: number };
  occlusion?: { file: string; scale: number };
  credits: { imagery: string[]; painter: string; method: string; buildings: string };
  notice: string;
}

/** Fetch the painted map's description, or null when no painted map has been built. */
export async function loadPaintedMeta(name: string): Promise<PaintedMeta | null> {
  try {
    const res = await fetch(new URL(`data/pixelmap/${name}/meta.json`, document.baseURI));
    return res.ok ? ((await res.json()) as PaintedMeta) : null;
  } catch {
    return null;
  }
}

/**
 * The painted map: a pannable, zoomable isometric painting of the city (Leaflet over a tile
 * pyramid) with simulated vehicles and boats drawn on top. The painting is made offline by a
 * generative model (tools/pixelmap); the viewer says so and credits its sources.
 */
export class PaintedMapView {
  private readonly map: L.Map;
  private readonly canvas = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  private traffic: PaintedTraffic | null = null;
  private readonly toArea: (lon: number, lat: number) => [number, number];
  private readonly project: (east: number, north: number) => [number, number];
  private zooming = false;

  constructor(private readonly root: HTMLElement, private readonly meta: PaintedMeta, private readonly baseUrl: string, private readonly utm: LocalFrame) {
    const { camera } = meta;
    this.toArea = areaFrame(camera.lat, camera.lon);
    this.project = mapProjector({ ...camera, width: meta.width, height: meta.height });

    this.map = L.map(root, { crs: L.CRS.Simple, minZoom: 0, maxZoom: meta.maxZoom + 2, zoomSnap: 0.25, zoomDelta: 0.5, wheelPxPerZoomLevel: 90, attributionControl: true, zoomControl: false, maxBoundsViscosity: 0.8 });
    L.control.zoom({ position: 'bottomleft' }).addTo(this.map);
    this.map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');
    const bounds = L.latLngBounds(this.map.unproject([0, meta.height], meta.maxZoom), this.map.unproject([meta.width, 0], meta.maxZoom));
    const Tiles = L.TileLayer.extend({
      getTileUrl: (c: L.Coords) => `${baseUrl}tiles/${c.z}/${c.x}_${c.y}.webp`,
    }) as unknown as new (url: string, options: L.TileLayerOptions) => L.TileLayer;
    new Tiles('', {
      tileSize: meta.tileSize, minZoom: 0, maxZoom: meta.maxZoom + 2, maxNativeZoom: meta.maxZoom, bounds, noWrap: true,
      attribution: `Painted by a generative model; details may be invented · Imagery: ${meta.credits.imagery.join(', ')} · Buildings: ${meta.credits.buildings} · Vehicles are simulated`,
    }).addTo(this.map);
    this.map.setMaxBounds(bounds.pad(0.2));
    this.map.fitBounds(bounds);
    this.map.setZoom(Math.max(this.map.getZoom(), meta.maxZoom - 2));

    this.canvas.className = 'painted-traffic';
    root.append(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    // During Leaflet's animated zoom the tiles are CSS-scaled; the vehicles sit that out.
    this.map.on('zoomstart', () => (this.zooming = true));
    this.map.on('zoomend', () => (this.zooming = false));
  }

  /** Build the simulated fleet from the app's road, tram and river lines (app frame -> map frame). */
  setCity(city: CityGeometry): void {
    const convert = (set: PathSet): PathSet => {
      const xy = new Float32Array(set.xy.length);
      const keep: number[] = [];
      for (let i = 0; i < set.offsets.length - 1; i++) {
        let inside = false;
        for (let k = set.offsets[i]!; k < set.offsets[i + 1]!; k += 2) {
          const ll = this.utm.toLonLat(set.xy[k]!, set.xy[k + 1]!);
          const [e, n] = this.toArea(ll.lon, ll.lat);
          xy[k] = e;
          xy[k + 1] = n;
          const [px, py] = this.project(e, n);
          if (px > -100 && py > -100 && px < this.meta.width + 100 && py < this.meta.height + 100) inside = true;
        }
        if (inside) keep.push(i);
      }
      // Keep only lines that touch the painted area.
      const offsets = new Uint32Array(keep.length + 1);
      const parts: Float32Array[] = [];
      keep.forEach((i, j) => {
        const part = xy.subarray(set.offsets[i]!, set.offsets[i + 1]!);
        parts.push(part);
        offsets[j + 1] = offsets[j]! + part.length;
      });
      const packed = new Float32Array(offsets[keep.length]!);
      parts.forEach((p, j) => packed.set(p, offsets[j]!));
      return { xy: packed, offsets };
    };
    const { camera } = this.meta;
    const traffic = new PaintedTraffic({ roads: convert(city.paths.roads), trams: convert(city.paths.trams), river: convert(city.paths.river) }, this.project, camera.azimuthDeg, camera.elevationDeg, camera.metresPerPixel);
    this.traffic = traffic;
    void this.loadOcclusion(traffic);
  }

  private async loadOcclusion(traffic: PaintedTraffic): Promise<void> {
    const o = this.meta.occlusion;
    if (!o) return;
    try {
      const image = new Image();
      image.src = this.baseUrl + o.file;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(image, 0, 0);
      const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const mask = new Uint8Array(canvas.width * canvas.height);
      for (let i = 0; i < mask.length; i++) mask[i] = rgba[i * 4]! > 127 ? 1 : 0;
      traffic.setOcclusion(mask, canvas.width, canvas.height, o.scale);
    } catch (err) {
      console.warn('Painted map: building silhouettes unavailable, vehicles will not be hidden behind buildings', err);
    }
  }

  get vehicleCount(): number {
    return this.traffic?.count ?? 0;
  }

  setVisible(visible: boolean): void {
    this.root.hidden = !visible;
    if (visible) this.map.invalidateSize();
  }

  /** Pan to a place given in the app's frame (metres east and north of the study-area centre). */
  flyTo(x: number, y: number): void {
    const ll = this.utm.toLonLat(x, y);
    const [e, n] = this.toArea(ll.lon, ll.lat);
    const [px, py] = this.project(e, n);
    if (px < 0 || py < 0 || px > this.meta.width || py > this.meta.height) return; // outside the painted area
    this.map.flyTo(this.map.unproject([px, py], this.meta.maxZoom), this.meta.maxZoom, { duration: 1.2 });
  }

  /** Called once per frame while the painted map is showing. */
  update(time: TimeState, dt: number): void {
    const traffic = this.traffic;
    if (!traffic) return;
    const activity = activityByHour(toIst(time.instant).hours);
    traffic.step(time.paused ? 0 : dt, activity);

    const size = this.map.getSize(), ratio = Math.min(devicePixelRatio, 2);
    if (this.canvas.width !== Math.round(size.x * ratio) || this.canvas.height !== Math.round(size.y * ratio)) {
      this.canvas.width = Math.round(size.x * ratio);
      this.canvas.height = Math.round(size.y * ratio);
      this.canvas.style.width = `${size.x}px`;
      this.canvas.style.height = `${size.y}px`;
    }
    this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.ctx.clearRect(0, 0, size.x, size.y);
    const zoom = this.map.getZoom();
    // Vehicles are specks when zoomed far out, and are skipped during the animated zoom.
    if (this.zooming || zoom < this.meta.maxZoom - 2.5) return;
    const origin = this.map.latLngToContainerPoint(this.map.unproject([0, 0], this.meta.maxZoom));
    traffic.draw(this.ctx, { scale: 2 ** (zoom - this.meta.maxZoom), originX: origin.x, originY: origin.y, width: size.x, height: size.y }, activity);
  }
}
