/**
 * WGS84 -> UTM (transverse Mercator, Snyder 1987 series) -> local metric frame.
 * No runtime dependency; cross-checked against proj4 in tests/projection.test.ts.
 *
 * Local frame: x = metres east of origin, y = metres north of origin (grid north).
 * Scene frame (three.js, Y up): X = x, Y = elevation, Z = -y.
 */
const A = 6378137;
const F = 1 / 298.257223563;
const K0 = 0.9996;
const E2 = F * (2 - F);
const EP2 = E2 / (1 - E2);
const FALSE_EASTING = 500000;
const DEG = Math.PI / 180;

export interface LonLat {
  lon: number;
  lat: number;
}
export interface XY {
  x: number;
  y: number;
}
export interface BBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

export function utmCentralMeridianDeg(zone: number): number {
  return zone * 6 - 183;
}

/** Forward projection, northern hemisphere (false northing 0). Returns easting/northing in metres. */
export function wgs84ToUtm(lon: number, lat: number, zone: number): XY {
  const phi = lat * DEG;
  const dLam = (lon - utmCentralMeridianDeg(zone)) * DEG;
  const sin = Math.sin(phi);
  const cos = Math.cos(phi);
  const tan = Math.tan(phi);
  const N = A / Math.sqrt(1 - E2 * sin * sin);
  const T = tan * tan;
  const C = EP2 * cos * cos;
  const a = dLam * cos;
  const M = meridianArc(phi);
  const a2 = a * a;
  const x =
    K0 * N * (a + ((1 - T + C) * a2 * a) / 6 + ((5 - 18 * T + T * T + 72 * C - 58 * EP2) * a2 * a2 * a) / 120) +
    FALSE_EASTING;
  const y =
    K0 *
    (M +
      N *
        tan *
        (a2 / 2 +
          ((5 - T + 9 * C + 4 * C * C) * a2 * a2) / 24 +
          ((61 - 58 * T + T * T + 600 * C - 330 * EP2) * a2 * a2 * a2) / 720));
  return { x, y };
}

export function utmToWgs84(easting: number, northing: number, zone: number): LonLat {
  const e4 = E2 * E2;
  const e6 = e4 * E2;
  const mu = northing / K0 / (A * (1 - E2 / 4 - (3 * e4) / 64 - (5 * e6) / 256));
  const e1 = (1 - Math.sqrt(1 - E2)) / (1 + Math.sqrt(1 - E2));
  const phi1 =
    mu +
    ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) +
    ((21 * e1 * e1) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) +
    ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) +
    ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);
  const sin = Math.sin(phi1);
  const cos = Math.cos(phi1);
  const tan = Math.tan(phi1);
  const C1 = EP2 * cos * cos;
  const T1 = tan * tan;
  const N1 = A / Math.sqrt(1 - E2 * sin * sin);
  const R1 = (A * (1 - E2)) / Math.pow(1 - E2 * sin * sin, 1.5);
  const D = (easting - FALSE_EASTING) / (N1 * K0);
  const D2 = D * D;
  const phi =
    phi1 -
    ((N1 * tan) / R1) *
      (D2 / 2 -
        ((5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * EP2) * D2 * D2) / 24 +
        ((61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * EP2 - 3 * C1 * C1) * D2 * D2 * D2) / 720);
  const lam =
    (D -
      ((1 + 2 * T1 + C1) * D2 * D) / 6 +
      ((5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * EP2 + 24 * T1 * T1) * D2 * D2 * D) / 120) /
    cos;
  return { lon: utmCentralMeridianDeg(zone) + lam / DEG, lat: phi / DEG };
}

/** Angle (radians, clockwise-positive east of true north) from true north to grid north. */
export function gridConvergence(lon: number, lat: number, zone: number): number {
  return Math.atan(Math.tan((lon - utmCentralMeridianDeg(zone)) * DEG) * Math.sin(lat * DEG));
}

function meridianArc(phi: number): number {
  const e4 = E2 * E2;
  const e6 = e4 * E2;
  return (
    A *
    ((1 - E2 / 4 - (3 * e4) / 64 - (5 * e6) / 256) * phi -
      ((3 * E2) / 8 + (3 * e4) / 32 + (45 * e6) / 1024) * Math.sin(2 * phi) +
      ((15 * e4) / 256 + (45 * e6) / 1024) * Math.sin(4 * phi) -
      ((35 * e6) / 3072) * Math.sin(6 * phi))
  );
}

/** A local metric frame: UTM translated so that the study-area centre is (0, 0). */
export class LocalFrame {
  readonly zone: number;
  readonly originLonLat: LonLat;
  readonly originUtm: XY;
  /** Grid convergence at the origin, radians. */
  readonly convergence: number;

  constructor(zone: number, origin: LonLat) {
    this.zone = zone;
    this.originLonLat = origin;
    this.originUtm = wgs84ToUtm(origin.lon, origin.lat, zone);
    this.convergence = gridConvergence(origin.lon, origin.lat, zone);
  }

  static fromBBox(zone: number, bbox: BBox): LocalFrame {
    return new LocalFrame(zone, { lon: (bbox.west + bbox.east) / 2, lat: (bbox.south + bbox.north) / 2 });
  }

  toLocal(lon: number, lat: number): XY {
    const u = wgs84ToUtm(lon, lat, this.zone);
    return { x: u.x - this.originUtm.x, y: u.y - this.originUtm.y };
  }

  toLonLat(x: number, y: number): LonLat {
    return utmToWgs84(x + this.originUtm.x, y + this.originUtm.y, this.zone);
  }
}
