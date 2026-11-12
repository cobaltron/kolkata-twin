/**
 * Offline: points of interest that the main extract does not carry (it only keeps buildings, roads,
 * rail, water and green space): anything with a Wikidata item, named monuments/memorials, named
 * museums and attractions, and bridge outlines. Tags and centre points only.
 * Run: npm run data:poi     Output: data/raw/poi.json (git-ignored)
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { areaFromArgs } from './lib/area.ts';

const files = areaFromArgs();
const { bbox } = files.config;
const ENDPOINT = process.env.OVERPASS_URL ?? 'https://overpass-api.de/api/interpreter';
const query = `[out:json][timeout:120][bbox:${bbox.south},${bbox.west},${bbox.north},${bbox.east}];
(nwr[wikidata];nwr[historic~"^(monument|memorial|castle|fort|building)$"][name];nwr[tourism~"^(attraction|museum)$"][name];way[man_made=bridge];);
out center tags;`;
const res = await fetch(ENDPOINT, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'city-3d-preprocess/0.1 (offline one-shot extract)' },
  body: 'data=' + encodeURIComponent(query),
});
if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
const text = await res.text();
const json = JSON.parse(text) as { elements: unknown[]; remark?: string };
if (json.remark) throw new Error(`Overpass remark: ${json.remark}`);
await mkdir(files.raw, { recursive: true });
await writeFile(new URL('poi.json', files.raw), text);
console.log(`Saved ${json.elements.length} points of interest from ${ENDPOINT}`);
