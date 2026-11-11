import { BoxGeometry, BufferAttribute, BufferGeometry, CylinderGeometry } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Low-poly procedural models for the simulated movers. Each is one merged geometry with vertex
 * colours, in metres, with its length along +X, its underside at y = 0 and its centre at the origin.
 * Parts coloured BODY are white so the per-instance colour shows through; other parts keep their own.
 *
 * These are stylised impressions of Kolkata's street and river traffic, not scale replicas, and the
 * dimensions are approximate.
 */
type RGB = readonly [number, number, number];
const BODY: RGB = [1, 1, 1];
const GLASS: RGB = [0.16, 0.2, 0.25];
const TYRE: RGB = [0.07, 0.07, 0.08];
const DARK: RGB = [0.18, 0.18, 0.2];
const YELLOW: RGB = [0.98, 0.78, 0.05];
const GREEN: RGB = [0.1, 0.42, 0.22];
const CREAM: RGB = [0.94, 0.9, 0.78];
const BLUE: RGB = [0.16, 0.36, 0.66];
const WOOD: RGB = [0.42, 0.28, 0.16];
const THATCH: RGB = [0.72, 0.6, 0.36];
const RED: RGB = [0.7, 0.16, 0.13];
const SKIN: RGB = [0.45, 0.3, 0.2];
const STEEL: RGB = [0.62, 0.64, 0.66];

function paint(g: BufferGeometry, color: RGB): BufferGeometry {
  const out = g.index ? g.toNonIndexed() : g;
  const n = out.getAttribute('position').count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.set(color, i * 3);
  out.setAttribute('color', new BufferAttribute(c, 3));
  out.deleteAttribute('uv');
  return out;
}
/** Box of size (length, height, width) centred at (x, y, z). */
function box(l: number, h: number, w: number, x: number, y: number, z: number, color: RGB): BufferGeometry {
  return paint(new BoxGeometry(l, h, w).translate(x, y, z), color);
}
/** Wheel with its axle across the vehicle. */
function wheel(radius: number, width: number, x: number, z: number, color: RGB = TYRE): BufferGeometry {
  return paint(new CylinderGeometry(radius, radius, width, 10).rotateX(Math.PI / 2).translate(x, radius, z), color);
}
function wheels(radius: number, width: number, xs: number[], halfTrack: number): BufferGeometry[] {
  return xs.flatMap((x) => [wheel(radius, width, x, halfTrack), wheel(radius, width, x, -halfTrack)]);
}
function build(parts: BufferGeometry[]): BufferGeometry {
  const g = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  g.computeVertexNormals();
  return g;
}

/** The yellow Ambassador cab: rounded three-box saloon. */
export function ambassadorTaxi(): BufferGeometry {
  return build([
    box(4.3, 0.62, 1.66, 0, 0.62, 0, YELLOW),
    box(1.5, 0.16, 1.5, 1.25, 1.0, 0, YELLOW), // bonnet hump
    box(1.1, 0.12, 1.5, -1.5, 0.98, 0, YELLOW), // boot
    box(2.0, 0.5, 1.5, -0.15, 1.2, 0, GLASS),
    box(1.8, 0.1, 1.46, -0.15, 1.49, 0, YELLOW), // roof
    box(0.5, 0.14, 0.3, -0.1, 1.6, 0, DARK), // roof sign
    box(0.08, 0.2, 1.5, 2.16, 0.6, 0, STEEL), // chrome bumper
    ...wheels(0.33, 0.22, [1.35, -1.35], 0.78),
  ]);
}

/** A generic small car; the instance colour sets the paint. */
export function hatchback(): BufferGeometry {
  return build([
    box(3.9, 0.6, 1.62, 0, 0.6, 0, BODY),
    box(2.1, 0.5, 1.5, -0.25, 1.15, 0, GLASS),
    box(1.9, 0.08, 1.46, -0.25, 1.43, 0, BODY),
    ...wheels(0.3, 0.2, [1.2, -1.25], 0.76),
  ]);
}

/** City bus: body colour per instance, with a window band and a lighter roof. */
export function bus(): BufferGeometry {
  return build([
    box(10.4, 1.25, 2.5, 0, 1.0, 0, BODY),
    box(10.2, 0.85, 2.44, 0, 2.05, 0, GLASS),
    box(10.4, 0.28, 2.5, 0, 2.6, 0, CREAM),
    box(0.1, 0.5, 2.0, 5.2, 2.0, 0, GLASS), // windscreen
    ...wheels(0.48, 0.3, [3.4, -3.0], 1.1),
  ]);
}

/** Green-and-yellow auto-rickshaw: three wheels, canvas-style top. */
export function autoRickshaw(): BufferGeometry {
  return build([
    box(2.5, 0.62, 1.28, 0, 0.6, 0, GREEN),
    box(1.9, 0.62, 1.24, -0.2, 1.2, 0, GLASS),
    box(2.1, 0.16, 1.3, -0.15, 1.58, 0, YELLOW),
    box(0.5, 0.5, 0.7, 1.05, 0.95, 0, GREEN), // nose
    wheel(0.24, 0.16, 1.0, 0),
    ...wheels(0.24, 0.16, [-0.85], 0.58),
  ]);
}

/** Cycle rickshaw: rider in front, a hooded bench seat behind, three thin wheels. */
export function cycleRickshaw(): BufferGeometry {
  return build([
    box(0.9, 0.5, 0.9, -0.55, 0.75, 0, RED), // seat
    box(0.95, 0.08, 1.0, -0.6, 1.55, 0, BLUE), // hood
    box(0.06, 0.8, 0.9, -1.0, 1.15, 0, BLUE), // hood back
    box(1.3, 0.06, 0.06, 0.35, 0.6, 0, DARK), // frame
    box(0.28, 0.6, 0.36, 0.45, 1.05, 0, CREAM), // rider's torso
    box(0.2, 0.2, 0.2, 0.47, 1.47, 0, SKIN), // rider's head
    wheel(0.36, 0.05, 1.0, 0, DARK),
    ...wheels(0.36, 0.05, [-0.55], 0.5).map((g) => paint(g, DARK)),
  ]);
}

/** Hand-pulled rickshaw: two tall wheels, a hooded seat, long shafts and the puller on foot. */
export function handRickshaw(): BufferGeometry {
  return build([
    box(0.8, 0.45, 0.8, -0.6, 0.95, 0, RED),
    box(0.85, 0.07, 0.9, -0.65, 1.7, 0, DARK),
    box(0.06, 0.7, 0.8, -1.02, 1.32, 0, DARK),
    box(1.9, 0.05, 0.05, 0.55, 0.9, 0.32, WOOD), // shafts
    box(1.9, 0.05, 0.05, 0.55, 0.9, -0.32, WOOD),
    box(0.26, 0.75, 0.36, 1.35, 1.0, 0, CREAM), // puller
    box(0.2, 0.2, 0.2, 1.37, 1.5, 0, SKIN),
    box(0.2, 0.6, 0.3, 1.35, 0.3, 0, DARK),
    ...wheels(0.55, 0.05, [-0.6], 0.48).map((g) => paint(g, WOOD)),
  ]);
}

/** Two-car Calcutta tram: cream over blue, with a trolley pole on the leading car. */
export function tram(): BufferGeometry {
  const car = (x: number): BufferGeometry[] => [
    box(8.2, 1.1, 2.2, x, 0.95, 0, BLUE),
    box(8.0, 0.8, 2.14, x, 1.9, 0, GLASS),
    box(8.2, 0.5, 2.2, x, 2.55, 0, CREAM),
    box(7.4, 0.14, 1.5, x, 2.87, 0, DARK), // roof vent box
    ...wheels(0.4, 0.2, [x + 2.6, x - 2.6], 0.72).map((g) => paint(g, DARK)),
  ];
  return build([
    ...car(4.35),
    ...car(-4.35),
    box(0.5, 1.4, 1.6, 0, 1.4, 0, DARK), // articulation
    box(3.2, 0.05, 0.05, 3.6, 3.5, 0, DARK), // trolley pole
  ]);
}

/** Passenger launch of the kind that crosses the Hooghly: white hull, upper deck, funnel. */
export function ferry(): BufferGeometry {
  return build([
    box(20, 1.3, 5.6, 0, 0.65, 0, BODY),
    box(3.0, 1.3, 4.0, 11.2, 0.65, 0, BODY), // bow taper (two steps)
    box(1.8, 1.3, 2.2, 13.4, 0.65, 0, BODY),
    box(14, 1.5, 4.8, -1.5, 2.05, 0, GLASS),
    box(14.6, 0.2, 5.2, -1.5, 2.9, 0, CREAM),
    box(3.2, 1.4, 2.8, 3.6, 3.7, 0, BODY), // wheelhouse
    box(1.0, 1.8, 1.0, -3.0, 3.9, 0, RED), // funnel
    box(22, 0.25, 5.7, 0.5, 0.3, 0, BLUE), // waterline band
  ]);
}

/** Country boat (nouka): long dark wooden hull with raised ends and a thatched shelter. */
export function countryBoat(): BufferGeometry {
  return build([
    box(7.0, 0.55, 1.9, 0, 0.28, 0, WOOD),
    box(1.6, 0.5, 1.3, 4.1, 0.55, 0, WOOD),
    box(0.9, 0.5, 0.7, 5.2, 0.85, 0, WOOD),
    box(1.6, 0.5, 1.3, -4.1, 0.55, 0, WOOD),
    box(0.9, 0.5, 0.7, -5.2, 0.85, 0, WOOD),
    box(3.0, 0.9, 1.7, -0.4, 1.0, 0, THATCH),
    box(0.25, 0.75, 0.3, 3.2, 0.95, 0, CREAM), // boatman
  ]);
}

/** Flat cargo barge; the instance colour sets the hull. */
export function barge(): BufferGeometry {
  return build([
    box(34, 1.6, 7.6, 0, 0.8, 0, BODY),
    box(26, 0.7, 6.2, 2.5, 1.95, 0, DARK), // hold covers
    box(4.0, 2.4, 5.0, -14.0, 2.8, 0, CREAM), // deckhouse
    box(0.8, 1.4, 0.8, -14.6, 4.7, 0, RED),
  ]);
}
