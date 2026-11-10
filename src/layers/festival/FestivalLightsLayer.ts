import { AdditiveBlending, BufferAttribute, BufferGeometry, Points, ShaderMaterial } from 'three';
import type { Layer, LayerContext } from '../../core/layers/Layer';
import type { TimeState } from '../../core/time/types';
import { randomStream } from '../traffic/Movers';

const SPACING = 9; // metres between lamps along a street
const HEIGHT = 7;

const VERTEX = /* glsl */ `
  attribute vec3 tint;
  attribute float phase;
  uniform float uTime;
  uniform float uNight;
  uniform float uPixelScale;
  varying vec3 vTint;
  varying float vGlow;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    vGlow = (0.55 + 0.45 * sin(uTime * 2.2 + phase * 6.283)) * (0.25 + 0.75 * uNight);
    vTint = tint;
    // Perspective: shrink with distance. Orthographic (projectionMatrix[3][3] == 1): constant size.
    float size = projectionMatrix[3][3] == 1.0 ? 3.0 : clamp(1600.0 / -mv.z, 2.5, 12.0);
    gl_PointSize = size * uPixelScale;
  }
`;
const FRAGMENT = /* glsl */ `
  varying vec3 vTint;
  varying float vGlow;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.05, d);
    gl_FragColor = vec4(vTint * vGlow * 2.4, a);
  }
`;

/**
 * SYNTHETIC festival decoration: strings of coloured lamps along every main street.
 * It does NOT mark real pandals, routes or lighting; no Durga Puja location data is used.
 * Off by default, and badged synthetic in its label.
 */
export class FestivalLightsLayer implements Layer {
  readonly id = 'festival-lights';
  readonly label = 'Festival lights (synthetic decoration)';
  readonly defaultVisible = false;
  private ctx: LayerContext | null = null;
  private points: Points<BufferGeometry, ShaderMaterial> | null = null;
  private clock = 0;

  async load(ctx: LayerContext): Promise<void> {
    this.ctx = ctx;
    const { roads } = (await ctx.cityData.load()).paths;
    const random = randomStream(1905);
    const palette = [[1, 0.78, 0.35], [1, 0.42, 0.55], [0.45, 0.8, 1], [0.6, 1, 0.55], [1, 0.9, 0.7]];
    const positions: number[] = [], tints: number[] = [], phases: number[] = [];
    for (let i = 0; i < roads.offsets.length - 1; i++) {
      const xy = roads.xy.subarray(roads.offsets[i]!, roads.offsets[i + 1]!);
      const colour = palette[Math.floor(random() * palette.length)]!;
      let carry = random() * SPACING;
      for (let k = 0; k < xy.length / 2 - 1; k++) {
        const x0 = xy[k * 2]!, y0 = xy[k * 2 + 1]!, x1 = xy[k * 2 + 2]!, y1 = xy[k * 2 + 3]!;
        const len = Math.hypot(x1 - x0, y1 - y0);
        for (; carry < len; carry += SPACING) {
          const t = carry / len;
          // Lamps sag slightly between supports, like a hung string.
          positions.push(x0 + (x1 - x0) * t, HEIGHT - 0.8 * Math.abs(Math.sin(carry * 0.35)), -(y0 + (y1 - y0) * t));
          tints.push(colour[0]!, colour[1]!, colour[2]!);
          phases.push(random());
        }
        carry -= len;
      }
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
    geometry.setAttribute('tint', new BufferAttribute(new Float32Array(tints), 3));
    geometry.setAttribute('phase', new BufferAttribute(new Float32Array(phases), 1));
    this.points = new Points(
      geometry,
      new ShaderMaterial({
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        uniforms: { uTime: { value: 0 }, uNight: { value: 0 }, uPixelScale: { value: ctx.renderer.getPixelRatio() } },
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    );
    this.points.frustumCulled = false;
    this.points.renderOrder = 50;
    ctx.scene.add(this.points);
  }

  update(time: TimeState, dt: number): void {
    if (!this.points || !this.ctx) return;
    if (!time.paused) this.clock += dt;
    const u = this.points.material.uniforms;
    u['uTime']!.value = this.clock;
    u['uNight']!.value = 1 - this.ctx.environment.daylight;
  }

  setVisible(visible: boolean): void {
    if (this.points) this.points.visible = visible;
  }

  dispose(): void {
    if (!this.points) return;
    this.ctx?.scene.remove(this.points);
    this.points.geometry.dispose();
    this.points.material.dispose();
    this.points = null;
  }
}
