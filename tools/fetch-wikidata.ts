/**
 * Offline: for every OSM way/relation in the extract that carries a `wikidata` tag, download the
 * Wikidata entity and keep its English label, height (P2048, metres) and floors above ground (P1101).
 * Run: npm run data:wikidata   (after data:fetch, before data:build)
 * Output: data/wikidata.json (checked in; Wikidata is CC0).
 */
import { readFile, writeFile } from 'node:fs/promises';

const ROOT = new URL('..', import.meta.url);
const raw = JSON.parse(await readFile(new URL('data/raw/osm.json', ROOT), 'utf8')) as {
  elements: Array<{ type: string; tags?: Record<string, string> }>;
};
const METRE = 'http://www.wikidata.org/entity/Q11573';
const FOOT = 'http://www.wikidata.org/entity/Q3710';

// Points of interest fetched separately (monuments, ghats, museums mapped as nodes); optional.
try {
  const poi = JSON.parse(await readFile(new URL('data/raw/poi.json', ROOT), 'utf8')) as typeof raw;
  raw.elements.push(...poi.elements.filter((el) => !el.tags?.['highway'] && !el.tags?.['railway'] && !el.tags?.['public_transport']).map((el) => ({ ...el, type: 'poi' })));
} catch { /* run npm run data:poi to include them */ }

const qids = new Set<string>();
for (const el of raw.elements) {
  const q = el.tags?.['wikidata'];
  if (el.type !== 'node' && q && /^Q\d+$/.test(q)) qids.add(q);
}

interface Claim { mainsnak: { datavalue?: { value: { amount?: string; unit?: string; time?: string } | string } }; rank: string }
interface Entity {
  labels?: Record<string, { value: string }>;
  descriptions?: Record<string, { value: string }>;
  sitelinks?: Record<string, { title: string }>;
  claims?: Record<string, Claim[]>;
  modified?: string;
}
export interface WikidataRecord {
  label: string | null;
  description: string | null;
  /** English Wikipedia article title, if any. */
  enwiki: string | null;
  /** Wikimedia Commons file name of the item's main image (P18), if any. */
  image: string | null;
  /** Year of inception (P571), if stated. */
  inceptionYear: number | null;
  heightM: number | null;
  floors: number | null;
  modified: string | null;
}

const best = (claims: Claim[] | undefined): Claim | undefined =>
  claims?.find((c) => c.rank === 'preferred') ?? claims?.find((c) => c.rank !== 'deprecated');

const out: Record<string, WikidataRecord> = {};
let n = 0;
for (const qid of [...qids].sort()) {
  let entity: Entity | undefined;
  for (let attempt = 1; attempt <= 4 && !entity; attempt++) {
    try {
      const res = await fetch(`https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`, {
        headers: { 'User-Agent': 'city-3d-preprocess/0.1 (offline one-shot extract)' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { entities: Record<string, Entity> };
      entity = Object.values(body.entities)[0]; // redirects come back under the target id
    } catch (err) {
      if (attempt === 4) console.warn(`${qid}: skipped (${err instanceof Error ? err.message : String(err)})`);
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
  if (entity) {
    const value = (property: string): { amount?: string; unit?: string; time?: string } | string | undefined => best(entity!.claims?.[property])?.mainsnak.datavalue?.value;
    const quantity = (property: string): { amount?: string; unit?: string } | undefined => {
      const v = value(property);
      return typeof v === 'object' ? v : undefined;
    };
    const h = quantity('P2048');
    const amount = h?.amount ? Number(h.amount) : Number.NaN;
    const heightM = h?.unit === METRE ? amount : h?.unit === FOOT ? amount * 0.3048 : Number.NaN;
    const floors = Number(quantity('P1101')?.amount);
    const image = value('P18');
    const inception = value('P571');
    const year = typeof inception === 'object' && inception.time ? Number(/^[+-]\d{4}/.exec(inception.time)?.[0]) : Number.NaN;
    out[qid] = {
      label: entity.labels?.['en']?.value ?? null,
      description: entity.descriptions?.['en']?.value ?? null,
      enwiki: entity.sitelinks?.['enwiki']?.title ?? null,
      image: typeof image === 'string' ? image : null,
      inceptionYear: Number.isFinite(year) ? year : null,
      heightM: Number.isFinite(heightM) && heightM > 0 ? heightM : null,
      floors: Number.isFinite(floors) && floors > 0 ? floors : null,
      modified: entity.modified ?? null,
    };
  }
  if (++n % 20 === 0) console.log(`  ${n}/${qids.size}`);
  await new Promise((r) => setTimeout(r, 700)); // stay well inside Wikimedia's rate limits
}
await writeFile(new URL('data/wikidata.json', ROOT), JSON.stringify({ fetchedAt: new Date().toISOString(), licence: 'CC0 (Wikidata)', entities: out }, null, 1));
const withHeight = Object.values(out).filter((r) => r.heightM !== null).length;
const withFloors = Object.values(out).filter((r) => r.floors !== null).length;
console.log(`${Object.keys(out).length} of ${qids.size} entities stored; ${withHeight} with a height, ${withFloors} with a floor count`);
