import { Mesh, MeshStandardMaterial, PlaneGeometry } from 'three';
import type { Layer, LayerContext } from '../../core/layers/Layer';

/** Flat ground plane over the study area. Replaced by calibrated terrain in Phase 2. */
export class GroundLayer implements Layer {
  readonly id = 'ground';
  readonly label = 'Ground';
  private mesh: Mesh | null = null;
  private ctx: LayerContext | null = null;

  async load(ctx: LayerContext): Promise<void> {
    this.ctx = ctx;
    const { extent } = (await ctx.cityData.load()).header;
    const w = extent.maxX - extent.minX, d = extent.maxY - extent.minY;
    this.mesh = new Mesh(new PlaneGeometry(w, d), new MeshStandardMaterial({ color: 0xa39a8a, roughness: 1 }));
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.position.set((extent.minX + extent.maxX) / 2, 0, -(extent.minY + extent.maxY) / 2);
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
