import type { App } from '../app/App';

/** Frame-rate, draw-call and triangle readout (the per-phase performance report reads from the same numbers). */
export class StatsHud {
  constructor(private readonly root: HTMLElement, private readonly app: App) {
    root.classList.add('panel');
    setInterval(() => this.paint(), 500);
  }

  private paint(): void {
    const s = this.app.stats;
    const k = (n: number): string => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(0)}k` : String(n));
    this.root.textContent =
      `${s.fps.toFixed(0)} fps  ${s.frameMs.toFixed(1)} ms  [${this.app.quality.name}]\n` +
      `draws ${s.drawCalls}  tris ${k(s.triangles)}\n` +
      `+shadow pass: ${s.drawCallsWithShadow} / ${k(s.trianglesWithShadow)}`;
  }
}
