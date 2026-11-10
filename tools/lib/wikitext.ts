/** Minimal wikitext handling for landmark pop-ups: article intro to plain text, Commons licence and author. */

function stripTemplates(text: string): string {
  let out = text;
  // {{convert|338|by|228|ft|m}} -> "338 by 228 ft": keep the stated quantity, drop the conversion.
  out = out.replace(/\{\{\s*(?:convert|cvt)\s*\|([^{}]*)\}\}/gi, (_m, body: string) => {
    const parts = body.split('|').map((p) => p.trim());
    const kept: string[] = [];
    for (const p of parts) {
      if (/^[\d.,]+$/.test(p) || /^(by|to|x|and|-)$/i.test(p)) kept.push(p);
      else {
        if (!p.includes('=')) kept.push(p);
        break;
      }
    }
    return kept.join(' ');
  });
  out = out.replace(/\{\{\s*(?:nbsp|spaces)\s*\}\}/gi, ' ');
  for (let i = 0; i < 12 && /\{\{[^{}]*\}\}/.test(out); i++) out = out.replace(/\{\{[^{}]*\}\}/g, '');
  return out;
}

/** First real paragraph of an article as plain text, at most `maxChars`, cut at a sentence end. Null if it cannot be cleaned safely. */
export function introFromWikitext(wikitext: string, maxChars = 420): string | null {
  let t = wikitext.split(/\n==[^=]/)[0] ?? '';
  t = t.replace(/<!--[\s\S]*?-->/g, '').replace(/<ref[^>]*\/>/gi, '').replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '');
  t = stripTemplates(t);
  for (let i = 0; i < 6; i++) t = t.replace(/\[\[(?:File|Image):[^[\]]*(?:\[\[[^[\]]*\]\][^[\]]*)*\]\]/gi, '');
  t = t.replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, '$1').replace(/\[https?:\/\/\S+\s+([^\]]*)\]/g, '$1');
  t = t.replace(/'{2,}/g, '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&ndash;/g, '–').replace(/&amp;/g, '&');
  const paragraph = t.split('\n').map((l) => l.trim()).find((l) => l.length > 80 && !/^[|!{}*#:;]/.test(l));
  if (!paragraph) return null;
  let p = paragraph.replace(/\(\s*[;,]?\s*\)/g, '').replace(/\s+([,.;])/g, '$1').replace(/\(\s*[;,]\s*/g, '(').replace(/\s{2,}/g, ' ').trim();
  if (/[{}[\]|<>]/.test(p)) return null; // leftover markup: do not show half-cleaned text
  if (p.length > maxChars) {
    const cut = p.slice(0, maxChars);
    const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('.) '));
    if (end < 120) return null;
    p = cut.slice(0, end + 1);
  }
  return p;
}

const LICENCE = /\{\{\s*(?:self\s*\|(?:[^{}|]*\|)*?\s*)?(cc-by-sa-[\d.]+(?:-[a-z]{2,3})?(?:,[\d.,]+)?|cc-by-[\d.]+(?:-[a-z]{2,3})?|cc-by-sa-all|cc-zero|cc0|PD-[\w-]+|GFDL)/i;

export interface CommonsCredit {
  licence: string;
  author: string;
}

/** Licence and author from a Commons file description page. Null when no recognised licence template is present. */
export function creditFromCommons(wikitext: string): CommonsCredit | null {
  const m = LICENCE.exec(wikitext);
  if (!m) return null;
  let licence = m[1]!.replace(/^cc-zero$/i, 'CC0').replace(/^cc0$/i, 'CC0').replace(/^cc-/i, 'CC ').replace(/^pd-.*/i, 'Public domain');
  if (licence.startsWith('CC ')) licence = 'CC ' + licence.slice(3).toUpperCase().replace(/-/g, ' ').replace(/^BY SA/, 'BY-SA').replace(/,.*/, '');
  const raw = /\|\s*author\s*=\s*([^\n]*)/i.exec(wikitext)?.[1] ?? '';
  let author = stripTemplates(raw).replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, '$1').replace(/\[https?:\/\/\S+\s+([^\]]*)\]/g, '$1').replace(/\[https?:\/\/\S+\]/g, '');
  author = author.replace(/<[^>]+>/g, '').replace(/'{2,}/g, '').replace(/^User:/i, '').trim();
  if (!author || /[{}[\]|]/.test(author) || author.length > 80) author = 'see file page';
  return { licence, author };
}
