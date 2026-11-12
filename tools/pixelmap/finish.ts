/**
 * Stage 4 of the generated pixel map: finishing.
 * Run: npx tsx tools/pixelmap/finish.ts pilot [input.png]
 * In:  data/pixelmap/<name>/generated.png, building_mask.png; public/data/central/city.bin (water polygons, bridges)
 * Out: data/pixelmap/<name>/finished.png
 *
 * Water. The painter chooses a water colour tile by tile, so a wide river comes out as a patchwork.
 * Every pixel that is mapped water (OSM polygons projected through the map camera), is not covered by
 * a building silhouette and is not under a bridge is repainted in one colour, keeping only the fine
 * ripple texture of the painting. Anything the painter drew on the water (boats, pontoons) goes too.
 */
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { decodeCity, ROAD_FLAG } from '../../src/shared/cityFormat.ts';
import { areaFrame, mapProjector } from '../../src/shared/pixelmap.ts';
import { LocalFrame } from '../../src/shared/projection.ts';

sharp.cache(false);
const ROOT = new URL('../..', import.meta.url);
const name = process.argv[2] ?? 'pilot';
const cfg = JSON.parse(readFileSync(new URL(`config/pixelmap/${name}.json`, ROOT), 'utf8'));
const dir = new URL(`data/pixelmap/${name}/`, ROOT);
const W = cfg.cols * cfg.quadrant_px, H = cfg.rows * cfg.quadrant_px;
const project = mapProjector({ lat: cfg.lat, lon: cfg.lon, azimuthDeg: cfg.camera_azimuth_degrees, elevationDeg: cfg.camera_elevation_degrees, metresPerPixel: cfg.meters_per_pixel, width: W, height: H });

const buf = readFileSync(new URL('public/data/central/city.bin', ROOT));
const city = decodeCity(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
const utm = new LocalFrame(city.header.utmZone, { lon: city.header.origin.lon, lat: city.header.origin.lat });
const toArea = areaFrame(cfg.lat, cfg.lon);
const toPixel = (x: number, y: number): string => {
  const ll = utm.toLonLat(x, y);
  const [e, n] = toArea(ll.lon, ll.lat);
  const [px, py] = project(e, n);
  return `${px.toFixed(1)},${py.toFixed(1)}`;
};

// --- water polygons (white) minus bridge decks (black), as one SVG rasterised at map size
const ringCounts = city.section<Uint16Array>('w_ringCounts'), ringSizes = city.section<Uint32Array>('w_ringSizes'), wxy = city.section<Float32Array>('w_xy');
let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="100%" height="100%" fill="black"/>`;
for (let p = 0, ring = 0, cursor = 0; p < ringCounts.length; p++) {
  let d = '';
  for (let r = 0; r < ringCounts[p]!; r++) {
    const n = ringSizes[ring++]!;
    for (let i = 0; i < n; i++) d += `${i === 0 ? 'M' : 'L'}${toPixel(wxy[cursor + i * 2]!, wxy[cursor + i * 2 + 1]!)}`;
    d += 'Z';
    cursor += n * 2;
  }
  svg += `<path d="${d}" fill="white" fill-rule="evenodd"/>`;
}
const rSizes = city.section<Uint32Array>('r_sizes'), rxy = city.section<Float32Array>('r_xy'), rFlags = city.section<Uint8Array>('r_flags'), rWidth = city.section<Float32Array>('r_width');
const tSizes = city.section<Uint32Array>('t_sizes'), txy = city.section<Float32Array>('t_xy'), tFlags = city.section<Uint8Array>('t_flags');
const bridges = (sizes: Uint32Array, xy: Float32Array, flags: Uint8Array, widthM: (i: number) => number): void => {
  for (let i = 0, cursor = 0; i < sizes.length; i++) {
    const n = sizes[i]!;
    if (flags[i]! & ROAD_FLAG.bridge) {
      let pts = '';
      for (let k = 0; k < n; k++) pts += `${toPixel(xy[cursor + k * 2]!, xy[cursor + k * 2 + 1]!)} `;
      svg += `<polyline points="${pts}" fill="none" stroke="black" stroke-width="${(widthM(i) / cfg.meters_per_pixel).toFixed(1)}" stroke-linecap="round" stroke-linejoin="round"/>`;
    }
    cursor += n * 2;
  }
};
// Bridge decks and their trusses are much wider than a carriageway: keep a generous band.
bridges(rSizes, rxy, rFlags, (i) => Math.max(rWidth[i]! * 2.5, 46));
bridges(tSizes, txy, tFlags, () => 24);
svg += '</svg>';
// Blur then threshold shrinks the mask by a few pixels, so shoreline trees and walls are left alone.
/** One byte per pixel, whatever channels the source has (an SVG rasterises with an alpha channel). */
async function singleChannel(image: ReturnType<typeof sharp>): Promise<Buffer> {
  const { data, info } = await image.toColourspace('b-w').raw().toBuffer({ resolveWithObject: true });
  if (info.channels !== 1 || data.length !== W * H) throw new Error(`mask has ${info.channels} channels and ${data.length} bytes; expected 1 channel and ${W * H} bytes`);
  return data;
}
const polygonMask = await singleChannel(sharp(Buffer.from(svg), { limitInputPixels: false }).flatten({ background: '#000' }).extractChannel(0).blur(3).threshold(235));
const buildingMask = await singleChannel(sharp(new URL('building_mask.png', dir).pathname, { limitInputPixels: false }).extractChannel(0).blur(1.5));

const input = process.argv[3] ?? new URL('generated.png', dir).pathname;
const painted = await sharp(input, { limitInputPixels: false }).removeAlpha().raw().toBuffer();
const smooth = await sharp(input, { limitInputPixels: false }).removeAlpha().blur(5).raw().toBuffer();

// One river colour: the median of clearly blue-green painted water.
const samples: number[][] = [[], [], []];
for (let i = 0; i < W * H; i += 97) {
  if (polygonMask[i]! < 128 || buildingMask[i]! > 40) continue;
  const r = painted[i * 3]!, g = painted[i * 3 + 1]!, b = painted[i * 3 + 2]!;
  if (b > r + 18 && g > r + 12 && b > g - 25) { samples[0]!.push(r); samples[1]!.push(g); samples[2]!.push(b); }
}
if (samples[0]!.length < 200) throw new Error('not enough painted water to choose a colour from');
const base = samples.map((s) => s.sort((a, b) => a - b)[s.length >> 1]!);
console.log(`water colour rgb(${base.join(', ')}) from ${samples[0]!.length} samples`);

// Soft alpha at the shoreline: water mask, minus buildings, feathered.
const alphaRaw = Buffer.alloc(W * H);
let waterPixels = 0;
for (let i = 0; i < W * H; i++) {
  const a = polygonMask[i]! >= 128 && buildingMask[i]! < 40 ? 255 : 0;
  alphaRaw[i] = a;
  if (a) waterPixels++;
}
const alpha = await singleChannel(sharp(alphaRaw, { raw: { width: W, height: H, channels: 1 } }).blur(1.2));
const out = Buffer.from(painted);
for (let i = 0; i < W * H; i++) {
  const a = alpha[i]! / 255;
  if (a === 0) continue;
  // Ripple texture: the painting's fine detail (difference from its own blur), limited so tile
  // boundaries and removed boats do not leave outlines; one value for all channels keeps the hue.
  const j = i * 3;
  const detail = ((painted[j]! - smooth[j]!) + (painted[j + 1]! - smooth[j + 1]!) + (painted[j + 2]! - smooth[j + 2]!)) / 3;
  const ripple = Math.max(-5, Math.min(5, detail));
  for (let c = 0; c < 3; c++) out[j + c] = Math.round(painted[j + c]! * (1 - a) + Math.max(0, Math.min(255, base[c]! + ripple)) * a);
}
await sharp(out, { raw: { width: W, height: H, channels: 3 }, limitInputPixels: false }).png().toFile(new URL('finished.png', dir).pathname);
console.log(`finished.png: repainted ${((100 * waterPixels) / (W * H)).toFixed(1)}% of the map as water`);
