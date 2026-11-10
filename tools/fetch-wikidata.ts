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

const qids = new Set<string>();
for (const el of raw.elements) {
  const q = el.tags?.['wikidata'];
  if (el.type !== 'node' && q && /^Q\d+$/.test(q)) qids.add(q);
}

interface Claim { mainsnak: { datavalue?: { value: { amount?: string; unit?: string } } }; rank: string }
interface Entity { labels?: Record<string, { value: string }>; claims?: Record<string, Claim[]>; modified?: string }
export interface WikidataRecord { label: string | null; heightM: number | null; floors: number | null; modified: string | null }

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
    const h = best(entity.claims?.['P2048'])?.mainsnak.datavalue?.value;
    const amount = h?.amount ? Number(h.amount) : Number.NaN;
    const heightM = h?.unit === METRE ? amount : h?.unit === FOOT ? amount * 0.3048 : Number.NaN;
    const floors = Number(best(entity.claims?.['P1101'])?.mainsnak.datavalue?.value.amount);
    out[qid] = {
      label: entity.labels?.['en']?.value ?? null,
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
