import { Group, Mesh, MeshStandardMaterial } from 'three';
import type { Layer, LayerContext } from '../../core/layers/Layer';
import { buildLandmark } from './builders';

/**
 * Stylised 3D models for a short list of landmarks that an extruded footprint cannot represent
 * (bridge trusses, domes, spires). Position and orientation come from OSM; overall dimensions are
 * sourced per model in config/landmark-models.json; finer detail is schematic and says so in the UI.
 */
export class LandmarkModelsLayer implements Layer {
  readonly id = 'landmark-models';
  readonly label = 'Landmark models (stylised)';
  private readonly group = new Group();
  private ctx: LayerContext | null = null;

  async load(ctx: LayerContext): Promise<void> {
    this.ctx = ctx;
    const { models } = (await ctx.cityData.load()).header;
    for (const model of models) {
      const built = buildLandmark(model);
      const mesh = new Mesh(built.geometry, new MeshStandardMaterial({ color: built.color, metalness: built.metalness, roughness: built.roughness }));
      mesh.name = model.id;
      mesh.position.set(model.x, 0, -model.y);
      // Local +X is the feature's long axis; bearings run clockwise from grid north (-Z).
      mesh.rotation.y = Math.PI / 2 - model.bearing;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.renderOrder = 10;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      this.group.add(mesh);
    }
    ctx.scene.add(this.group);
  }

  update(): void {}

  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  dispose(): void {
    this.ctx?.scene.remove(this.group);
    for (const child of this.group.children) {
      const mesh = child as Mesh;
      mesh.geometry.dispose();
      (mesh.material as MeshStandardMaterial).dispose();
    }
    this.group.clear();
  }
}
