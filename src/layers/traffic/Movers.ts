import { BoxGeometry, Color, InstancedMesh, Matrix4, MeshStandardMaterial, Quaternion, Vector3 } from 'three';
import { PathNetwork, type Cursor, type Pose } from './PathNetwork';

export interface MoverKind {
  /** Relative share of the fleet. */
  weight: number;
  length: number;
  width: number;
  height: number;
  colors: number[];
  /** Cruising speed, m/s. */
  speed: number;
}

interface Mover {
  cursor: Cursor;
  kind: MoverKind;
  speed: number;
}

const UP = new Vector3(0, 1, 0);

/** Deterministic pseudo-random stream (mulberry32), so the simulated scene is the same on every load. */
export function randomStream(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A fleet of box-shaped movers on a PathNetwork, drawn as one InstancedMesh (one draw call).
 * SIMULATED: positions, counts and speeds are invented for atmosphere; they are not traffic data.
 */
export class Movers {
  readonly mesh: InstancedMesh;
  private readonly movers: Mover[] = [];
  private readonly random: () => number;
  private readonly pose: Pose = { x: 0, y: 0, dx: 1, dy: 0 };
  private readonly matrix = new Matrix4();
  private readonly position = new Vector3();
  private readonly scale = new Vector3();
  private readonly quaternion = new Quaternion();

  /**
   * @param lateral metres to the left of the centre line (India drives on the left); 0 for rail or water
   * @param y height of the mover's underside above the ground
   */
  constructor(private readonly network: PathNetwork, kinds: MoverKind[], count: number, private readonly lateral: number, private readonly y: number, seed: number) {
    this.random = randomStream(seed);
    const geometry = new BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    this.mesh = new InstancedMesh(geometry, new MeshStandardMaterial({ roughness: 0.55, metalness: 0.1 }), count);
    this.mesh.castShadow = false; // thousands of tiny casters are not worth the shadow-pass cost
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 11;
    const totalWeight = kinds.reduce((sum, k) => sum + k.weight, 0);
    const color = new Color();
    for (let i = 0; i < count && network.paths.length > 0; i++) {
      let pick = this.random() * totalWeight;
      const kind = kinds.find((k) => (pick -= k.weight) < 0) ?? kinds[0]!;
      this.movers.push({ cursor: network.place(this.random(), this.random()), kind, speed: kind.speed * (0.8 + 0.4 * this.random()) });
      this.mesh.setColorAt(i, color.set(kind.colors[Math.floor(this.random() * kind.colors.length)]!));
    }
    this.mesh.count = this.movers.length;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /** @param activeFraction 0..1 share of the fleet on the move (the rest are not drawn) */
  update(dt: number, activeFraction: number): void {
    const active = Math.round(this.movers.length * Math.min(Math.max(activeFraction, 0), 1));
    this.mesh.count = active;
    for (let i = 0; i < active; i++) {
      const m = this.movers[i]!;
      if (dt > 0) this.network.advance(m.cursor, m.speed * dt, this.random());
      const p = this.network.pose(m.cursor, this.pose);
      // Left of the direction of travel is (-dy, dx) in local x-east / y-north axes.
      this.position.set(p.x - p.dy * this.lateral, this.y, -(p.y + p.dx * this.lateral));
      this.quaternion.setFromAxisAngle(UP, Math.atan2(p.dy, p.dx));
      this.scale.set(m.kind.length, m.kind.height, m.kind.width);
      this.mesh.setMatrixAt(i, this.matrix.compose(this.position, this.quaternion, this.scale));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshStandardMaterial).dispose();
  }
}
