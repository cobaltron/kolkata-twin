/**
 * Stage 1 of the generated pixel map: render Google Photorealistic 3D Tiles straight down over an area.
 * Run: node tools/pixelmap/render-ortho.mjs pilot [--only=tx,ty] [--force]
 * Out: data/pixelmap/<name>/ortho_tiles/tile_<tx>_<ty>.png (git-ignored: Google imagery is not redistributed)
 *
 * One run makes one billable 3D Tiles root request; everything after it belongs to that session.
 * The key comes from GOOGLE_MAPS_API_KEY, or from the session's network proxy when that is unset.
 */
import fs from 'node:fs';
import path from 'node:path';
import { openRenderPage, ROOT } from './browser.mjs';

const args = process.argv.slice(2);
const name = args.find((a) => !a.startsWith('--')) ?? 'pilot';
const only = args.find((a) => a.startsWith('--only='))?.split('=')[1];
const force = args.includes('--force');
const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'pixelmap', `${name}.json`), 'utf8'));
const outDir = path.join(ROOT, 'data', 'pixelmap', name, 'ortho_tiles');
fs.mkdirSync(outDir, { recursive: true });

const n = Math.ceil(config.ortho.quadrants / 2);
let todo = [];
for (let ty = 0; ty < n; ty++) for (let tx = 0; tx < n; tx++) todo.push([tx, ty]);
if (only) todo = [only.split(',').map(Number)];
else if (!force) todo = todo.filter(([tx, ty]) => !fs.existsSync(path.join(outDir, `tile_${tx}_${ty}.png`)));
console.log(`[ortho] ${todo.length} tiles for "${name}" -> ${outDir}`);

const { page, close } = await openRenderPage('tools/pixelmap/ortho.html', { apiKey: 'relayed-by-node', config });
const attributions = new Set();
const t0 = Date.now();
let done = 0;
for (const [tx, ty] of todo) {
  const r = await page.evaluate(([x, y]) => window.renderTile(x, y), [tx, ty]);
  fs.writeFileSync(path.join(outDir, `tile_${tx}_${ty}.png`), Buffer.from(r.png.split(',')[1], 'base64'));
  for (const a of r.attributions) attributions.add(a);
  done++;
  console.log(`  tile ${tx},${ty} ${r.ok ? 'ok' : 'TIMED OUT (saved anyway)'}; load failures so far ${r.failures}; ${((Date.now() - t0) / done / 1000).toFixed(1)} s/tile`);
}
// Google requires its data providers to be credited wherever the imagery, or work made from it, is shown.
const metaPath = path.join(ROOT, 'data', 'pixelmap', name, 'ortho_meta.json');
const previous = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, 'utf8')).attributions ?? [] : [];
fs.writeFileSync(metaPath, JSON.stringify({ source: 'Google Photorealistic 3D Tiles (Map Tiles API)', renderedAt: new Date().toISOString(), attributions: [...new Set([...previous, ...attributions])] }, null, 2));
console.log(`Done in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
await close();
