/**
 * Offline: text and photo credits for landmark pop-ups.
 * Run: npm run data:content   (after data:wikidata)
 * Out: public/data/landmark-content.json
 *
 * Text: the first paragraph of the English Wikipedia article (CC BY-SA 4.0), shortened, with a link.
 * Photo: the Wikidata main image (P18), hot-linked from Wikimedia Commons, and only when its file page
 * carries a recognised licence template; author and licence are stored for display.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { creditFromCommons, introFromWikitext } from './lib/wikitext.ts';

const ROOT = new URL('..', import.meta.url);
const UA = { 'User-Agent': 'city-3d-preprocess/0.1 (offline one-shot extract)' };
const { entities } = JSON.parse(await readFile(new URL('data/wikidata.json', ROOT), 'utf8')) as {
  entities: Record<string, { label: string | null; description: string | null; enwiki: string | null; image: string | null; inceptionYear: number | null }>;
};

async function rawPage(host: string, title: string): Promise<string | null> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`https://${host}/w/index.php?title=${encodeURIComponent(title.replace(/ /g, '_'))}&action=raw`, { headers: UA });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      if (attempt === 3) console.warn(`  ${host} ${title}: ${err instanceof Error ? err.message : String(err)}`);
      await new Promise((r) => setTimeout(r, 2500 * attempt));
    } finally {
      await new Promise((r) => setTimeout(r, 600)); // polite pacing
    }
  }
  return null;
}

interface Content {
  description: string | null;
  inceptionYear: number | null;
  text: { extract: string; title: string; url: string; licence: string } | null;
  image: { url: string; pageUrl: string; author: string; licence: string } | null;
}
const out: Record<string, Content> = {};
let texts = 0, images = 0, n = 0;
for (const [qid, e] of Object.entries(entities)) {
  const content: Content = { description: e.description, inceptionYear: e.inceptionYear, text: null, image: null };
  if (e.enwiki) {
    const wikitext = await rawPage('en.wikipedia.org', e.enwiki);
    const extract = wikitext && !/^#REDIRECT/i.test(wikitext) ? introFromWikitext(wikitext) : null;
    if (extract) {
      content.text = { extract, title: e.enwiki, url: `https://en.wikipedia.org/wiki/${encodeURIComponent(e.enwiki.replace(/ /g, '_'))}`, licence: 'CC BY-SA 4.0' };
      texts++;
    }
  }
  if (e.image) {
    const credit = creditFromCommons((await rawPage('commons.wikimedia.org', `File:${e.image}`)) ?? '');
    if (credit) {
      const file = encodeURIComponent(e.image.replace(/ /g, '_'));
      content.image = { url: `https://commons.wikimedia.org/wiki/Special:FilePath/${file}?width=640`, pageUrl: `https://commons.wikimedia.org/wiki/File:${file}`, ...credit };
      images++;
    }
  }
  if (content.text || content.image || content.description) out[qid] = content;
  if (++n % 25 === 0) console.log(`  ${n}/${Object.keys(entities).length}`);
}
await mkdir(new URL('public/data/', ROOT), { recursive: true });
await writeFile(new URL('public/data/landmark-content.json', ROOT), JSON.stringify({ fetchedAt: new Date().toISOString(), items: out }));
console.log(`${Object.keys(out).length} items; ${texts} with article text, ${images} with a licensed photo`);
