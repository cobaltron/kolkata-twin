import { getPosition } from 'suncalc';

export interface SunVector {
  /** Unit vector pointing from the ground towards the sun, in scene axes (X east, Y up, Z south). */
  x: number;
  y: number;
  z: number;
  /** Elevation above the horizon, radians. */
  altitude: number;
  /** Compass bearing of the sun, radians clockwise from true north. */
  bearing: number;
}

/**
 * Sun direction in scene coordinates.
 * @param convergence grid convergence at the scene origin (radians); rotates true north onto grid north.
 */
export function sunVector(instant: number, lat: number, lon: number, convergence: number): SunVector {
  // SunCalc >= 2.0 returns degrees: azimuth clockwise from true north, apparent (refracted) altitude.
  // (SunCalc 1.x used radians measured from south; tests/projection.test.ts pins the convention.)
  const p = getPosition(new Date(instant), lat, lon);
  const bearing = (p.azimuth * Math.PI) / 180;
  const altitude = (p.altitude * Math.PI) / 180;
  const gridBearing = bearing - convergence;
  const horizontal = Math.cos(altitude);
  return {
    x: Math.sin(gridBearing) * horizontal,
    y: Math.sin(altitude),
    z: -Math.cos(gridBearing) * horizontal,
    altitude,
    bearing,
  };
}
