import { Mesh, MeshStandardMaterial, type MeshStandardMaterialParameters } from 'three';
import type { Layer, LayerContext } from '../core/layers/Layer';
import { toBufferGeometry } from '../data/CityData';
import type { MeshData } from '../data/geometry/MeshBuffers';
import type { CityGeometry } from '../data/protocol';

export interface FlatLayerSpec {
  id: string;
  label: string;
  pick(city: CityGeometry): MeshData;
  /**
   * Stacking order among ground-hugging layers (1 = lowest). Flat layers do not write depth and
   * are drawn in this order after the ground, which avoids z-fighting on a perfectly flat city.
   */
  order: number;
  material: MeshStandardMaterialParameters;
}

/** Shared implementation for static, merged, ground-hugging layers (green space, water, roads, rail). */
export class FlatLayer implements Layer {
  readonly id: string;
  readonly label: string;
  private mesh: Mesh | null = null;
  private ctx: LayerContext | null = null;

  constructor(private readonly spec: FlatLayerSpec) {
    this.id = spec.id;
    this.label = spec.label;
  }

  async load(ctx: LayerContext): Promise<void> {
    this.ctx = ctx;
    const city = await ctx.cityData.load();
    const material = new MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.95,
      metalness: 0,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -this.spec.order,
      polygonOffsetUnits: -4 * this.spec.order,
      ...this.spec.material,
    });
    this.mesh = new Mesh(toBufferGeometry(this.spec.pick(city)), material);
    this.mesh.geometry.computeVertexNormals();
    this.mesh.position.y = 0.02 * this.spec.order;
    this.mesh.renderOrder = this.spec.order;
    this.mesh.receiveShadow = true;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.updateMatrix();
    ctx.scene.add(this.mesh);
  }

  update(): void {}

  setVisible(visible: boolean): void {
    if (this.mesh) this.mesh.visible = visible;
  }

  dispose(): void {
    if (!this.mesh) return;
    this.ctx?.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshStandardMaterial).dispose();
    this.mesh = null;
  }
}
