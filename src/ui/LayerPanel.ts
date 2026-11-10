import type { LayerEntry, LayerRegistry } from '../core/layers/LayerRegistry';
import type { CityHeader } from '../shared/cityFormat';
import { el } from './dom';

const STATUS_TEXT: Record<LayerEntry['status'], string> = { registered: '', loading: 'loading…', ready: '', error: 'failed' };

/** Layer toggles plus the data-honesty legend for building heights. */
export class LayerPanel {
  private readonly rows = new Map<string, { input: HTMLInputElement; status: HTMLElement }>();
  private readonly legend = el('section');
  /** Filled by ViewSwitch. */
  readonly viewSection = el('section');
  /** Filled by WeatherPanel. */
  readonly weatherSection = el('section');

  constructor(root: HTMLElement, registry: LayerRegistry) {
    root.classList.add('panel');
    if (matchMedia('(max-width: 720px)').matches) root.classList.add('collapsed');
    const toggle = el('button', { type: 'button', class: 'side-toggle' }, 'Layers & legend');
    toggle.addEventListener('click', () => root.classList.toggle('collapsed'));

    const list = el('section', {}, el('h2', {}, 'Layers'));
    for (const entry of registry.list()) {
      const input = el('input', { type: 'checkbox' });
      input.checked = entry.visible;
      input.addEventListener('change', () => registry.setVisible(entry.layer.id, input.checked));
      const status = el('span', { class: 'status' });
      list.append(el('label', { class: 'layer-row' }, input, entry.layer.label, status));
      this.rows.set(entry.layer.id, { input, status });
      this.paint(entry);
    }
    registry.on('change', (entry) => this.paint(entry));
    root.append(toggle, this.viewSection, list, this.weatherSection, this.legend);
  }

  private paint(entry: LayerEntry): void {
    const row = this.rows.get(entry.layer.id);
    if (!row) return;
    row.input.checked = entry.visible;
    row.status.textContent = STATUS_TEXT[entry.status];
    row.status.title = entry.error ?? '';
    row.status.classList.toggle('error', entry.status === 'error');
  }

  showCityInfo(header: CityHeader): void {
    const s = header.stats;
    const pct = (n: number): string => `${n.toLocaleString()} (${((100 * n) / s.buildings).toFixed(1)}%)`;
    const row = (colour: string, text: string, n: string): HTMLElement =>
      el('div', { class: 'legend-row' }, el('span', { class: 'swatch', style: `background:${colour}` }), text, el('span', { class: 'n' }, n));
    this.legend.replaceChildren(
      el('h2', {}, 'Building height source'),
      row('#d6b080', 'From OSM tags or Wikidata', pct(s.heightFromTag + s.heightFromLevels + s.heightFromWikidata)),
      row('#b3ad9f', 'Estimated', pct(s.heightEstimated)),
      el(
        'p',
        { class: 'note' },
        'Greyer buildings have no height or level tag in OSM. Their height is a heuristic from footprint area and building type, not real data.',
      ),
      el(
        'p',
        { class: 'note' },
        'Windows and storey lines are a procedural pattern (one storey per 3.2 m), not imagery of the real facades. Pale stone buildings are named landmarks; the colour is a highlight only.',
      ),
      el('p', { class: 'note' }, `OSM snapshot: ${header.osmBaseTimestamp?.slice(0, 10) ?? 'unknown'}. Ground is flat until terrain arrives in Phase 2.`),
    );
  }
}
