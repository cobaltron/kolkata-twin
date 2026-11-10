import type { Landmark } from '../shared/cityFormat';
import { el } from './dom';

interface Content {
  description: string | null;
  inceptionYear: number | null;
  text: { extract: string; title: string; url: string; licence: string } | null;
  image: { url: string; pageUrl: string; author: string; licence: string } | null;
}

const link = (href: string, text: string): HTMLAnchorElement => el('a', { href, target: '_blank', rel: 'noopener' }, text);

/**
 * Info card for a landmark. Text is the opening of its English Wikipedia article, the photo is its
 * Wikidata main image from Wikimedia Commons; both are shown with their licence and a link back.
 */
export class LandmarkPopup {
  private items: Promise<Record<string, Content>> | null = null;
  private current = '';

  constructor(private readonly root: HTMLElement) {}

  private load(): Promise<Record<string, Content>> {
    this.items ??= fetch(new URL('data/landmark-content.json', document.baseURI))
      .then((res) => (res.ok ? (res.json() as Promise<{ items: Record<string, Content> }>) : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((file) => file.items)
      .catch((err: unknown) => {
        console.warn('Landmark content unavailable', err);
        return {};
      });
    return this.items;
  }

  async open(landmark: Landmark): Promise<void> {
    this.current = landmark.qid;
    const content = (await this.load())[landmark.qid];
    if (this.current !== landmark.qid) return; // another landmark was chosen while loading
    const close = el('button', { type: 'button', class: 'close', 'aria-label': 'Close' }, '×');
    close.addEventListener('click', () => this.close());
    const parts: Array<Node | string> = [close, el('h3', {}, landmark.name)];
    const facts = [content?.description, content?.inceptionYear ? `since ${content.inceptionYear}` : null].filter(Boolean).join(' · ');
    if (facts) parts.push(el('p', { class: 'sub' }, facts));
    if (content?.image) {
      const img = el('img', { src: content.image.url, alt: `Photo of ${landmark.name}`, loading: 'lazy', referrerpolicy: 'no-referrer' });
      img.addEventListener('error', () => img.remove());
      parts.push(img, el('p', { class: 'credit' }, 'Photo: ', content.image.author, ', ', content.image.licence, ', via ', link(content.image.pageUrl, 'Wikimedia Commons')));
    }
    if (content?.text) {
      parts.push(el('p', {}, content.text.extract), el('p', { class: 'credit' }, 'Text from ', link(content.text.url, 'Wikipedia'), `, ${content.text.licence}, shortened`));
    }
    parts.push(el('p', { class: 'credit' }, 'Facts from ', link(`https://www.wikidata.org/wiki/${landmark.qid}`, 'Wikidata'), ' (CC0); location from OpenStreetMap'));
    this.root.replaceChildren(...parts);
    this.root.hidden = false;
  }

  close(): void {
    this.current = '';
    this.root.hidden = true;
  }
}
