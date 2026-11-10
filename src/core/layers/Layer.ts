import type { PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import type { CityData } from '../../data/CityData';
import type { Environment } from '../environment/Environment';
import type { QualityTier } from '../../app/quality';
import type { LocalFrame } from '../../shared/projection';
import type { TimeController } from '../time/TimeController';
import type { TimeState } from '../time/types';

/** Everything a layer may touch. Layers receive this once, in load(). */
export interface LayerContext {
  scene: Scene;
  camera: PerspectiveCamera;
  renderer: WebGLRenderer;
  /** Subscribe to typed time events here. Never read Date.now() in a layer. */
  time: TimeController;
  frame: LocalFrame;
  cityData: CityData;
  /** Shared per-frame environmental state (weather, daylight). */
  environment: Environment;
  quality: QualityTier;
  /** Point the camera is orbiting, in scene coordinates (read-only). */
  focus: { x: number; z: number };
  /** Ask for the shadow map to be re-rendered on the next frame. */
  requestShadowUpdate(): void;
}

/**
 * A feature of the city. Every feature (buildings, weather, flooding, trams, ...) is a Layer.
 */
export interface Layer {
  readonly id: string;
  readonly label: string;
  /** Initial visibility; defaults to true. */
  readonly defaultVisible?: boolean;
  /** Create GPU resources and add them to the scene. Called once. */
  load(ctx: LayerContext): Promise<void>;
  /** Called once per frame while loaded and visible. `dt` is real seconds since the last frame. */
  update(time: TimeState, dt: number): void;
  setVisible(visible: boolean): void;
  /** Remove from the scene and free GPU resources. */
  dispose(): void;
}
