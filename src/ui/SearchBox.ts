import type { Landmark } from '../shared/cityFormat';
import { el } from './dom';

export interface SearchEntry {
  name: string;
  kind: 'landmark' | 'street';
  x: number;
  y: number;
  landmark?: Landmark;
}

const MAX_RESULTS = 8;

/** Type-ahead search over landmark and street names. Names only: there is no address geocoder. */
export class SearchBox {
  private entries: SearchEntry[] = [];
  private readonly input = el('input', { type: 'search', placeholder: 'Search landmarks and streets', 'aria-label': 'Search landmarks and streets', autocomplete: 'off' });
  private readonly list = el('ul', { class: 'results', role: 'listbox' });
  private shown: SearchEntry[] = [];
  private selected = 0;

  constructor(root: HTMLElement, private readonly onPick: (entry: SearchEntry) => void) {
    root.append(this.input, this.list);
    this.input.addEventListener('input', () => this.search());
    this.input.addEventListener('keydown', (ev) => {
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        ev.preventDefault();
        this.selected = (this.selected + (ev.key === 'ArrowDown' ? 1 : -1) + this.shown.length) % Math.max(1, this.shown.length);
        this.paint();
      } else if (ev.key === 'Enter' && this.shown[this.selected]) this.pick(this.shown[this.selected]!);
      else if (ev.key === 'Escape') this.clear();
    });
  }

  setEntries(entries: SearchEntry[]): void {
    this.entries = entries;
  }

  private search(): void {
    const q = this.input.value.trim().toLowerCase();
    this.selected = 0;
    if (q.length < 2) {
      this.shown = [];
    } else {
      // Rank: name starts with the query, then a word starts with it, then any match; landmarks before streets.
      const score = (e: SearchEntry): number => {
        const n = e.name.toLowerCase();
        const at = n.indexOf(q);
        if (at < 0) return -1;
        return (at === 0 ? 0 : n[at - 1] === ' ' ? 1 : 2) * 2 + (e.kind === 'landmark' ? 0 : 1);
      };
      this.shown = this.entries
        .map((e) => [score(e), e] as const)
        .filter(([s]) => s >= 0)
        .sort((a, b) => a[0] - b[0] || a[1].name.length - b[1].name.length)
        .slice(0, MAX_RESULTS)
        .map(([, e]) => e);
    }
    this.paint();
  }

  private paint(): void {
    this.list.replaceChildren(
      ...this.shown.map((entry, i) => {
        const li = el('li', { role: 'option', 'aria-selected': String(i === this.selected) }, entry.name, el('span', { class: 'kind' }, entry.kind));
        li.addEventListener('click', () => this.pick(entry));
        return li;
      }),
    );
  }

  private pick(entry: SearchEntry): void {
    this.input.value = entry.name;
    this.shown = [];
    this.paint();
    this.onPick(entry);
  }

  private clear(): void {
    this.input.value = '';
    this.shown = [];
    this.paint();
  }
}
