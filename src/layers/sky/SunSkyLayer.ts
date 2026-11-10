import { Color, DirectionalLight, HemisphereLight, MathUtils, Vector3 } from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import type { Layer, LayerContext } from '../../core/layers/Layer';
import type { TimeState } from '../../core/time/types';
import { rainParticleFraction } from '../../core/environment/weather';
import { sunVector } from '../../shared/sun';

const SUN_LOW = new Color(0xff9d5c);
const SUN_HIGH = new Color(0xfff3de);
const SKY_DAY = new Color(0xbfd4ea);
const SKY_OVERCAST = new Color(0xb9bec4);
const SKY_NIGHT = new Color(0x5b70a8);
const GROUND_DAY = new Color(0x8a7f6c);
const GROUND_NIGHT = new Color(0x2a2f40);
const BACKGROUND_NIGHT = new Color(0x070b16);
/** Recompute the sun at most once per this many simulated seconds. */
const SUN_STEP_SECONDS = 20;
const BASE_EXPOSURE = 0.42;

/**
 * Sun position (SunCalc) from simulated time: directional light with shadows, sky dome and ambient fill.
 * Shadows cover a square around the camera focus and re-render only when the sun or the focus moves.
 * Cloud cover and rain (from ctx.environment.weather) dim the direct sun, grey the ambient fill and
 * drive the sky dome's cloud deck. Publishes ctx.environment.daylight.
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
  // Sun-only terms, recomputed when simulated time moves; weather is applied on top every frame.
  private day = 1;
  private direct = 1;
  private cloud = 0;
  private rain = 0;
  private skyClock = 0;
  private skyLit = true;
  private lastEpoch = -1;
  private readonly shadowCentre = new Vector3(Number.NaN, 0, 0);
  /** Current half-width of the shadowed square, metres. Grows with camera distance. */
  private shadowRadius = 0;

  async load(ctx: LayerContext): Promise<void> {
    this.ctx = ctx;
    const q = ctx.quality;
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
    this.sun.shadow.camera.near = 200;
    this.sun.shadow.camera.far = 16000;
    this.sun.shadow.bias = -0.0004;

    this.sky.scale.setScalar(9000);
    const u = this.sky.material.uniforms;
    u['turbidity']!.value = 6;
    u['rayleigh']!.value = 1.6;
    u['mieCoefficient']!.value = 0.006;
    u['mieDirectionalG']!.value = 0.8;
    // The addon's procedural cloud deck is driven by the weather layer's cloud cover (see applyWeather).
    u['cloudCoverage']!.value = 0;

    ctx.scene.add(this.sun, this.sun.target, this.ambient, this.sky);
  }

  update(time: TimeState, dt: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const snap = time.epoch !== this.lastEpoch;
    if (snap || !(Math.abs(time.instant - this.lastInstant) < SUN_STEP_SECONDS * 1000)) {
      this.lastEpoch = time.epoch;
      this.lastInstant = time.instant;
      this.applySun(time.instant, ctx);
    }
    this.applyWeather(ctx, time.paused ? 0 : dt, snap ? 1 : 1 - Math.exp(-dt * 1.5));
    // Keep the shadow frustum centred on what the camera is looking at.
    const { focus } = ctx;
    const wanted = this.wantedShadowRadius(ctx);
    const moved = !(Math.hypot(focus.x - this.shadowCentre.x, focus.z - this.shadowCentre.z) < this.shadowRadius * 0.08);
    if (moved || Math.abs(wanted - this.shadowRadius) > this.shadowRadius * 0.15) this.placeShadowCamera(ctx);
  }

  private applySun(instant: number, ctx: LayerContext): void {
    const { lat, lon } = ctx.frame.originLonLat;
    const s = sunVector(instant, lat, lon, ctx.frame.convergence);
    this.direction.set(s.x, s.y, s.z);
    const altDeg = MathUtils.radToDeg(s.altitude);
    this.day = MathUtils.smoothstep(altDeg, -6, 8); // twilight ramp
    this.direct = MathUtils.smoothstep(altDeg, -1, 10);
    const day = this.day;
    ctx.environment.daylight = day;
    this.sun.color.lerpColors(SUN_LOW, SUN_HIGH, MathUtils.smoothstep(altDeg, 0, 30));
    this.sky.material.uniforms['sunPosition']!.value.copy(this.direction);
    // The analytic sky goes black well below the horizon; fall back to a plain night background there.
    this.skyLit = day > 0.02;
    ctx.scene.background = BACKGROUND_NIGHT;
    this.placeShadowCamera(ctx);
  }

  /**
   * Cloud cover through lighting and sky. Heuristic, not radiometry: direct sun falls with the square
   * of cloud cover (broken cloud still lets most sun through), ambient fill dims and greys, rain darkens both.
   */
  private applyWeather(ctx: LayerContext, dt: number, k: number): void {
    const w = ctx.environment.weather;
    this.cloud += (w.cloudCover - this.cloud) * k;
    this.rain += (rainParticleFraction(w.precipitationMmH) - this.rain) * k;
    const c = this.cloud, r = this.rain, day = this.day;

    const sunIntensity = 5.4 * this.direct * (1 - 0.9 * c * c) * (1 - 0.5 * r);
    this.sun.intensity = sunIntensity;
    const castShadow = sunIntensity > 0.15;
    if (castShadow !== this.sun.castShadow) {
      this.sun.castShadow = castShadow;
      ctx.requestShadowUpdate();
    }
    this.ambient.intensity = MathUtils.lerp(2.2, 1.9, day) * (1 - 0.3 * c * day) * (1 - 0.25 * r); // night fill stands in for moon and city glow
    this.ambient.color.lerpColors(SKY_DAY, SKY_OVERCAST, c).lerp(SKY_NIGHT, 1 - day);
    this.ambient.groundColor.lerpColors(GROUND_NIGHT, GROUND_DAY, day);

    // Overcast and rain also darken the sky dome itself, which only responds to exposure.
    ctx.renderer.toneMappingExposure = BASE_EXPOSURE * (1 - 0.22 * c - 0.2 * r);

    // The dome is hidden in the isometric view: its camera looks down from outside the dome.
    this.sky.visible = this.skyLit && !ctx.view.isometric;

    this.skyClock += dt;
    const u = this.sky.material.uniforms;
    u['cloudCoverage']!.value = c;
    u['cloudDensity']!.value = MathUtils.lerp(0.4, 0.95, c);
    u['time']!.value = this.skyClock;
    u['turbidity']!.value = MathUtils.lerp(6, 12, MathUtils.smoothstep(w.humidity, 0.5, 1));
  }

  /**
   * The shadowed square scales with how far out the camera is, so the whole visible area is covered
   * (sharp shadows up close, coarse but uniform ones from the overview) instead of a visible patch.
   */
  private wantedShadowRadius(ctx: LayerContext): number {
    return MathUtils.clamp(ctx.view.span * 0.9, ctx.quality.shadowRadius * 0.4, 7000);
  }

  private placeShadowCamera(ctx: LayerContext): void {
    // Snap to shadow-map texels so shadows do not shimmer while panning.
    const radius = this.wantedShadowRadius(ctx);
    if (radius !== this.shadowRadius) {
      this.shadowRadius = radius;
      const cam = this.sun.shadow.camera;
      cam.left = cam.bottom = -radius;
      cam.right = cam.top = radius;
      cam.updateProjectionMatrix();
      this.sun.shadow.normalBias = (radius * 2) / ctx.quality.shadowMapSize;
    }
    const texel = (radius * 2) / ctx.quality.shadowMapSize;
    this.shadowCentre.set(Math.round(ctx.focus.x / texel) * texel, 0, Math.round(ctx.focus.z / texel) * texel);
    this.sun.target.position.copy(this.shadowCentre);
    this.sun.position.copy(this.shadowCentre).addScaledVector(this.direction, 8000);
    this.sun.target.updateMatrixWorld();
    ctx.requestShadowUpdate();
  }

  setVisible(visible: boolean): void {
    this.sun.visible = visible;
    if (!visible) this.sky.visible = false;
    // With the sun layer off, keep a flat neutral fill so the city stays readable.
    if (!visible) {
      this.ambient.intensity = 3.8;
      if (this.ctx) this.ctx.renderer.toneMappingExposure = BASE_EXPOSURE;
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
