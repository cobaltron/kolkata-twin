/**
 * Stage 5 of the generated pixel map: cut the finished painting into a zoomable tile pyramid for the app.
 * Run: npx tsx tools/pixelmap/tiles.ts pilot
 * In:  data/pixelmap/<name>/finished.png, ortho_meta.json
 * Out: public/data/pixelmap/<name>/tiles/<z>/<x>_<y>.webp   512 px tiles; the highest z is full resolution
 *      public/data/pixelmap/<name>/meta.json               camera, size, zoom range, credits
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';

sharp.cache(false);
const ROOT = new URL('../..', import.meta.url);
const name = process.argv[2] ?? 'pilot';
const cfg = JSON.parse(readFileSync(new URL(`config/pixelmap/${name}.json`, ROOT), 'utf8'));
const src = new URL(`data/pixelmap/${name}/`, ROOT);
const out = new URL(`public/data/pixelmap/${name}/`, ROOT);
const TILE = 512;
const W = cfg.cols * cfg.quadrant_px, H = cfg.rows * cfg.quadrant_px;
const maxZoom = Math.ceil(Math.log2(Math.max(W, H) / TILE));

rmSync(new URL('tiles/', out), { recursive: true, force: true });
let count = 0, bytes = 0;
for (let z = maxZoom; z >= 0; z--) {
  const scale = 2 ** (z - maxZoom);
  const w = Math.max(1, Math.round(W * scale)), h = Math.max(1, Math.round(H * scale));
  const level = await sharp(new URL('finished.png', src).pathname, { limitInputPixels: false }).resize(w, h, { kernel: 'lanczos3' }).raw().toBuffer();
  mkdirSync(new URL(`tiles/${z}/`, out), { recursive: true });
  for (let ty = 0; ty * TILE < h; ty++) {
    for (let tx = 0; tx * TILE < w; tx++) {
      const width = Math.min(TILE, w - tx * TILE), height = Math.min(TILE, h - ty * TILE);
      const file = new URL(`tiles/${z}/${tx}_${ty}.webp`, out).pathname;
      const info = await sharp(level, { raw: { width: w, height: h, channels: 3 } }).extract({ left: tx * TILE, top: ty * TILE, width, height }).webp({ quality: 84 }).toFile(file);
      count++;
      bytes += info.size;
    }
  }
}
const ortho = JSON.parse(readFileSync(new URL('ortho_meta.json', src), 'utf8')) as { attributions: string[] };
writeFileSync(new URL('meta.json', out), JSON.stringify({
  name, description: cfg.description,
  width: W, height: H, tileSize: TILE, maxZoom,
  camera: { lat: cfg.lat, lon: cfg.lon, azimuthDeg: cfg.camera_azimuth_degrees, elevationDeg: cfg.camera_elevation_degrees, metresPerPixel: cfg.meters_per_pixel },
  generatedAt: new Date().toISOString(),
  credits: {
    imagery: ['Google', ...ortho.attributions],
    painter: 'FLUX.2 [klein] 4B with the Isometric Mumbai LoRA by Flash1405 (both Apache 2.0)',
    method: 'After flash1405/isometric-mumbai and cannoneyed/isometric-nyc (MIT)',
    buildings: '© OpenStreetMap contributors (ODbL); heights partly Google Open Buildings 2.5D (CC BY 4.0)',
  },
  notice: 'Painted by a generative model from satellite imagery and a block model. Buildings, colours and details may be invented; this is not a map to rely on.',
}, null, 2));
console.log(`${count} tiles, ${(bytes / 1e6).toFixed(1)} MB, zoom 0..${maxZoom}`);
