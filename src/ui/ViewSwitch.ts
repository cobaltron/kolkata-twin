import type { App, ViewMode } from '../app/App';
import { el } from './dom';

export type DisplayMode = ViewMode | 'painted';

const NOTES: Record<DisplayMode, string> = {
  perspective: '',
  isometric: 'A stylised render of the same OSM model from one fixed camera. Drag to pan, scroll or pinch to zoom.',
  painted: 'A pilot area painted offline by a generative model from satellite imagery; buildings and details may be invented. Vehicles are simulated. Layer toggles, weather and the sun do not apply here.',
};

/** Switch between the free 3D camera, the isometric pixel filter and (when one has been built) the painted map. */
export class ViewSwitch {
  private mode: DisplayMode = 'perspective';
  private readonly listeners = new Set<(mode: DisplayMode) => void>();

  constructor(root: HTMLElement, private readonly app: App, paintedAvailable: boolean) {
    const modes: Array<[DisplayMode, string]> = [['perspective', '3D'], ['isometric', 'Isometric pixel']];
    if (paintedAvailable) modes.push(['painted', 'Painted map']);
    const buttons = new Map<DisplayMode, HTMLButtonElement>();
    const seg = el('div', { class: 'seg', role: 'group', 'aria-label': 'View' });
    for (const [mode, label] of modes) {
      const b = el('button', { type: 'button' }, label);
      b.addEventListener('click', () => this.set(mode));
      buttons.set(mode, b);
      seg.append(b);
    }
    const note = el('p', { class: 'note', hidden: true });
    this.listeners.add((mode) => {
      for (const [m, b] of buttons) b.setAttribute('aria-pressed', String(m === mode));
      note.textContent = NOTES[mode];
      note.hidden = NOTES[mode] === '';
      document.body.classList.toggle('isometric-view', mode === 'isometric');
      document.body.classList.toggle('painted-view', mode === 'painted');
    });
    root.append(el('h2', {}, 'View'), seg, note);
    this.set('perspective', true);

    // WebKit does not re-sample a backdrop-filter when the canvas beneath it redraws, which leaves a
    // stale blurred copy while panning. Changing the blur by an invisible amount forces a re-sample.
    let nudged = false;
    app.isoControls.addEventListener('change', () => {
      nudged = !nudged;
      document.body.style.setProperty('--tilt-nudge', nudged ? '0.0005px' : '0px');
    });
  }

  get current(): DisplayMode {
    return this.mode;
  }

  onChange(listener: (mode: DisplayMode) => void): void {
    this.listeners.add(listener);
  }

  set(mode: DisplayMode, force = false): void {
    if (mode === this.mode && !force) return;
    this.mode = mode;
    // The painted map covers the 3D scene, which then stops drawing.
    this.app.suspended = mode === 'painted';
    if (mode !== 'painted') this.app.setViewMode(mode);
    for (const listener of this.listeners) listener(mode);
  }
}
