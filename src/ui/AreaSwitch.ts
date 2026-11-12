import { AREA_ID, AREAS } from '../shared/config';
import { el } from './dom';

/** Choose which area of the city to load. Each area is its own dataset, so switching reloads the page. */
export class AreaSwitch {
  constructor(root: HTMLElement) {
    const select = el('select', { 'aria-label': 'Area' });
    for (const [id, area] of Object.entries(AREAS)) {
      const option = el('option', { value: id }, `${area.region}: ${area.name}`);
      option.selected = id === AREA_ID;
      select.append(option);
    }
    select.addEventListener('change', () => {
      const url = new URL(location.href);
      url.searchParams.set('area', select.value);
      location.assign(url);
    });
    root.append(el('h2', {}, 'Area'), select, el('p', { class: 'note' }, AREAS[AREA_ID]!.description));
  }
}
