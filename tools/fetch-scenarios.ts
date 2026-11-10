/**
 * Offline: download the hourly weather series for each scenario in config/scenarios.json from the
 * Open-Meteo Historical Weather API (reanalysis) and store them under public/data/scenarios/.
 * Run: npm run data:scenarios
 *
 * Only scenarios whose download succeeds are written to index.json, so the app never offers a
 * "real" scenario without real data behind it.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { IST_OFFSET_MS } from '../src/core/time/ist.ts';
import { LocalFrame, type BBox } from '../src/shared/projection.ts';

const ROOT = new URL('..', import.meta.url);
const area = JSON.parse(await readFile(new URL('config/study-area.json', ROOT), 'utf8')) as { bbox: BBox; utmZone: number };
const defs = JSON.parse(await readFile(new URL('config/scenarios.json', ROOT), 'utf8')) as Array<{
  id: string; label: string; startIst: string; endIst: string; references: string[];
}>;
const { lat, lon } = LocalFrame.fromBBox(area.utmZone, area.bbox).originLonLat;
const HOURLY = 'precipitation,cloud_cover,relative_humidity_2m,temperature_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m';
const istToEpoch = (s: string): number => Date.parse(`${s}:00Z`) - IST_OFFSET_MS;
const utcDate = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

await mkdir(new URL('public/data/scenarios/', ROOT), { recursive: true });
const index: unknown[] = [];
for (const def of defs) {
  const start = istToEpoch(def.startIst), end = istToEpoch(def.endIst);
  const url =
    `https://archive-api.open-meteo.com/v1/archive?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
    `&start_date=${utcDate(start - 3600000)}&end_date=${utcDate(end + 3600000)}&hourly=${HOURLY}` +
    `&timezone=GMT&timeformat=unixtime&wind_speed_unit=ms`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'city-3d-preprocess/0.1 (offline one-shot extract)' } });
    const body = (await res.json()) as { error?: boolean; reason?: string; latitude: number; longitude: number; elevation: number; hourly: Record<string, number[]> };
    if (!res.ok || body.error) throw new Error(body.reason ?? `HTTP ${res.status}`);
    // Keep one hour of margin on each side so the series brackets the whole window.
    const keep = body.hourly['time']!.map((t) => t * 1000 >= start - 3600000 && t * 1000 <= end + 3600000);
    const hourly = Object.fromEntries(Object.entries(body.hourly).map(([k, v]) => [k, v.filter((_, i) => keep[i])]));
    if (hourly['precipitation']!.some((v) => v === null)) throw new Error('series contains gaps');
    const source = 'Open-Meteo Historical Weather API (reanalysis grid cell, not a rain gauge), CC BY 4.0';
    await writeFile(
      new URL(`public/data/scenarios/${def.id}.json`, ROOT),
      JSON.stringify({ id: def.id, label: def.label, source, requestUrl: url, fetchedAt: new Date().toISOString(),
        gridCell: { latitude: body.latitude, longitude: body.longitude, elevation: body.elevation }, references: def.references, hourly }),
    );
    index.push({ id: def.id, label: def.label, start, end, synthetic: false, source, seriesUrl: `data/scenarios/${def.id}.json` });
    const total = hourly['precipitation']!.reduce((a, b) => a + b, 0);
    console.log(`${def.id}: ${hourly['time']!.length} hours, ${total.toFixed(1)} mm total, peak ${Math.max(...hourly['precipitation']!).toFixed(1)} mm/h`);
  } catch (err) {
    console.error(`${def.id}: NOT stored (${err instanceof Error ? err.message : String(err)})`);
  }
}
await writeFile(new URL('public/data/scenarios/index.json', ROOT), JSON.stringify(index, null, 2));
console.log(`index.json: ${index.length} of ${defs.length} scenarios stored`);
