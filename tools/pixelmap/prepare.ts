/**
 * Stage 2 inputs for the block render: building footprints with heights, in the area's frame.
 * Run: npx tsx tools/pixelmap/prepare.ts pilot
 * In:  public/data/central/city.bin (OSM footprints; heights from OSM tags, Wikidata, Open Buildings 2.5D, estimate)
 * Out: data/pixelmap/<name>/buildings.json   [{ rings: [[[x, y], ...], ...], h }]
 *      data/pixelmap/<name>/ortho_small.jpg  low-resolution copy of the imagery, for sampling wall colours
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { decodeCity } from '../../src/shared/cityFormat.ts';
import { LocalFrame } from '../../src/shared/projection.ts';
import { areaFrame } from '../../src/shared/pixelmap.ts';

const ROOT = new URL('../..', import.meta.url);
const name = process.argv[2] ?? 'pilot';
const cfg = JSON.parse(readFileSync(new URL(`config/pixelmap/${name}.json`, ROOT), 'utf8'));
const outDir = new URL(`data/pixelmap/${name}/`, ROOT);
mkdirSync(outDir, { recursive: true });

const buf = readFileSync(new URL('public/data/central/city.bin', ROOT));
const city = decodeCity(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
const { origin, utmZone } = city.header;
const utm = new LocalFrame(utmZone, { lon: origin.lon, lat: origin.lat });
const toArea = areaFrame(cfg.lat, cfg.lon);

const half = (cfg.ortho.quadrants * cfg.quadrant_px * cfg.ortho.meters_per_pixel) / 2; // imagery square
const ringCounts = city.section<Uint16Array>('b_ringCounts'), ringSizes = city.section<Uint32Array>('b_ringSizes');
const xy = city.section<Float32Array>('b_xy'), heights = city.section<Float32Array>('b_height');
const buildings: Array<{ rings: number[][][]; h: number }> = [];
let ring = 0, cursor = 0;
for (let b = 0; b < ringCounts.length; b++) {
  const rings: number[][][] = [];
  let inside = false;
  for (let r = 0; r < ringCounts[b]!; r++) {
    const n = ringSizes[ring++]!;
    const pts: number[][] = [];
    for (let i = 0; i < n; i++) {
      const ll = utm.toLonLat(xy[cursor + i * 2]!, xy[cursor + i * 2 + 1]!);
      const [x, y] = toArea(ll.lon, ll.lat);
      pts.push([Math.round(x * 100) / 100, Math.round(y * 100) / 100]);
      if (r === 0 && Math.abs(x) < half && Math.abs(y) < half) inside = true;
    }
    cursor += n * 2;
    rings.push(pts);
  }
  if (inside) buildings.push({ rings, h: Math.round(heights[b]! * 10) / 10 });
}
writeFileSync(new URL('buildings.json', outDir), JSON.stringify(buildings));
console.log(`${buildings.length} buildings inside the ${(half * 2).toFixed(0)} m imagery square`);

// Low-resolution mosaic of the imagery tiles (one 64 px cell per 1024 px tile).
const n = Math.ceil(cfg.ortho.quadrants / 2), cell = 64;
const composites = [];
for (let ty = 0; ty < n; ty++) {
  for (let tx = 0; tx < n; tx++) {
    const input = await sharp(new URL(`ortho_tiles/tile_${tx}_${ty}.png`, outDir).pathname).resize(cell, cell).toBuffer();
    composites.push({ input, left: tx * cell, top: ty * cell });
  }
}
await sharp({ create: { width: n * cell, height: n * cell, channels: 3, background: '#000' } }).composite(composites).jpeg({ quality: 90 }).toFile(new URL('ortho_small.jpg', outDir).pathname);
console.log(`ortho_small.jpg ${n * cell} px`);
