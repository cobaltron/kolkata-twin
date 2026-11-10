import { FlatLayer } from '../flatLayer';

/** Roads as merged ribbons. Widths are a per-class drawing heuristic (see tools/build-city.ts). */
export const createRoadsLayer = (): FlatLayer =>
  new FlatLayer({ id: 'roads', label: 'Roads', pick: (c) => c.roads, order: 3, material: {} });
