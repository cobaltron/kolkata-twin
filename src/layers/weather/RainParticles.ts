import { InstancedBufferAttribute, InstancedBufferGeometry, Mesh, NormalBlending, PlaneGeometry, ShaderMaterial, Vector3, Vector4 } from 'three';

const BOX = 90; // metres; drops live in a cube of this size that follows the camera
const FALL_SPEED = 9; // m/s, typical terminal velocity of a large raindrop

const VERTEX = /* glsl */ `
  attribute vec3 seed;
  uniform vec3 uCentre;
  uniform vec3 uOffset;
  uniform vec3 uDirection;
  uniform float uBox;
  uniform float uLength;
  uniform float uWidth;
  uniform vec4 uFade; // near fade-in start/end, far fade-out start/end (metres from the camera)
  varying float vAlpha;
  void main() {
    // Stateless wrap: every drop is its seed plus a shared offset, folded into the box around the camera.
    vec3 p = uCentre + mod(seed * uBox + uOffset - uCentre, uBox) - 0.5 * uBox;
    vec3 world = p - uDirection * (uLength * (0.6 + 0.8 * seed.y)) * uv.y;
    vec4 mv = viewMatrix * vec4(world, 1.0);
    vec3 dirView = (viewMatrix * vec4(uDirection, 0.0)).xyz;
    vec2 side = normalize(vec2(-dirView.y, dirView.x) + vec2(1e-4, 0.0));
    mv.xy += side * position.x * uWidth;
    gl_Position = projectionMatrix * mv;
    float dist = -mv.z;
    vAlpha = smoothstep(uFade.x, uFade.y, dist) * (1.0 - smoothstep(uFade.z, uFade.w, dist)) * (1.0 - uv.y * 0.7);
    if (world.y < 0.0) vAlpha = 0.0; // nothing falls below the ground plane
  }
`;
const FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vAlpha;
  void main() {
    gl_FragColor = vec4(uColor, vAlpha * uOpacity);
  }
`;

/**
 * Rain as GPU-instanced streaks. All motion happens in the vertex shader; the CPU only advances one
 * shared offset per frame. The number of drawn instances scales with the rain rate.
 */
export class RainParticles {
  readonly mesh: Mesh<InstancedBufferGeometry, ShaderMaterial>;
  private readonly offset = new Vector3();
  private readonly velocity = new Vector3(0, -FALL_SPEED, 0);

  constructor(private readonly maxDrops: number) {
    const geometry = new InstancedBufferGeometry();
    const quad = new PlaneGeometry(2, 1); // x in [-1, 1]; uv.y runs along the streak
    geometry.setIndex(quad.getIndex());
    geometry.setAttribute('position', quad.getAttribute('position'));
    geometry.setAttribute('uv', quad.getAttribute('uv'));
    const seeds = new Float32Array(maxDrops * 3);
    // Deterministic low-discrepancy fill; no need for Math.random.
    for (let i = 0; i < maxDrops; i++) {
      seeds[i * 3] = (i * 0.754877666) % 1;
      seeds[i * 3 + 1] = (i * 0.569840291) % 1;
      seeds[i * 3 + 2] = (i * 0.362437104) % 1;
    }
    geometry.setAttribute('seed', new InstancedBufferAttribute(seeds, 3));
    geometry.instanceCount = 0;
    const material = new ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        uCentre: { value: new Vector3() },
        uOffset: { value: this.offset },
        uDirection: { value: new Vector3(0, -1, 0) },
        uBox: { value: BOX },
        uLength: { value: 1.2 },
        uWidth: { value: 0.012 },
        uColor: { value: new Vector3(0.78, 0.83, 0.9) },
        uOpacity: { value: 0.5 },
        uFade: { value: new Vector4(1.5, 6, BOX * 0.3, BOX * 0.5) },
      },
      transparent: true,
      depthWrite: false,
      blending: NormalBlending,
    });
    this.mesh = new Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 100;
    this.mesh.visible = false;
  }

  /**
   * @param fraction 0..1 share of the particle budget to draw
   * @param wind horizontal wind velocity in scene axes, m/s
   * @param daylight 0..1, dims the streaks at night
   * @param overview when set (isometric view), rain fills a box of this size centred on `centre`
   *                 instead of the small box around a perspective camera, with streaks scaled to match
   */
  update(dt: number, fraction: number, centre: Vector3, wind: { x: number; z: number }, daylight: number, overview: number | null): void {
    const count = Math.round(this.maxDrops * fraction);
    this.mesh.geometry.instanceCount = count;
    this.mesh.visible = count > 0;
    if (count === 0) return;
    this.velocity.set(wind.x, -FALL_SPEED, wind.z);
    this.offset.addScaledVector(this.velocity, dt);
    // Keep the offset bounded so 32-bit shader floats stay precise over long sessions.
    const box = overview ?? BOX;
    const scale = box / BOX;
    this.offset.set(this.offset.x % box, this.offset.y % box, this.offset.z % box);
    const u = this.mesh.material.uniforms;
    (u['uCentre']!.value as Vector3).copy(centre);
    u['uBox']!.value = box;
    u['uWidth']!.value = overview ? box / 900 : 0.012;
    if (overview) (u['uFade']!.value as Vector4).set(-2, -1, 1e8, 1e9); // no distance fade under an orthographic camera
    else (u['uFade']!.value as Vector4).set(1.5, 6, BOX * 0.3, BOX * 0.5);
    (u['uDirection']!.value as Vector3).copy(this.velocity).normalize();
    u['uLength']!.value = (0.7 + 1.1 * fraction) * (overview ? scale * 0.35 : 1);
    u['uOpacity']!.value = (0.25 + 0.4 * fraction) * (0.35 + 0.65 * daylight);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
