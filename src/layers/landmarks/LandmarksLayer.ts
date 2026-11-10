import { Vector3 } from 'three';
import type { Layer, LayerContext } from '../../core/layers/Layer';
import type { Landmark } from '../../shared/cityFormat';

interface Label {
  landmark: Landmark;
  node: HTMLElement;
  anchor: Vector3;
  shown: boolean;
}

/** Labels beyond this distance from the camera are hidden unless they are among the largest features. */
const NEAR_METRES = 6000;
const ALWAYS_SHOWN = 25;
const KIND_PRIORITY: Record<Landmark['kind'], number> = { building: 0, bridge: 0, green: 1, water: 1, other: 2 };

/**
 * Name labels for places that have a Wikidata item in OSM (museums, churches, stadiums, bridges, parks).
 * Names and positions come from OSM and Wikidata; nothing is hand-placed. Labels are HTML elements
 * projected each frame, de-cluttered greedily: buildings and bridges first, then grounds, by footprint size.
 */
export class LandmarksLayer implements Layer {
  readonly id = 'landmarks';
  readonly label = 'Landmark labels';
  private ctx: LayerContext | null = null;
  private readonly root = document.createElement('div');
  private labels: Label[] = [];
  private readonly projected = new Vector3();
  private frame = 0;

  async load(ctx: LayerContext): Promise<void> {
    this.ctx = ctx;
    this.root.className = 'landmark-labels';
    const { landmarks } = (await ctx.cityData.load()).header;
    const ranked = [...landmarks].sort((a, b) => KIND_PRIORITY[a.kind] - KIND_PRIORITY[b.kind] || b.area - a.area);
    this.labels = ranked.map((landmark) => {
      const node = document.createElement('div');
      node.className = `landmark-label kind-${landmark.kind}`;
      node.textContent = landmark.name;
      node.title = `Wikidata ${landmark.qid}`;
      node.hidden = true;
      this.root.append(node);
      // Anchor a little above the roof; flat features (parks, water) sit just above the ground.
      return { landmark, node, anchor: new Vector3(landmark.x, landmark.height + 12, -landmark.y), shown: false };
    });
    ctx.renderer.domElement.parentElement?.append(this.root);
  }

  update(): void {
    const ctx = this.ctx;
    // Re-layout every other frame: labels lag by at most one frame and the DOM work halves.
    if (!ctx || this.frame++ % 2 !== 0) return;
    const { camera } = ctx;
    const width = ctx.renderer.domElement.clientWidth, height = ctx.renderer.domElement.clientHeight;
    const taken: Array<[number, number, number, number]> = [];
    this.labels.forEach((label, index) => {
      this.projected.copy(label.anchor).project(camera);
      const distance = camera.position.distanceTo(label.anchor);
      let visible = this.projected.z < 1 && Math.abs(this.projected.x) < 1 && Math.abs(this.projected.y) < 1 && (index < ALWAYS_SHOWN || distance < NEAR_METRES);
      const x = (this.projected.x * 0.5 + 0.5) * width, y = (-this.projected.y * 0.5 + 0.5) * height;
      if (visible) {
        // Approximate box from text length; labels are centred above the anchor.
        const w = label.landmark.name.length * 6.6 + 14, h = 20;
        const box: [number, number, number, number] = [x - w / 2, y - h - 6, x + w / 2, y - 6];
        visible = !taken.some((t) => box[0] < t[2] && box[2] > t[0] && box[1] < t[3] && box[3] > t[1]);
        if (visible) taken.push(box);
      }
      if (visible) label.node.style.transform = `translate(-50%, -100%) translate(${x.toFixed(1)}px, ${(y - 6).toFixed(1)}px)`;
      if (visible !== label.shown) {
        label.shown = visible;
        label.node.hidden = !visible;
      }
    });
  }

  setVisible(visible: boolean): void {
    this.root.hidden = !visible;
  }

  dispose(): void {
    this.root.remove();
    this.labels = [];
  }
}
