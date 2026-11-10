import { Box3, Group, Mesh, MeshStandardMaterial, Sphere, Vector3 } from 'three';
import type { Layer, LayerContext } from '../../core/layers/Layer';
import type { TimeState } from '../../core/time/types';
import { toBufferGeometry } from '../../data/CityData';
import { applyFacadeShader, type FacadeUniforms } from './facadeShader';

/**
 * Extruded OSM buildings, merged into one mesh per 1 km tile (frustum-cullable, a few dozen draw calls).
 * Vertex colours encode the height source: warm tones = tagged in OSM, cool grey tint = estimated.
 * Facade detail (windows, storey lines, lit windows at night) is procedural; see facadeShader.ts.
 */
export class BuildingsLayer implements Layer {
  readonly id = 'buildings';
  readonly label = 'Buildings';
  private readonly group = new Group();
  private material: MeshStandardMaterial | null = null;
  private ctx: LayerContext | null = null;
  private facade: FacadeUniforms | null = null;

  async load(ctx: LayerContext): Promise<void> {
    this.ctx = ctx;
    const city = await ctx.cityData.load();
    this.material = new MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
    this.facade = applyFacadeShader(this.material);
    for (const tile of city.buildings) {
      const geometry = toBufferGeometry(tile.mesh);
      geometry.boundingBox = new Box3(new Vector3(...tile.min), new Vector3(...tile.max));
      geometry.boundingSphere = geometry.boundingBox.getBoundingSphere(new Sphere());
      const mesh = new Mesh(geometry, this.material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.renderOrder = 10;
      mesh.matrixAutoUpdate = false;
      this.group.add(mesh);
    }
    ctx.scene.add(this.group);
  }

  update(_time: TimeState): void {
    if (this.facade && this.ctx) this.facade.uNight.value = 1 - this.ctx.environment.daylight;
  }

  setVisible(visible: boolean): void {
    this.group.visible = visible;
  }

  dispose(): void {
    this.ctx?.scene.remove(this.group);
    for (const child of this.group.children) (child as Mesh).geometry.dispose();
    this.group.clear();
    this.material?.dispose();
  }
}
