/**
 * Offline step 1: download the raw OSM extract for the configured study area.
 * Run: npm run data:fetch
 * Output: data/raw/osm.json (git-ignored; reproducible) + data/raw/osm.meta.json
 * Never called at runtime.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const ROOT = new URL('..', import.meta.url);
const area = JSON.parse(await readFile(new URL('config/study-area.json', ROOT), 'utf8'));
const { west, south, east, north } = area.bbox;
const ENDPOINT = process.env.OVERPASS_URL ?? 'https://overpass-api.de/api/interpreter';

const GREEN_LEISURE = 'park|garden|pitch|golf_course|recreation_ground|playground|stadium|sports_centre';
const GREEN_LANDUSE = 'grass|recreation_ground|forest|meadow|cemetery|village_green';
const query = `
[out:json][timeout:240][bbox:${south},${west},${north},${east}];
(
  way[building];
  relation[building][type=multipolygon];
  way[highway];
  way[railway~"^(rail|tram|subway|light_rail|narrow_gauge)$"];
  way[natural=water];
  relation[natural=water];
  way[waterway=riverbank];
  relation[waterway=riverbank];
  way[waterway~"^(river|canal|stream|drain|ditch)$"];
  way[leisure~"^(${GREEN_LEISURE})$"];
  relation[leisure~"^(${GREEN_LEISURE})$"];
  way[landuse~"^(${GREEN_LANDUSE})$"];
  relation[landuse~"^(${GREEN_LANDUSE})$"];
  way[natural~"^(wood|grassland|scrub)$"];
);
out body;
>;
out skel qt;
`;

console.log(`Fetching OSM for ${area.id} from ${ENDPOINT} ...`);
const res = await fetch(ENDPOINT, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
    'User-Agent': 'city-3d-preprocess/0.1 (offline one-shot extract)',
  },
  body: 'data=' + encodeURIComponent(query),
});
if (!res.ok) throw new Error(`Overpass HTTP ${res.status}: ${(await res.text()).slice(0, 400)}`);
const text = await res.text();
const json = JSON.parse(text);
if (json.remark) throw new Error(`Overpass remark (likely timeout/partial): ${json.remark}`);

await mkdir(new URL('data/raw/', ROOT), { recursive: true });
await writeFile(new URL('data/raw/osm.json', ROOT), text);
await writeFile(
  new URL('data/raw/osm.meta.json', ROOT),
  JSON.stringify(
    {
      source: ENDPOINT,
      fetchedAt: new Date().toISOString(),
      osmBaseTimestamp: json.osm3s?.timestamp_osm_base ?? null,
      bbox: area.bbox,
      elements: json.elements.length,
      licence: 'ODbL 1.0, © OpenStreetMap contributors',
    },
    null,
    2,
  ),
);
console.log(`Saved ${json.elements.length} elements (${(text.length / 1e6).toFixed(1)} MB), OSM base ${json.osm3s?.timestamp_osm_base}`);
