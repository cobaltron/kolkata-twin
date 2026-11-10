import { clearState, type WeatherState } from './weather';

/**
 * Shared, per-frame environmental state. Written by the layer that owns each quantity and read by
 * any other layer through LayerContext.environment:
 *   weather  <- WeatherLayer        (read by sky lighting now, the flood model in Phase 2)
 *   daylight <- SunSkyLayer         (read by the weather layer for fog colour)
 */
export class Environment {
  weather: WeatherState = clearState('loading', 'Weather layer not loaded');
  /** 0 at night, 1 in full daylight. */
  daylight = 1;
}
