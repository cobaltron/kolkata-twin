import { BufferAttribute, Color, CylinderGeometry, IcosahedronGeometry, InstancedMesh, Matrix4, MeshStandardMaterial, Quaternion, Vector3, type BufferGeometry } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Layer, LayerContext } from '../../core/layers/Layer';
import { randomStream } from '../traffic/Movers';

const TRUNK = new Color(0x6b5440);
// Leaf greens for a generic broad-crowned tree; chosen per tree at random, not by species (unknown).
const LEAVES = [0x4f7f3a, 0x5c8a3e, 0x45713a, 0x6a9443, 0x587f4a];

/** One low-poly tree, 1 m tall with a crown of radius 1 around its upper half; scaled per instance. */
function unitTree(): { trunk: BufferGeometry; crown: BufferGeometry } {
  const trunk = new CylinderGeometry(0.035, 0.05, 0.5, 6).translate(0, 0.25, 0);
  // Three overlapping blobs read as a rounded, slightly irregular crown from any direction.
  const blob = (x: number, y: number, z: number, r: number): BufferGeometry => new IcosahedronGeometry(r, 0).scale(1, 0.8, 1).translate(x, y, z);
  const crown = mergeGeometries([blob(0, 0.68, 0, 0.5), blob(0.24, 0.56, 0.1, 0.36), blob(-0.2, 0.58, -0.16, 0.38)].map((g) => g.toNonIndexed()));
  crown.computeVertexNormals();
  // Darker underside, lighter top, baked into vertex colours.
  const pos = crown.getAttribute('position');
  const shade = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) shade.fill(0.72 + 0.4 * Math.min(1, Math.max(0, (pos.getY(i) - 0.3) / 0.7)), i * 3, i * 3 + 3);
  crown.setAttribute('color', new BufferAttribute(shade, 3));
  return { trunk, crown };
}

/**
 * Trees placed from the Meta / WRI canopy-height map: position and height follow real canopy;
 * the split into individual trees, crown size, shape and colour are illustrative (see tools/canopy.py).
 * Two InstancedMeshes (trunks, crowns): two draw calls for any number of trees.
 */
export class TreesLayer implements Layer {
  readonly id = 'trees';
  readonly label = 'Trees (from canopy map)';
  private ctx: LayerContext | null = null;
  private trunks: InstancedMesh | null = null;
  private crowns: InstancedMesh | null = null;

  async load(ctx: LayerContext): Promise<void> {
    this.ctx = ctx;
    const { trees } = await ctx.cityData.load();
    const count = trees.length / 4;
    if (count === 0) return; // this area has no canopy data
    const unit = unitTree();
    this.trunks = new InstancedMesh(unit.trunk, new MeshStandardMaterial({ color: TRUNK, roughness: 1 }), count);
    this.crowns = new InstancedMesh(unit.crown, new MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true }), count);
    const random = randomStream(2718);
    const matrix = new Matrix4(), position = new Vector3(), scale = new Vector3(), turn = new Quaternion(), up = new Vector3(0, 1, 0), colour = new Color();
    for (let i = 0; i < count; i++) {
      const x = trees[i * 4]!, y = trees[i * 4 + 1]!, height = trees[i * 4 + 2]!, radius = trees[i * 4 + 3]!;
      position.set(x, 0, -y);
      turn.setFromAxisAngle(up, random() * Math.PI * 2);
      // Trunk: full height, thickness following the crown. Crown: unit radius 0.5 scaled to the tree's radius.
      this.trunks.setMatrixAt(i, matrix.compose(position, turn, scale.set(radius * 1.3, height, radius * 1.3)));
      this.crowns.setMatrixAt(i, matrix.compose(position, turn, scale.set(radius * 2, height, radius * 2)));
      this.crowns.setColorAt(i, colour.set(LEAVES[Math.floor(random() * LEAVES.length)]!).multiplyScalar(0.9 + 0.2 * random()));
    }
    for (const mesh of [this.trunks, this.crowns]) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.renderOrder = 10;
      mesh.instanceMatrix.needsUpdate = true;
      ctx.scene.add(mesh);
    }
    if (this.crowns.instanceColor) this.crowns.instanceColor.needsUpdate = true;
  }

  update(): void {}

  setVisible(visible: boolean): void {
    if (this.trunks) this.trunks.visible = visible;
    if (this.crowns) this.crowns.visible = visible;
  }

  dispose(): void {
    for (const mesh of [this.trunks, this.crowns]) {
      if (!mesh) continue;
      this.ctx?.scene.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as MeshStandardMaterial).dispose();
    }
  }
}
