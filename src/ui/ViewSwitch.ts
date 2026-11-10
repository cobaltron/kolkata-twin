import type { App, ViewMode } from '../app/App';
import { el } from './dom';

const MODES: Array<[ViewMode, string]> = [
  ['perspective', '3D'],
  ['isometric', 'Isometric pixel'],
];

/** Switch between the free 3D camera and the fixed-angle isometric pixel view. */
export class ViewSwitch {
  constructor(root: HTMLElement, app: App) {
    const buttons = new Map<ViewMode, HTMLButtonElement>();
    const seg = el('div', { class: 'seg', role: 'group', 'aria-label': 'View' });
    for (const [mode, label] of MODES) {
      const b = el('button', { type: 'button' }, label);
      b.addEventListener('click', () => app.setViewMode(mode));
      buttons.set(mode, b);
      seg.append(b);
    }
    const note = el('p', { class: 'note', hidden: true }, 'A stylised render of the same OSM model from one fixed camera. Drag to pan, scroll or pinch to zoom.');
    const paint = (mode: ViewMode): void => {
      for (const [m, b] of buttons) b.setAttribute('aria-pressed', String(m === mode));
      note.hidden = mode !== 'isometric';
      document.body.classList.toggle('isometric-view', mode === 'isometric');
    };
    app.onViewModeChange(paint);
    paint(app.viewMode);
    root.append(el('h2', {}, 'View'), seg, note);

    // WebKit does not re-sample a backdrop-filter when the canvas beneath it redraws, which leaves a
    // stale blurred copy while panning. Changing the blur by an invisible amount forces a re-sample.
    let nudged = false;
    app.isoControls.addEventListener('change', () => {
      nudged = !nudged;
      document.body.style.setProperty('--tilt-nudge', nudged ? '0.0005px' : '0px');
    });
  }
}
