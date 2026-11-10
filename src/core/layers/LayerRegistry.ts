import { Emitter } from '../Emitter';
import type { TimeState } from '../time/types';
import type { Layer, LayerContext } from './Layer';

export type LayerStatus = 'registered' | 'loading' | 'ready' | 'error';

export interface LayerEntry {
  layer: Layer;
  status: LayerStatus;
  visible: boolean;
  error?: string;
}

interface RegistryEvents {
  change: LayerEntry;
}

/** Owns layer lifecycle: registration, loading, per-frame updates, visibility and disposal. */
export class LayerRegistry extends Emitter<RegistryEvents> {
  private readonly entries = new Map<string, LayerEntry>();

  constructor(private readonly ctx: LayerContext) {
    super();
  }

  register(layer: Layer): void {
    if (this.entries.has(layer.id)) throw new Error(`Layer "${layer.id}" is already registered`);
    this.entries.set(layer.id, { layer, status: 'registered', visible: layer.defaultVisible ?? true });
  }

  list(): LayerEntry[] {
    return [...this.entries.values()];
  }

  /** Load every registered layer in parallel. One failing layer does not block the others. */
  async loadAll(): Promise<void> {
    await Promise.all(this.list().map((e) => this.loadEntry(e)));
  }

  private async loadEntry(entry: LayerEntry): Promise<void> {
    if (entry.status !== 'registered') return;
    entry.status = 'loading';
    this.emit('change', entry);
    try {
      await entry.layer.load(this.ctx);
      entry.layer.setVisible(entry.visible);
      entry.status = 'ready';
    } catch (err) {
      entry.status = 'error';
      entry.error = err instanceof Error ? err.message : String(err);
      console.error(`Layer "${entry.layer.id}" failed to load`, err);
    }
    this.ctx.requestShadowUpdate();
    this.emit('change', entry);
  }

  setVisible(id: string, visible: boolean): void {
    const entry = this.entries.get(id);
    if (!entry) throw new Error(`Unknown layer "${id}"`);
    entry.visible = visible;
    if (entry.status === 'ready') entry.layer.setVisible(visible);
    this.ctx.requestShadowUpdate();
    this.emit('change', entry);
  }

  update(time: TimeState, dt: number): void {
    for (const entry of this.entries.values()) {
      if (entry.status === 'ready' && entry.visible) entry.layer.update(time, dt);
    }
  }

  dispose(): void {
    for (const entry of this.entries.values()) {
      if (entry.status === 'ready') entry.layer.dispose();
    }
    this.entries.clear();
  }
}
