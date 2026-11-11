/**
 * Stage 2 of the generated pixel map: render the block model with the map camera, and stitch it.
 * Run: node tools/pixelmap/render-block.mjs pilot [--only=tx,ty]
 * In:  data/pixelmap/<name>/{ortho_tiles, ortho_small.jpg, buildings.json}
 * Out: data/pixelmap/<name>/renders/tile_<tx>_<ty>.png and data/pixelmap/<name>/render.png
 * No Google requests are made at this stage.
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { openRenderPage, ROOT } from './browser.mjs';

const args = process.argv.slice(2);
const name = args.find((a) => !a.startsWith('--')) ?? 'pilot';
const only = args.find((a) => a.startsWith('--only='))?.split('=')[1];
const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'pixelmap', `${name}.json`), 'utf8'));
const dir = path.join(ROOT, 'data', 'pixelmap', name);
const outDir = path.join(dir, 'renders');
fs.mkdirSync(outDir, { recursive: true });

const tilesX = Math.ceil(config.cols / 2), tilesY = Math.ceil(config.rows / 2);
let todo = [];
for (let ty = 0; ty < tilesY; ty++) for (let tx = 0; tx < tilesX; tx++) todo.push([tx, ty]);
if (only) todo = [only.split(',').map(Number)];

const { page, close } = await openRenderPage('tools/pixelmap/block.html', { config }, (p) =>
  p.route('**/data/**', (route) => {
    const file = path.join(dir, new URL(route.request().url()).pathname.replace(/^\/data\//, ''));
    return fs.existsSync(file) ? route.fulfill({ path: file }) : route.fulfill({ status: 404 });
  }));
console.log('scene:', await page.evaluate(() => window.SCENE_STATS));
const t0 = Date.now();
for (const [tx, ty] of todo) {
  const r = await page.evaluate(([x, y]) => window.renderTile(x, y), [tx, ty]);
  fs.writeFileSync(path.join(outDir, `tile_${tx}_${ty}.png`), Buffer.from(r.png.split(',')[1], 'base64'));
}
console.log(`${todo.length} tiles in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
await close();

if (!only) {
  const q = config.quadrant_px, w = config.cols * q, h = config.rows * q;
  const composites = [];
  for (let ty = 0; ty < tilesY; ty++) for (let tx = 0; tx < tilesX; tx++) {
    const left = tx * 2 * q, top = ty * 2 * q;
    const input = await sharp(path.join(outDir, `tile_${tx}_${ty}.png`)).extract({ left: 0, top: 0, width: Math.min(2 * q, w - left), height: Math.min(2 * q, h - top) }).toBuffer();
    composites.push({ input, left, top });
  }
  await sharp({ create: { width: w, height: h, channels: 3, background: '#000' } }).composite(composites).png().toFile(path.join(dir, 'render.png'));
  console.log(`render.png ${w} x ${h}`);
}
