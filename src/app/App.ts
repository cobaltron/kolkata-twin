import { ACESFilmicToneMapping, Color, PCFShadowMap, PerspectiveCamera, Scene, SRGBColorSpace, WebGLRenderer } from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import type { LayerContext } from '../core/layers/Layer';
import { LayerRegistry } from '../core/layers/LayerRegistry';
import { Environment } from '../core/environment/Environment';
import { TimeController } from '../core/time/TimeController';
import type { Scenario } from '../core/time/types';
import { CityData } from '../data/CityData';
import { HISTORICAL_MIN_YEAR, STUDY_AREA } from '../shared/config';
import { LocalFrame } from '../shared/projection';
import { detectQuality, type QualityTier } from './quality';

export interface FrameStats {
  fps: number;
  frameMs: number;
  drawCalls: number;
  triangles: number;
  /** Draw calls / triangles of the most recent frame that also re-rendered the shadow map. */
  drawCallsWithShadow: number;
  trianglesWithShadow: number;
}

/** Owns the renderer, camera, main loop, TimeController and LayerRegistry. */
export class App {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly controls: MapControls;
  readonly time: TimeController;
  readonly layers: LayerRegistry;
  readonly cityData: CityData;
  readonly quality: QualityTier;
  readonly environment = new Environment();
  readonly stats: FrameStats = { fps: 0, frameMs: 0, drawCalls: 0, triangles: 0, drawCallsWithShadow: 0, trianglesWithShadow: 0 };

  private readonly focus = { x: 0, z: 0 };
  private shadowDirty = true;
  private lastFrame = 0;
  private running = false;

  constructor(private readonly container: HTMLElement, scenarios: Scenario[]) {
    this.quality = detectQuality();
    this.renderer = new WebGLRenderer({ antialias: this.quality.antialias, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, this.quality.maxPixelRatio));
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.42;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false; // static city: re-render shadows only on request
    container.appendChild(this.renderer.domElement);
    this.scene.background = new Color(0x10131a);

    this.camera = new PerspectiveCamera(50, 1, 5, 30000);
    // Start south-west of the Maidan, looking north-east towards Esplanade and BBD Bagh.
    this.camera.position.set(-3550, 1300, 3700);
    this.controls = new MapControls(this.camera, this.renderer.domElement);
    this.controls.target.set(-2250, 0, 800);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.maxPolarAngle = Math.PI * 0.47;
    this.controls.minDistance = 40;
    this.controls.maxDistance = 14000;
    this.controls.update();

    this.time = new TimeController({ minYear: HISTORICAL_MIN_YEAR, scenarios });
    this.cityData = new CityData('data/city.bin');
    const ctx: LayerContext = {
      scene: this.scene,
      camera: this.camera,
      renderer: this.renderer,
      time: this.time,
      frame: LocalFrame.fromBBox(STUDY_AREA.utmZone, STUDY_AREA.bbox),
      cityData: this.cityData,
      environment: this.environment,
      quality: this.quality,
      focus: this.focus,
      requestShadowUpdate: () => {
        this.shadowDirty = true;
      },
    };
    this.layers = new LayerRegistry(ctx);

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastFrame = performance.now();
    this.renderer.setAnimationLoop((now) => this.frame(now));
  }

  private frame(now: number): void {
    const dt = Math.min(Math.max((now - this.lastFrame) / 1000, 0), 0.25);
    this.lastFrame = now;

    const state = this.time.advance(dt);
    this.controls.update();
    this.focus.x = this.controls.target.x;
    this.focus.z = this.controls.target.z;
    this.layers.update(state, dt);

    const withShadow = this.shadowDirty;
    if (withShadow) {
      this.renderer.shadowMap.needsUpdate = true;
      this.shadowDirty = false;
    }
    this.renderer.render(this.scene, this.camera);

    const info = this.renderer.info.render;
    const s = this.stats;
    s.frameMs += (dt * 1000 - s.frameMs) * 0.1;
    s.fps = 1000 / Math.max(s.frameMs, 0.001);
    if (withShadow) {
      s.drawCallsWithShadow = info.calls;
      s.trianglesWithShadow = info.triangles;
    } else {
      s.drawCalls = info.calls;
      s.triangles = info.triangles;
    }
  }

  private resize(): void {
    const w = this.container.clientWidth || 1, h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
}
