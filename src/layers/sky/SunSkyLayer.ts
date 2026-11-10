import { Color, DirectionalLight, HemisphereLight, MathUtils, Vector3 } from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import type { Layer, LayerContext } from '../../core/layers/Layer';
import type { TimeState } from '../../core/time/types';
import { sunVector } from '../../shared/sun';

const SUN_LOW = new Color(0xff9d5c);
const SUN_HIGH = new Color(0xfff3de);
const SKY_DAY = new Color(0xbfd4ea);
const SKY_NIGHT = new Color(0x5b70a8);
const GROUND_DAY = new Color(0x8a7f6c);
const GROUND_NIGHT = new Color(0x2a2f40);
const BACKGROUND_NIGHT = new Color(0x070b16);
/** Recompute the sun at most once per this many simulated seconds. */
const SUN_STEP_SECONDS = 20;

/**
 * Sun position (SunCalc) from simulated time: directional light with shadows, sky dome and ambient fill.
 * Shadows cover a square around the camera focus and re-render only when the sun or the focus moves.
 */
export class SunSkyLayer implements Layer {
  readonly id = 'sun-sky';
  readonly label = 'Sun, sky & shadows';
  private ctx: LayerContext | null = null;
  private readonly sun = new DirectionalLight(0xffffff, 3);
  private readonly ambient = new HemisphereLight(SKY_DAY, GROUND_DAY, 1);
  private readonly sky = new Sky();
  private readonly direction = new Vector3(0, 1, 0);
  private lastInstant = Number.NaN;
  private lastEpoch = -1;
  private readonly shadowCentre = new Vector3(Number.NaN, 0, 0);

  async load(ctx: LayerContext): Promise<void> {
    this.ctx = ctx;
    const q = ctx.quality;
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
    const cam = this.sun.shadow.camera;
    cam.left = cam.bottom = -q.shadowRadius;
    cam.right = cam.top = q.shadowRadius;
    cam.near = 200;
    cam.far = 6000;
    cam.updateProjectionMatrix();
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = (q.shadowRadius * 2) / q.shadowMapSize;

    this.sky.scale.setScalar(9000);
    const u = this.sky.material.uniforms;
    u['turbidity']!.value = 6;
    u['rayleigh']!.value = 1.6;
    u['mieCoefficient']!.value = 0.006;
    u['mieDirectionalG']!.value = 0.8;
    // The addon's procedural clouds are switched off; cloud cover is driven by the Phase 1 weather layer.
    if (u['cloudCoverage']) u['cloudCoverage'].value = 0;

    ctx.scene.add(this.sun, this.sun.target, this.ambient, this.sky);
  }

  update(time: TimeState): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (time.epoch !== this.lastEpoch || !(Math.abs(time.instant - this.lastInstant) < SUN_STEP_SECONDS * 1000)) {
      this.lastEpoch = time.epoch;
      this.lastInstant = time.instant;
      this.applySun(time.instant, ctx);
    }
    // Keep the shadow frustum centred on what the camera is looking at.
    const { focus, quality } = ctx;
    if (!(Math.hypot(focus.x - this.shadowCentre.x, focus.z - this.shadowCentre.z) < quality.shadowRadius * 0.08)) {
      this.placeShadowCamera(ctx);
    }
  }

  private applySun(instant: number, ctx: LayerContext): void {
    const { lat, lon } = ctx.frame.originLonLat;
    const s = sunVector(instant, lat, lon, ctx.frame.convergence);
    this.direction.set(s.x, s.y, s.z);
    const altDeg = MathUtils.radToDeg(s.altitude);
    const day = MathUtils.smoothstep(altDeg, -6, 8); // twilight ramp
    const direct = MathUtils.smoothstep(altDeg, -1, 10);

    this.sun.intensity = 3.2 * direct;
    this.sun.color.lerpColors(SUN_LOW, SUN_HIGH, MathUtils.smoothstep(altDeg, 0, 30));
    this.sun.castShadow = direct > 0.02;
    this.ambient.intensity = MathUtils.lerp(1.3, 1.1, day); // night fill stands in for moon and city glow
    this.ambient.color.lerpColors(SKY_NIGHT, SKY_DAY, day);
    this.ambient.groundColor.lerpColors(GROUND_NIGHT, GROUND_DAY, day);
    this.sky.material.uniforms['sunPosition']!.value.copy(this.direction);
    // The analytic sky goes black well below the horizon; fall back to a plain night background there.
    this.sky.visible = day > 0.02;
    ctx.scene.background = BACKGROUND_NIGHT;
    this.placeShadowCamera(ctx);
  }

  private placeShadowCamera(ctx: LayerContext): void {
    // Snap to shadow-map texels so shadows do not shimmer while panning.
    const texel = (ctx.quality.shadowRadius * 2) / ctx.quality.shadowMapSize;
    this.shadowCentre.set(Math.round(ctx.focus.x / texel) * texel, 0, Math.round(ctx.focus.z / texel) * texel);
    this.sun.target.position.copy(this.shadowCentre);
    this.sun.position.copy(this.shadowCentre).addScaledVector(this.direction, 3000);
    this.sun.target.updateMatrixWorld();
    ctx.requestShadowUpdate();
  }

  setVisible(visible: boolean): void {
    this.sun.visible = visible;
    if (!visible) this.sky.visible = false;
    // With the sun layer off, keep a flat neutral fill so the city stays readable.
    if (!visible) {
      this.ambient.intensity = 2.2;
      this.ambient.color.set(0xffffff);
      this.ambient.groundColor.set(0x999999);
    } else {
      this.lastInstant = Number.NaN; // forces applySun on the next update
    }
  }

  dispose(): void {
    this.ctx?.scene.remove(this.sun, this.sun.target, this.ambient, this.sky);
    this.sun.dispose();
    this.ambient.dispose();
    this.sky.geometry.dispose();
    this.sky.material.dispose();
  }
}
