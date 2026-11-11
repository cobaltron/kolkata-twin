// Top-down ("ortho") render of Google Photorealistic 3D Tiles, one 1024 px tile at a time.
// Method after flash1405/isometric-mumbai (MIT): in Indian cities Google's mesh is close to a
// satellite photo draped on terrain, so it is used only as ground and roof imagery.
// Driven by tools/pixelmap/render-ortho.mjs through window.renderTile(tx, ty).
import { MathUtils, MeshBasicMaterial, OrthographicCamera, Scene, SRGBColorSpace, WebGLRenderer } from 'three';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { TilesRenderer } from '3d-tiles-renderer';
import { GLTFExtensionsPlugin, GoogleCloudAuthPlugin, ReorientationPlugin, TileCompressionPlugin } from '3d-tiles-renderer/plugins';

const { apiKey, config: cfg } = window.__RENDER_CONFIG__;
const TILE_PX = cfg.quadrant_px * 2;
const MPP = cfg.ortho.meters_per_pixel;
const SIZE_M = cfg.ortho.quadrants * cfg.quadrant_px * MPP; // the square covered, centred on lat/lon

const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(TILE_PX, TILE_PX);
renderer.outputColorSpace = SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const scene = new Scene();
const half = (TILE_PX * MPP) / 2;
const camera = new OrthographicCamera(-half, half, half, -half, 1, 8000);

const tiles = new TilesRenderer();
tiles.registerPlugin(new GoogleCloudAuthPlugin({ apiToken: apiKey, autoRefreshToken: true }));
tiles.registerPlugin(new TileCompressionPlugin());
tiles.registerPlugin(new GLTFExtensionsPlugin({ dracoLoader: new DRACOLoader().setDecoderPath('/node_modules/three/examples/jsm/libs/draco/gltf/') }));
// After this plugin the tileset is centred on lat/lon with +Y up, +Z north and +X west.
tiles.registerPlugin(new ReorientationPlugin({ lat: cfg.lat * MathUtils.DEG2RAD, lon: cfg.lon * MathUtils.DEG2RAD, height: 0 }));
tiles.errorTarget = cfg.ortho.error_target ?? 2;
tiles.setCamera(camera);
tiles.setResolutionFromRenderer(camera, renderer);
// The imagery is used as a flat photo: draw it unlit so no scene lighting tints it.
tiles.addEventListener('load-model', ({ scene: model }) => {
  model.traverse((o) => {
    if (o.isMesh && o.material.map) o.material = new MeshBasicMaterial({ map: o.material.map });
  });
});
let failures = 0;
tiles.addEventListener('load-error', () => failures++);
scene.add(tiles.group);

const frame = () => new Promise((r) => requestAnimationFrame(r));

window.renderTile = async (tx, ty) => {
  // Tile centre in local metres (east, north); row 0 is the northern edge.
  const east = -SIZE_M / 2 + (tx * TILE_PX + TILE_PX / 2) * MPP;
  const north = SIZE_M / 2 - (ty * TILE_PX + TILE_PX / 2) * MPP;
  camera.up.set(0, 0, 1); // north at the top of the image
  camera.position.set(-east, 4000, north);
  camera.lookAt(-east, 0, north);
  camera.updateMatrixWorld();

  const started = performance.now();
  let quiet = 0, ok = true;
  // Keep refining until nothing has been downloading or parsing for a run of frames.
  while (quiet < 12) {
    tiles.update();
    renderer.render(scene, camera);
    await frame();
    const busy = tiles.stats.downloading + tiles.stats.parsing + (tiles.stats.queued ?? 0);
    quiet = tiles.root && busy === 0 ? quiet + 1 : 0;
    if (performance.now() - started > (cfg.ortho.timeout_ms ?? 240000)) { ok = false; break; }
  }
  renderer.render(scene, camera);
  return { ok, png: renderer.domElement.toDataURL('image/png'), failures, attributions: tiles.getAttributions().map((a) => a.value) };
};
window.RENDERER_READY = true;
