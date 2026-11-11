import { AmbientLight, Color, DirectionalLight, Mesh, MeshLambertMaterial, OrthographicCamera, Scene, Vector3, WebGLRenderer, type BufferGeometry } from 'three';

/** A vehicle drawn from every direction in the painted map's own camera. */
export interface SpriteSheet {
  /** One row of `headings` square cells; cell i shows the model heading 360/headings * i degrees anticlockwise from east. */
  canvas: HTMLCanvasElement;
  cell: number;
  headings: number;
  /** Map pixels (at full zoom) per sprite pixel. */
  scale: number;
}

export const HEADINGS = 32;
const OVERSAMPLE = 2; // sprite pixels per map pixel, so vehicles stay crisp when zoomed in

/**
 * Render a low-poly model into a sprite sheet with the map camera's heading and pitch, the same
 * sun as the block render and the map's scale. Done once per model and colour at start-up.
 */
export function renderSpriteSheet(renderer: WebGLRenderer, geometry: BufferGeometry, tint: number, azimuthDeg: number, elevationDeg: number, metresPerPixel: number): SpriteSheet {
  geometry.computeBoundingSphere();
  const radius = geometry.boundingSphere!.radius;
  const cell = Math.ceil(((radius * 2) / metresPerPixel) * OVERSAMPLE) + 4;
  const canvas = document.createElement('canvas');
  canvas.width = cell * HEADINGS;
  canvas.height = cell;
  const ctx = canvas.getContext('2d')!;

  const scene = new Scene();
  const mesh = new Mesh(geometry, new MeshLambertMaterial({ vertexColors: true, color: new Color(tint) }));
  scene.add(mesh, new AmbientLight(0xffffff, 1.7));
  const sun = new DirectionalLight(0xffffff, 2.0);
  const sunAz = (220 * Math.PI) / 180, sunEl = (50 * Math.PI) / 180;
  sun.position.set(Math.sin(sunAz) * Math.cos(sunEl), Math.sin(sunEl), -Math.cos(sunAz) * Math.cos(sunEl));
  scene.add(sun);

  const az = (azimuthDeg * Math.PI) / 180, el = (Math.abs(elevationDeg) * Math.PI) / 180;
  const forward = new Vector3(Math.sin(az) * Math.cos(el), -Math.sin(el), -Math.cos(az) * Math.cos(el));
  const right = new Vector3(Math.cos(az), 0, Math.sin(az));
  const half = (cell * metresPerPixel) / OVERSAMPLE / 2;
  const camera = new OrthographicCamera(-half, half, half, -half, 0.1, 500);
  camera.up.copy(new Vector3().crossVectors(right, forward));
  camera.position.copy(forward).multiplyScalar(-200);
  camera.lookAt(0, 0, 0);

  renderer.setSize(cell, cell, false);
  renderer.setClearColor(0x000000, 0);
  for (let i = 0; i < HEADINGS; i++) {
    mesh.rotation.y = (i / HEADINGS) * Math.PI * 2; // +X (the model's nose) turns from east towards north
    renderer.render(scene, camera);
    ctx.drawImage(renderer.domElement, i * cell, 0);
  }
  mesh.material.dispose();
  return { canvas, cell, headings: HEADINGS, scale: 1 / OVERSAMPLE };
}
