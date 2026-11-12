/**
 * Offline step 1: download the raw OSM extract for the configured study area.
 * Run: npx tsx tools/fetch-osm.ts <area>
 * Output: data/raw/osm.json (git-ignored; reproducible) + data/raw/osm.meta.json
 * Never called at runtime.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { areaFromArgs } from './lib/area.ts';

const files = areaFromArgs();
const area = { id: files.id, bbox: files.config.bbox };
const { west, south, east, north } = area.bbox;
const ENDPOINT = process.env.OVERPASS_URL ?? 'https://overpass-api.de/api/interpreter';

const GREEN_LEISURE = 'park|garden|pitch|golf_course|recreation_ground|playground|stadium|sports_centre';
const GREEN_LANDUSE = 'grass|recreation_ground|forest|meadow|cemetery|village_green';
const queryFor = (s: number, w: number, n: number, e: number): string => `
[out:json][timeout:120][bbox:${s},${w},${n},${e}];
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

interface OverpassResponse {
  osm3s?: { timestamp_osm_base?: string };
  remark?: string;
  elements: Array<{ type: string; id: number; tags?: Record<string, string> }>;
}

async function fetchTile(query: string, label: string): Promise<OverpassResponse> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'city-3d-preprocess/0.1 (offline one-shot extract)',
        },
        body: 'data=' + encodeURIComponent(query),
      });
      if (!res.ok) throw new Error(`Overpass HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const json = (await res.json()) as OverpassResponse;
      if (json.remark) throw new Error(`Overpass remark (likely timeout/partial): ${json.remark}`);
      return json;
    } catch (err) {
      if (attempt >= 4) throw err;
      const wait = 5000 * 2 ** (attempt - 1);
      console.warn(`  ${label}: ${err instanceof Error ? err.message : String(err)}; retrying in ${wait / 1000}s`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

// The area is fetched as a grid of sub-boxes (large single responses are fragile through proxies)
// and merged by element type + id. Ways and relations that cross a tile edge arrive complete from
// each tile because of the ">" recursion, so de-duplication is lossless.
// Small areas fit in one request; wide ones are split into a grid.
const spanKm = Math.max((east - west) * 103, (north - south) * 111);
const GRID = Number(process.env.OVERPASS_GRID ?? (spanKm > 4 ? 3 : 1));
console.log(`Fetching OSM for ${area.id} from ${ENDPOINT} as a ${GRID}x${GRID} grid ...`);
const merged = new Map<string, OverpassResponse['elements'][number]>();
let osmBase: string | null = null;
for (let iy = 0; iy < GRID; iy++) {
  for (let ix = 0; ix < GRID; ix++) {
    const w = west + ((east - west) * ix) / GRID, e = west + ((east - west) * (ix + 1)) / GRID;
    const s = south + ((north - south) * iy) / GRID, n = south + ((north - south) * (iy + 1)) / GRID;
    const tile = await fetchTile(queryFor(s, w, n, e), `tile ${ix},${iy}`);
    for (const el of tile.elements) {
      const key = `${el.type}/${el.id}`;
      // Prefer the copy that carries tags (the "out skel" copy of the same element has none).
      if (!merged.has(key) || el.tags) merged.set(key, el);
    }
    // Keep the oldest base timestamp: the merged extract is only guaranteed current up to that point.
    const ts = tile.osm3s?.timestamp_osm_base ?? null;
    if (ts && (!osmBase || ts < osmBase)) osmBase = ts;
    console.log(`  tile ${ix},${iy}: ${tile.elements.length} elements (total ${merged.size})`);
  }
}
const json = { osm3s: { timestamp_osm_base: osmBase }, elements: [...merged.values()] };
const text = JSON.stringify(json);

await mkdir(files.raw, { recursive: true });
await writeFile(new URL('osm.json', files.raw), text);
await writeFile(
  new URL('osm.meta.json', files.raw),
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
