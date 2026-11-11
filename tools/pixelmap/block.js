// The "block" render that the image model repaints: Google's top-down imagery on the ground and on
// roofs, our building footprints extruded to their heights, sun shadows, and the fixed map camera.
// Approach after flash1405/isometric-mumbai (MIT); written for this project's data.
// Driven by tools/pixelmap/render-block.mjs through window.renderTile(tx, ty).
import {
  AmbientLight, BufferAttribute, BufferGeometry, CanvasTexture, Color, DirectionalLight, Mesh, MeshLambertMaterial,
  OrthographicCamera, PCFSoftShadowMap, PlaneGeometry, RepeatWrapping, Scene, ShaderMaterial, ShadowMaterial, Shape,
  ShapeGeometry, ShapeUtils, SRGBColorSpace, TextureLoader, Vector2, Vector3, WebGLRenderer,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const { config: cfg } = window.__RENDER_CONFIG__;
const TILE_PX = cfg.quadrant_px * 2;
const MPP = cfg.meters_per_pixel;
const GRID_W = cfg.cols * cfg.quadrant_px, GRID_H = cfg.rows * cfg.quadrant_px;
const O_MPP = cfg.ortho.meters_per_pixel;
const O_N = Math.ceil(cfg.ortho.quadrants / 2); // imagery tiles per side
const O_TILE_M = TILE_PX * O_MPP;
const O_HALF = (cfg.ortho.quadrants * cfg.quadrant_px * O_MPP) / 2;
const D2R = Math.PI / 180;
// Scene axes: X east, Y up, Z south (so north is -Z), metres from the area's lat/lon.

const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(TILE_PX, TILE_PX);
renderer.outputColorSpace = SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);
const scene = new Scene();

// --- imagery: one unlit material per 1024 px imagery tile; fragments outside the tile are discarded,
// so a roof that straddles tiles is simply drawn once with each tile it touches.
const loader = new TextureLoader();
function imageryMaterial(tx, ty, map) {
  return new ShaderMaterial({
    uniforms: { map: { value: map }, west: { value: -O_HALF + tx * O_TILE_M }, north: { value: O_HALF - ty * O_TILE_M }, size: { value: O_TILE_M } },
    vertexShader: 'varying vec2 vEN; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vEN = vec2(w.x, -w.z); gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `uniform sampler2D map; uniform float west, north, size; varying vec2 vEN;
      void main() { vec2 uv = vec2((vEN.x - west) / size, 1.0 - (north - vEN.y) / size);
        if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) discard;
        gl_FragColor = texture2D(map, uv); #include <colorspace_fragment> }`,
  });
}
const materials = [];
await Promise.all(Array.from({ length: O_N * O_N }, async (_, i) => {
  const tx = i % O_N, ty = Math.floor(i / O_N);
  const map = await loader.loadAsync(`/data/ortho_tiles/tile_${tx}_${ty}.png`);
  map.colorSpace = SRGBColorSpace;
  map.anisotropy = renderer.capabilities.getMaxAnisotropy();
  materials[i] = imageryMaterial(tx, ty, map);
  const quad = new Mesh(new PlaneGeometry(O_TILE_M, O_TILE_M), materials[i]);
  quad.rotation.x = -Math.PI / 2;
  quad.position.set(-O_HALF + (tx + 0.5) * O_TILE_M, 0, -(O_HALF - (ty + 0.5) * O_TILE_M));
  scene.add(quad);
}));

// Small CPU copy of the imagery, to tint each building's walls towards its roof colour.
const small = await loader.loadAsync('/data/ortho_small.jpg');
const sample = document.createElement('canvas');
sample.width = sample.height = small.image.width;
const sctx = sample.getContext('2d', { willReadFrequently: true });
sctx.drawImage(small.image, 0, 0);
function imageryColor(x, y) {
  const u = Math.min(sample.width - 1, Math.max(0, Math.floor(((x + O_HALF) / (2 * O_HALF)) * sample.width)));
  const v = Math.min(sample.height - 1, Math.max(0, Math.floor(((O_HALF - y) / (2 * O_HALF)) * sample.height)));
  const d = sctx.getImageData(u, v, 1, 1).data;
  return new Color().setRGB(d[0] / 255, d[1] / 255, d[2] / 255, SRGBColorSpace);
}

// --- buildings
const FLOOR = 3.2, BAY = 3.0;
const windows = document.createElement('canvas');
windows.width = windows.height = 64;
const wctx = windows.getContext('2d');
wctx.fillStyle = '#ffffff'; wctx.fillRect(0, 0, 64, 64);
wctx.fillStyle = '#5b6470'; wctx.fillRect(16, 16, 32, 30); // one window per bay and storey
wctx.fillStyle = '#d9d9d9'; wctx.fillRect(0, 60, 64, 4);   // storey line
const windowMap = new CanvasTexture(windows);
windowMap.wrapS = windowMap.wrapT = RepeatWrapping;
windowMap.colorSpace = SRGBColorSpace;

const buildings = await (await fetch('/data/buildings.json')).json();
const FACADE = new Color(0xd8cdb8);
const roofByTile = new Map(), wallParts = [], roofParts = [];
for (const b of buildings) {
  const rings = b.rings.map((r) => r.map(([x, y]) => new Vector2(x, y)));
  let outer = rings[0];
  if (outer.length < 3) continue;
  if (ShapeUtils.isClockWise(outer)) outer = outer.slice().reverse();
  const holes = rings.slice(1).filter((h) => h.length >= 3).map((h) => (ShapeUtils.isClockWise(h) ? h : h.slice().reverse()));
  const shape = new Shape(outer);
  for (const h of holes) shape.holes.push(new Shape(h));
  // Roof: the footprint lifted to the building's height (shape x, y -> scene x, -z).
  const roof = new ShapeGeometry(shape);
  roof.rotateX(-Math.PI / 2);
  roof.translate(0, b.h, 0);
  roofParts.push(roof);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, cx = 0, cy = 0;
  for (const p of outer) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); cx += p.x; cy += p.y; }
  const tx0 = Math.max(0, Math.floor((minX + O_HALF) / O_TILE_M)), tx1 = Math.min(O_N - 1, Math.floor((maxX + O_HALF) / O_TILE_M));
  const ty0 = Math.max(0, Math.floor((O_HALF - maxY) / O_TILE_M)), ty1 = Math.min(O_N - 1, Math.floor((O_HALF - minY) / O_TILE_M));
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
    const key = ty * O_N + tx;
    if (!roofByTile.has(key)) roofByTile.set(key, []);
    roofByTile.get(key).push(roof);
  }
  // Walls: one quad per edge, tinted halfway between a neutral facade colour and the roof's colour.
  const tint = FACADE.clone().lerp(imageryColor(cx / outer.length, cy / outer.length), 0.5);
  const pos = [], uv = [], col = [];
  for (const ringPts of [outer, ...holes]) {
    let along = 0;
    for (let i = 0; i < ringPts.length; i++) {
      const a = ringPts[i], c = ringPts[(i + 1) % ringPts.length];
      const len = a.distanceTo(c);
      if (len < 0.05) continue;
      const s0 = along / BAY, s1 = (along + len) / BAY, t1 = b.h / FLOOR;
      pos.push(a.x, 0, -a.y, c.x, 0, -c.y, c.x, b.h, -c.y, a.x, 0, -a.y, c.x, b.h, -c.y, a.x, b.h, -a.y);
      uv.push(s0, 0, s1, 0, s1, t1, s0, 0, s1, t1, s0, t1);
      for (let k = 0; k < 6; k++) col.push(tint.r, tint.g, tint.b);
      along += len;
    }
  }
  if (pos.length) {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
    g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
    wallParts.push(g);
  }
}
for (const [key, parts] of roofByTile) {
  const mesh = new Mesh(mergeGeometries(parts.map((p) => p.clone())), materials[key]);
  scene.add(mesh);
}
const shadowMat = new ShadowMaterial({ opacity: 0.42 });
if (roofParts.length) {
  const allRoofs = mergeGeometries(roofParts);
  allRoofs.computeVertexNormals();
  // Depth-only caster plus a shadow catcher just above the roofs (the imagery itself is unlit).
  const caster = new Mesh(allRoofs, new MeshLambertMaterial({ colorWrite: false, depthWrite: false }));
  caster.castShadow = true;
  const catcher = new Mesh(allRoofs, shadowMat);
  catcher.position.y = 0.05;
  catcher.receiveShadow = true;
  scene.add(caster, catcher);
}
if (wallParts.length) {
  const walls = mergeGeometries(wallParts);
  walls.computeVertexNormals();
  const wallMesh = new Mesh(walls, new MeshLambertMaterial({ map: windowMap, vertexColors: true }));
  wallMesh.castShadow = wallMesh.receiveShadow = true;
  scene.add(wallMesh);
}
const groundCatcher = new Mesh(new PlaneGeometry(O_HALF * 2, O_HALF * 2), shadowMat);
groundCatcher.rotation.x = -Math.PI / 2;
groundCatcher.position.y = 0.03;
groundCatcher.receiveShadow = true;
scene.add(groundCatcher);

// --- sun: shades the walls and casts the shadows
const sunAz = (cfg.sun?.azimuth_degrees ?? 220) * D2R, sunEl = (cfg.sun?.elevation_degrees ?? 50) * D2R;
const sun = new DirectionalLight(0xffffff, 2.2);
const sunDir = new Vector3(Math.sin(sunAz) * Math.cos(sunEl), Math.sin(sunEl), -Math.cos(sunAz) * Math.cos(sunEl));
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.3;
scene.add(sun, sun.target, new AmbientLight(0xffffff, 1.5));

// --- camera: heading = azimuth clockwise from north, pitched down by |elevation|
const az = cfg.camera_azimuth_degrees * D2R, el = Math.abs(cfg.camera_elevation_degrees) * D2R;
const forward = new Vector3(Math.sin(az) * Math.cos(el), -Math.sin(el), -Math.cos(az) * Math.cos(el));
const right = new Vector3(Math.cos(az), 0, Math.sin(az));
const up = new Vector3().crossVectors(right, forward).normalize();
const halfM = (TILE_PX * MPP) / 2;
const camera = new OrthographicCamera(-halfM, halfM, halfM, -halfM, 1, 20000);

window.SCENE_STATS = { buildings: buildings.length, imageryTiles: materials.length };
window.renderTile = async (tx, ty) => {
  // Tile centre on the image plane, in pixels from the grid centre (y down), then in the scene.
  const ox = tx * TILE_PX + TILE_PX / 2 - GRID_W / 2, oy = ty * TILE_PX + TILE_PX / 2 - GRID_H / 2;
  const centre = new Vector3().addScaledVector(right, ox * MPP).addScaledVector(up, -oy * MPP);
  camera.position.copy(centre).addScaledVector(forward, -8000);
  camera.up.copy(up);
  camera.lookAt(centre);
  camera.updateMatrixWorld();
  // Where this tile's view meets the ground: centre the shadow frustum there.
  const ground = centre.clone().addScaledVector(forward, centre.y / Math.sin(el));
  sun.target.position.copy(ground);
  sun.position.copy(ground).addScaledVector(sunDir, 3000);
  const reach = halfM * 2.2;
  Object.assign(sun.shadow.camera, { left: -reach, right: reach, top: reach, bottom: -reach, near: 100, far: 6000 });
  sun.shadow.camera.updateProjectionMatrix();
  sun.target.updateMatrixWorld();
  renderer.render(scene, camera);
  return { ok: true, png: renderer.domElement.toDataURL('image/png') };
};
window.RENDERER_READY = true;
