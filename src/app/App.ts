import { ACESFilmicToneMapping, Color, DoubleSide, Mesh, MeshBasicMaterial, OrthographicCamera, RingGeometry, Vector3, PCFShadowMap, PerspectiveCamera, Scene, SRGBColorSpace, WebGLRenderer } from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPixelatedPass } from 'three/addons/postprocessing/RenderPixelatedPass.js';
import { MapControls } from 'three/addons/controls/MapControls.js';
import type { LayerContext, ViewState } from '../core/layers/Layer';
import { LayerRegistry } from '../core/layers/LayerRegistry';
import { Environment } from '../core/environment/Environment';
import { TimeController } from '../core/time/TimeController';
import type { TimeState } from '../core/time/types';
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

export type ViewMode = 'perspective' | 'isometric';

// Isometric pixel view, after Yadong Xie's "Isometric Pixel City": one orthographic camera pointed
// 15 degrees west of north and tilted 45 degrees down (not strictly isometric, but the familiar look).
const ISO_BEARING = (-15 * Math.PI) / 180;
const ISO_TILT = Math.PI / 4;
const ISO_DISTANCE = 8000;
/** Ground metres per CSS pixel at zoom 1. */
const ISO_METRES_PER_PIXEL = 3;
/** Size of one "art pixel" in CSS pixels. */
const ISO_PIXEL_SIZE = 2.5;

/** Owns the renderer, camera, main loop, TimeController and LayerRegistry. */
export class App {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly perspectiveCamera: PerspectiveCamera;
  readonly isoCamera: OrthographicCamera;
  readonly controls: MapControls;
  readonly isoControls: MapControls;
  readonly view: ViewState = { isometric: false, span: 4000 };
  readonly time: TimeController;
  readonly layers: LayerRegistry;
  readonly cityData: CityData;
  readonly quality: QualityTier;
  readonly environment = new Environment();
  readonly stats: FrameStats = { fps: 0, frameMs: 0, drawCalls: 0, triangles: 0, drawCallsWithShadow: 0, trianglesWithShadow: 0 };

  private readonly focus = { x: 0, z: 0 };
  private readonly frameOfReference = LocalFrame.fromBBox(STUDY_AREA.utmZone, STUDY_AREA.bbox);
  private shadowDirty = true;
  private lastFrame = 0;
  private running = false;
  /** While true the 3D scene is not drawn (another view covers it); time and per-frame hooks still run. */
  suspended = false;
  private readonly frameListeners = new Set<(state: TimeState, dt: number) => void>();
  private readonly composer: EffectComposer;
  private readonly pixelPass: RenderPixelatedPass;
  private readonly viewListeners = new Set<(mode: ViewMode) => void>();
  private flight: { t: number; from: Vector3; to: Vector3; fromOffset: Vector3; toOffset: Vector3; fromZoom: number; toZoom: number } | null = null;
  private readonly marker = new Mesh(new RingGeometry(0.82, 1, 48), new MeshBasicMaterial({ color: 0xe8b04a, transparent: true, depthTest: false, side: DoubleSide }));
  private markerAge = Infinity;

  constructor(private readonly container: HTMLElement) {
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

    this.renderer.info.autoReset = false; // the isometric view renders several passes per frame

    this.perspectiveCamera = new PerspectiveCamera(50, 1, 5, 30000);
    // Start south-west of the Maidan, looking north-east towards Esplanade and BBD Bagh.
    this.perspectiveCamera.position.set(-3550, 1300, 3700);
    this.controls = new MapControls(this.perspectiveCamera, this.renderer.domElement);
    this.controls.target.set(-2250, 0, 800);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.maxPolarAngle = Math.PI * 0.47;
    this.controls.minDistance = 40;
    this.controls.maxDistance = 14000;
    this.controls.update();

    this.isoCamera = new OrthographicCamera(-1, 1, 1, -1, 10, 30000);
    this.isoControls = new MapControls(this.isoCamera, this.renderer.domElement);
    this.isoControls.enableRotate = false; // the whole point of the view is one fixed camera angle
    this.isoControls.enableDamping = true;
    this.isoControls.dampingFactor = 0.12;
    this.isoControls.minZoom = 0.25;
    this.isoControls.maxZoom = 14;
    this.isoControls.enabled = false;
    this.isoCamera.zoom = 3; // about 1 m of ground per CSS pixel: individual buildings read clearly
    this.placeIsoCamera(-2250, 800);

    this.composer = new EffectComposer(this.renderer);
    this.pixelPass = new RenderPixelatedPass(this.isoPixelSize(), this.scene, this.isoCamera, { normalEdgeStrength: 0.35, depthEdgeStrength: 0.45 });
    this.composer.addPass(this.pixelPass);
    this.composer.addPass(new OutputPass());

    this.marker.rotation.x = -Math.PI / 2;
    this.marker.renderOrder = 200;
    this.marker.visible = false;
    this.scene.add(this.marker);

    // No scenarios are registered: event mode exists in TimeController but has nothing to replay yet.
    this.time = new TimeController({ minYear: HISTORICAL_MIN_YEAR });
    this.cityData = new CityData('data/city.bin');
    const app = this;
    const ctx: LayerContext = {
      scene: this.scene,
      get camera() {
        return app.camera;
      },
      view: this.view,
      renderer: this.renderer,
      time: this.time,
      frame: this.frameOfReference,
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

  /** The camera of the current view mode. */
  get camera(): PerspectiveCamera | OrthographicCamera {
    return this.view.isometric ? this.isoCamera : this.perspectiveCamera;
  }
  get viewMode(): ViewMode {
    return this.view.isometric ? 'isometric' : 'perspective';
  }

  /** Switch between the free 3D camera and the fixed isometric pixel view, keeping the focus point. */
  setViewMode(mode: ViewMode): void {
    if (mode === this.viewMode) return;
    const isometric = mode === 'isometric';
    const from = isometric ? this.controls : this.isoControls;
    if (isometric) {
      this.placeIsoCamera(from.target.x, from.target.z);
    } else {
      const offset = this.perspectiveCamera.position.clone().sub(this.controls.target);
      this.controls.target.set(from.target.x, 0, from.target.z);
      this.perspectiveCamera.position.copy(this.controls.target).add(offset);
    }
    this.flight = null;
    this.view.isometric = isometric;
    this.controls.enabled = !isometric;
    this.isoControls.enabled = isometric;
    this.container.classList.toggle('isometric', isometric);
    this.shadowDirty = true;
    for (const listener of this.viewListeners) listener(mode);
  }

  /**
   * Fly the camera to a place (local metres, x east / y north) and pulse a ring there.
   * @param distance how far the 3D camera ends up from the place, metres
   */
  flyTo(x: number, y: number, distance = 650): void {
    const controls = this.view.isometric ? this.isoControls : this.controls;
    const camera = this.camera;
    const fromOffset = camera.position.clone().sub(controls.target);
    this.flight = {
      t: 0,
      from: controls.target.clone(),
      to: new Vector3(x, 0, -y),
      fromOffset,
      // 3D: keep the viewing direction, change the distance. Isometric: the offset is fixed, the zoom changes.
      toOffset: this.view.isometric ? fromOffset.clone() : fromOffset.clone().setLength(distance),
      fromZoom: this.isoCamera.zoom,
      toZoom: Math.max(this.isoCamera.zoom, 5),
    };
    this.marker.position.set(x, 2, -y);
    this.markerAge = 0;
  }

  private stepFlight(dt: number): void {
    const f = this.flight;
    if (f) {
      f.t = Math.min(1, f.t + dt / 1.4);
      const k = f.t * f.t * (3 - 2 * f.t); // smoothstep ease
      const controls = this.view.isometric ? this.isoControls : this.controls;
      controls.target.lerpVectors(f.from, f.to, k);
      this.camera.position.copy(controls.target).add(f.fromOffset.clone().lerp(f.toOffset, k));
      if (this.view.isometric) {
        this.isoCamera.zoom = f.fromZoom + (f.toZoom - f.fromZoom) * k;
        this.isoCamera.updateProjectionMatrix();
      }
      if (f.t >= 1) this.flight = null;
    }
    // Destination ring: expands and fades over three seconds.
    this.markerAge += dt;
    const life = this.markerAge / 3;
    this.marker.visible = life < 1;
    if (life < 1) {
      this.marker.scale.setScalar(20 + 90 * ((this.markerAge * 0.8) % 1));
      this.marker.material.opacity = (1 - life) * (1 - ((this.markerAge * 0.8) % 1));
    }
  }

  /** Run `listener` once per frame, after time advances, whether or not the 3D scene is drawn. */
  onFrame(listener: (state: TimeState, dt: number) => void): () => void {
    this.frameListeners.add(listener);
    return () => this.frameListeners.delete(listener);
  }

  /** The projection between lon/lat and the app's local metric frame. */
  get localFrame(): LocalFrame {
    return this.frameOfReference;
  }

  onViewModeChange(listener: (mode: ViewMode) => void): () => void {
    this.viewListeners.add(listener);
    return () => this.viewListeners.delete(listener);
  }

  private placeIsoCamera(x: number, z: number): void {
    const horizontal = Math.cos(ISO_TILT) * ISO_DISTANCE;
    this.isoControls.target.set(x, 0, z);
    // The camera sits behind the target, opposite the viewing direction.
    this.isoCamera.position.set(x - Math.sin(ISO_BEARING) * horizontal, Math.sin(ISO_TILT) * ISO_DISTANCE, z + Math.cos(ISO_BEARING) * horizontal);
    this.isoControls.update();
  }

  private isoPixelSize(): number {
    return Math.max(2, Math.round(ISO_PIXEL_SIZE * this.renderer.getPixelRatio()));
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
    for (const listener of this.frameListeners) listener(state, dt);
    if (this.suspended) return;
    this.stepFlight(dt);
    const controls = this.view.isometric ? this.isoControls : this.controls;
    controls.update();
    this.focus.x = controls.target.x;
    this.focus.z = controls.target.z;
    this.view.span = this.view.isometric
      ? (this.isoCamera.top - this.isoCamera.bottom) / this.isoCamera.zoom
      : this.perspectiveCamera.position.distanceTo(this.controls.target);
    this.layers.update(state, dt);

    const withShadow = this.shadowDirty;
    if (withShadow) {
      this.renderer.shadowMap.needsUpdate = true;
      this.shadowDirty = false;
    }
    this.renderer.info.reset();
    if (this.view.isometric) this.composer.render(dt);
    else this.renderer.render(this.scene, this.perspectiveCamera);

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
    this.perspectiveCamera.aspect = w / h;
    this.perspectiveCamera.updateProjectionMatrix();
    const halfW = (w * ISO_METRES_PER_PIXEL) / 2, halfH = (h * ISO_METRES_PER_PIXEL) / 2;
    this.isoCamera.left = -halfW;
    this.isoCamera.right = halfW;
    this.isoCamera.top = halfH;
    this.isoCamera.bottom = -halfH;
    this.isoCamera.updateProjectionMatrix();
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    this.pixelPass.setPixelSize(this.isoPixelSize());
  }
}
