import { FlatLayer } from '../flatLayer';

/** Present-day surface water: the Hooghly, tanks, ponds and open canals. Static in Phase 0. */
export const createWaterLayer = (): FlatLayer =>
  new FlatLayer({ id: 'water', label: 'Water (Hooghly, tanks)', pick: (c) => c.water, order: 2, material: { roughness: 0.35 } });
