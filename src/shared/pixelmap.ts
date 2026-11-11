/**
 * Geometry of the generated pixel map, shared by the offline tools and the in-app viewer.
 *
 * Area frame: metres east (x) and north (y) of the area's lat/lon on a tangent-plane approximation,
 * true north up. It is the frame the top-down Google imagery is rendered in, and differs from the
 * app's UTM grid north by about half a degree.
 *
 * Map camera: orthographic, heading `azimuth` degrees clockwise from north, pitched down by
 * `elevation` degrees, `metresPerPixel` across the screen. The image is centred on the area's origin.
 */
export interface PixelMapCamera {
  lat: number;
  lon: number;
  azimuthDeg: number;
  elevationDeg: number;
  metresPerPixel: number;
  width: number;
  height: number;
}

export function areaFrame(lat0: number, lon0: number): (lon: number, lat: number) => [number, number] {
  const p = (lat0 * Math.PI) / 180; // metres per degree on WGS84 at this latitude
  const kx = 111412.84 * Math.cos(p) - 93.5 * Math.cos(3 * p) + 0.118 * Math.cos(5 * p);
  const ky = 111132.92 - 559.82 * Math.cos(2 * p) + 1.175 * Math.cos(4 * p) - 0.0023 * Math.cos(6 * p);
  return (lon, lat) => [(lon - lon0) * kx, (lat - lat0) * ky];
}

/** Returns a function mapping an area-frame point (east, north, height) to image pixels [x, y]. */
export function mapProjector(cam: PixelMapCamera): (east: number, north: number, height?: number) => [number, number] {
  const az = (cam.azimuthDeg * Math.PI) / 180, el = (Math.abs(cam.elevationDeg) * Math.PI) / 180;
  const ca = Math.cos(az), sa = Math.sin(az), se = Math.sin(el), ce = Math.cos(el);
  const k = 1 / cam.metresPerPixel;
  // Screen right is east turned by the heading; screen up combines the ground direction of travel
  // (foreshortened by the pitch) with height.
  return (east, north, height = 0) => [
    cam.width / 2 + (east * ca - north * sa) * k,
    cam.height / 2 - (se * (east * sa + north * ca) + ce * height) * k,
  ];
}
