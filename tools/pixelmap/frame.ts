/**
 * The pixel map's own local frame: metres east (x) and north (y) of the area's lat/lon, on a
 * tangent-plane approximation. It matches the frame the top-down Google render is drawn in
 * (true north up), which differs from the app's UTM grid north by about half a degree.
 */
export function areaFrame(lat0: number, lon0: number): (lon: number, lat: number) => [number, number] {
  const p = (lat0 * Math.PI) / 180; // metres per degree on WGS84 at this latitude
  const kx = 111412.84 * Math.cos(p) - 93.5 * Math.cos(3 * p) + 0.118 * Math.cos(5 * p);
  const ky = 111132.92 - 559.82 * Math.cos(2 * p) + 1.175 * Math.cos(4 * p) - 0.0023 * Math.cos(6 * p);
  return (lon, lat) => [(lon - lon0) * kx, (lat - lat0) * ky];
}
