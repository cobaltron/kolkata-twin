import { Color, InstancedMesh, Matrix4, MeshStandardMaterial, Quaternion, Vector3, type BufferGeometry } from 'three';
import { PathNetwork, type Cursor, type Pose } from './PathNetwork';

export interface MoverKind {
  /** Relative share of the fleet. */
  weight: number;
  /** Model with its length along +X and its underside at y = 0 (see vehicleModels.ts). */
  model: () => BufferGeometry;
  /** Per-instance tints for the model's white "body" parts; use [0xffffff] for a fixed livery. */
  colors: number[];
  /** Cruising speed, m/s. */
  speed: number;
  /** Extra metres to the left of the fleet's lane, e.g. slow vehicles that keep to the kerb. */
  kerbOffset?: number;
}

interface Mover {
  cursor: Cursor;
  speed: number;
  lateral: number;
}
interface Fleet {
  mesh: InstancedMesh;
  movers: Mover[];
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
 * Fleets of modelled movers on a PathNetwork: one InstancedMesh (one draw call) per kind of vehicle.
 * SIMULATED: positions, counts and speeds are invented for atmosphere; they are not traffic data.
 */
export class Movers {
  readonly meshes: InstancedMesh[] = [];
  private readonly fleets: Fleet[] = [];
  private readonly random: () => number;
  private readonly pose: Pose = { x: 0, y: 0, dx: 1, dy: 0 };
  private readonly matrix = new Matrix4();
  private readonly position = new Vector3();
  private readonly scale = new Vector3(1, 1, 1);
  private readonly quaternion = new Quaternion();
  private readonly material = new MeshStandardMaterial({ roughness: 0.6, metalness: 0.05, vertexColors: true });

  /**
   * @param lateral metres to the left of the centre line (India drives on the left); 0 for rail or water
   * @param y height of the movers' undersides above the ground
   */
  constructor(private readonly network: PathNetwork, kinds: MoverKind[], count: number, lateral: number, private readonly y: number, seed: number) {
    this.random = randomStream(seed);
    const totalWeight = kinds.reduce((sum, k) => sum + k.weight, 0);
    const color = new Color();
    for (const kind of kinds) {
      const n = network.paths.length > 0 ? Math.max(1, Math.round((count * kind.weight) / totalWeight)) : 0;
      const mesh = new InstancedMesh(kind.model(), this.material, Math.max(n, 1));
      mesh.castShadow = false; // thousands of tiny casters are not worth the shadow-pass cost
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.renderOrder = 11;
      const movers: Mover[] = [];
      for (let i = 0; i < n; i++) {
        movers.push({ cursor: network.place(this.random(), this.random()), speed: kind.speed * (0.8 + 0.4 * this.random()), lateral: lateral + (kind.kerbOffset ?? 0) });
        mesh.setColorAt(i, color.set(kind.colors[Math.floor(this.random() * kind.colors.length)]!));
      }
      mesh.count = n;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      this.fleets.push({ mesh, movers });
      this.meshes.push(mesh);
    }
  }

  /** @param activeFraction 0..1 share of each fleet on the move (the rest are not drawn) */
  update(dt: number, activeFraction: number): void {
    const share = Math.min(Math.max(activeFraction, 0), 1);
    for (const { mesh, movers } of this.fleets) {
      const active = Math.round(movers.length * share);
      mesh.count = active;
      for (let i = 0; i < active; i++) {
        const m = movers[i]!;
        if (dt > 0) this.network.advance(m.cursor, m.speed * dt, this.random());
        const p = this.network.pose(m.cursor, this.pose);
        // Left of the direction of travel is (-dy, dx) in local x-east / y-north axes.
        this.position.set(p.x - p.dy * m.lateral, this.y, -(p.y + p.dx * m.lateral));
        this.quaternion.setFromAxisAngle(UP, Math.atan2(p.dy, p.dx));
        mesh.setMatrixAt(i, this.matrix.compose(this.position, this.quaternion, this.scale));
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  setVisible(visible: boolean): void {
    for (const mesh of this.meshes) mesh.visible = visible;
  }

  dispose(): void {
    for (const mesh of this.meshes) mesh.geometry.dispose();
    this.material.dispose();
  }
}
