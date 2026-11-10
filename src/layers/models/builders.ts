import { BoxGeometry, BufferGeometry, ConeGeometry, CylinderGeometry, Matrix4, Quaternion, SphereGeometry, Vector3 } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { LandmarkModel } from '../../shared/cityFormat';

/**
 * Procedural landmark geometry. Each builder returns one merged geometry in a local frame:
 * +X along the feature's long axis, +Y up, origin on the ground at the anchor.
 * Overall dimensions come from config/landmark-models.json (sourced); everything else is schematic
 * and is described per model in that file.
 */
export interface BuiltModel {
  geometry: BufferGeometry;
  color: number;
  metalness: number;
  roughness: number;
}

const UP = new Vector3(0, 1, 0);

function at(g: BufferGeometry, x: number, y: number, z: number): BufferGeometry {
  return g.translate(x, y, z);
}
/** A square-section member between two points. */
function member(a: Vector3, b: Vector3, thickness: number): BufferGeometry {
  const dir = b.clone().sub(a);
  const g = new BoxGeometry(thickness, dir.length(), thickness);
  const q = new Quaternion().setFromUnitVectors(UP, dir.clone().normalize());
  return g.applyMatrix4(new Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, new Vector3(1, 1, 1)));
}
function merged(parts: BufferGeometry[]): BufferGeometry {
  const g = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)));
  for (const p of parts) p.dispose();
  g.computeVertexNormals();
  return g;
}

function cantileverBridge(d: Record<string, number>): BuiltModel {
  const parts: BufferGeometry[] = [];
  const tower = d['mainSpanM']! / 2;
  const anchorEnd = tower + d['anchorArmM']!;
  const cantileverEnd = tower - d['cantileverArmM']!;
  const deckTop = d['clearanceM']! + 1.5;
  const top = d['towerHeightM']!;
  const halfTruss = d['trussSpacingM']! / 2;
  parts.push(at(new BoxGeometry(d['lengthM']!, 1.5, d['deckWidthM']!), 0, d['clearanceM']! + 0.75, 0));

  // Top chord profile (schematic away from the towers): rises from the anchorages to the tower tops,
  // falls along the cantilever arms, and runs nearly level across the suspended span.
  const chord: Array<[number, number]> = [
    [-anchorEnd, deckTop + 8], [-tower, top], [-cantileverEnd, deckTop + 26], [0, deckTop + 30],
    [cantileverEnd, deckTop + 26], [tower, top], [anchorEnd, deckTop + 8],
  ];
  const chordY = (x: number): number => {
    for (let i = 0; i < chord.length - 1; i++) {
      const [x0, y0] = chord[i]!, [x1, y1] = chord[i + 1]!;
      if (x >= x0 && x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
    return deckTop;
  };
  const bottomY = deckTop + 1;
  const panel = (2 * anchorEnd) / 34;
  for (const z of [-halfTruss, halfTruss]) {
    for (let i = 0; i < chord.length - 1; i++) {
      parts.push(member(new Vector3(chord[i]![0], chord[i]![1], z), new Vector3(chord[i + 1]![0], chord[i + 1]![1], z), 2.2));
    }
    parts.push(member(new Vector3(-anchorEnd, bottomY, z), new Vector3(anchorEnd, bottomY, z), 1.8));
    for (let i = 0; i <= 34; i++) {
      const x = -anchorEnd + i * panel;
      parts.push(member(new Vector3(x, bottomY, z), new Vector3(x, chordY(x), z), 0.9));
      if (i < 34) {
        const x2 = x + panel;
        const rising = i % 2 === 0;
        parts.push(member(new Vector3(x, rising ? bottomY : chordY(x), z), new Vector3(x2, rising ? chordY(x2) : bottomY, z), 0.8));
      }
    }
    for (const x of [-tower, tower]) parts.push(member(new Vector3(x, 0, z), new Vector3(x, top, z), 4.5));
  }
  // Portal bracing between the two truss planes.
  for (const x of [-tower, tower]) {
    for (const y of [top, top * 0.72, top * 0.45]) parts.push(member(new Vector3(x, y, -halfTruss), new Vector3(x, y, halfTruss), 2));
  }
  for (let i = 2; i <= 32; i += 2) {
    const x = -anchorEnd + i * panel;
    parts.push(member(new Vector3(x, chordY(x), -halfTruss), new Vector3(x, chordY(x), halfTruss), 0.8));
  }
  return { geometry: merged(parts), color: 0xb4bac0, metalness: 0.1, roughness: 0.6 };
}

function domedHall(d: Record<string, number>, base: number): BuiltModel {
  const parts: BufferGeometry[] = [];
  const figure = d['figureHeightM']!;
  const apex = d['totalHeightM']! - figure;
  const radius = d['chamberDiameterM']! / 2 + 2.5; // chamber plus wall thickness (schematic)
  const drumTop = base + (apex - base) * 0.45;
  parts.push(at(new CylinderGeometry(radius, radius + 1, drumTop - base, 32), 0, (base + drumTop) / 2, 0));
  const dome = new SphereGeometry(radius, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2);
  dome.scale(1, (apex - drumTop) / radius, 1);
  parts.push(at(dome, 0, drumTop, 0));
  parts.push(at(new CylinderGeometry(0.5, 0.9, figure, 8), 0, apex + figure / 2, 0));
  // Four corner cupolas (schematic positions and size).
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      parts.push(at(new CylinderGeometry(4, 4, 5, 16), sx * 40, base + 2.5, sz * 26));
      parts.push(at(new SphereGeometry(4.2, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), sx * 40, base + 5, sz * 26));
    }
  }
  return { geometry: merged(parts), color: 0xf3f0e8, metalness: 0, roughness: 0.6 };
}

function minar(d: Record<string, number>): BuiltModel {
  const h = d['totalHeightM']!;
  const parts: BufferGeometry[] = [
    at(new BoxGeometry(11, h * 0.12, 11), 0, h * 0.06, 0),
    at(new CylinderGeometry(2.3, 3.3, h * 0.7, 20), 0, h * 0.12 + h * 0.35, 0),
    at(new CylinderGeometry(4, 4, 0.8, 20), 0, h * 0.64, 0),
    at(new CylinderGeometry(3.6, 3.6, 0.8, 20), 0, h * 0.82, 0),
    at(new CylinderGeometry(1.9, 1.9, h * 0.08, 16), 0, h * 0.86, 0),
  ];
  const cupola = new SphereGeometry(2.2, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  cupola.scale(1, (h * 0.07) / 2.2, 1);
  parts.push(at(cupola, 0, h * 0.9, 0), at(new CylinderGeometry(0.15, 0.3, h * 0.03, 6), 0, h * 0.985, 0));
  return { geometry: merged(parts), color: 0xeee9dc, metalness: 0, roughness: 0.7 };
}

function spiredChurch(d: Record<string, number>, base: number): BuiltModel {
  const top = d['spireHeightM']!;
  const side = d['naveWidthM']! * 0.42; // tower footprint relative to the nave width (schematic)
  const towerTop = Math.max(base + 6, top * 0.62);
  const parts: BufferGeometry[] = [at(new BoxGeometry(side, towerTop, side), 0, towerTop / 2, 0)];
  const spire = new ConeGeometry(side * 0.62, top - towerTop, 4);
  spire.rotateY(Math.PI / 4);
  parts.push(at(spire, 0, (top + towerTop) / 2, 0));
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) parts.push(at(new ConeGeometry(0.9, 6, 4), (sx * side) / 2, towerTop + 3, (sz * side) / 2));
  }
  return { geometry: merged(parts), color: 0xe4dfd2, metalness: 0, roughness: 0.75 };
}

export function buildLandmark(model: LandmarkModel): BuiltModel {
  switch (model.kind) {
    case 'cantilever-bridge':
      return cantileverBridge(model.dimensions);
    case 'domed-hall':
      return domedHall(model.dimensions, model.baseHeight);
    case 'minar':
      return minar(model.dimensions);
    case 'spired-church':
      return spiredChurch(model.dimensions, model.baseHeight);
  }
}
