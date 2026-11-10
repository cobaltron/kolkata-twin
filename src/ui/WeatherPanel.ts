import type { Environment } from '../core/environment/Environment';
import { el } from './dom';

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

/** Readout of the weather state the renderer is using, with its provenance. */
export class WeatherPanel {
  private readonly badge = el('span', { class: 'badge', hidden: true }, 'SYNTHETIC');
  private readonly values = el('div', { class: 'kv' });
  private readonly source = el('p', { class: 'note' });

  constructor(root: HTMLElement, private readonly environment: Environment) {
    root.append(el('h2', {}, 'Weather ', this.badge), this.values, this.source);
    setInterval(() => this.paint(), 500);
    this.paint();
  }

  private paint(): void {
    const w = this.environment.weather;
    this.badge.hidden = !w.synthetic;
    this.source.textContent = w.source;
    if (w.status !== 'ok') {
      this.values.replaceChildren();
      return;
    }
    const rows: Array<[string, string]> = [
      ['Rain', `${w.precipitationMmH.toFixed(1)} mm/h`],
      ['Cloud cover', `${Math.round(w.cloudCover * 100)} %`],
      ['Humidity', `${Math.round(w.humidity * 100)} %`],
      ['Temperature', `${w.temperatureC.toFixed(1)} °C`],
      ['Wind', `${(w.windSpeedMs * 3.6).toFixed(0)} km/h from ${COMPASS[Math.round(w.windFromDeg / 45) % 8]}`],
    ];
    this.values.replaceChildren(...rows.flatMap(([k, v]) => [el('span', {}, k), el('span', {}, v)]));
  }
}
