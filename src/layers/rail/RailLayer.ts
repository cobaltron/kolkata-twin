import { FlatLayer } from '../flatLayer';

/** Present-day surface rail and tram track from OSM. Tunnels (the Metro) are not drawn. */
export const createRailLayer = (): FlatLayer =>
  new FlatLayer({ id: 'rail', label: 'Rail & tram track (present day)', pick: (c) => c.rail, order: 4, material: {} });
