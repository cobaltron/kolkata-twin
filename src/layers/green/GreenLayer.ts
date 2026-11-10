import { FlatLayer } from '../flatLayer';

/** Parks, gardens, pitches and other green space (the Maidan is the big one). */
export const createGreenLayer = (): FlatLayer =>
  new FlatLayer({ id: 'green', label: 'Parks & green space', pick: (c) => c.green, order: 1, material: {} });
