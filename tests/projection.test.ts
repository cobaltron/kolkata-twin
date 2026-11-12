import proj4 from 'proj4';
import { describe, expect, it } from 'vitest';
import { AREAS } from '../src/shared/config';
const STUDY_AREA = AREAS['central']!;
import { gridConvergence, LocalFrame, utmToWgs84, wgs84ToUtm } from '../src/shared/projection';
import { sunVector } from '../src/shared/sun';

const UTM45N = '+proj=utm +zone=45 +datum=WGS84 +units=m +no_defs';
const POINTS: Array<[string, number, number]> = [
  ['Esplanade', 88.3513, 22.5646],
  ['BBD Bagh', 88.3484, 22.5726],
  ['Howrah Bridge', 88.3468, 22.5851],
  ['bbox SW', STUDY_AREA.bbox.west, STUDY_AREA.bbox.south],
  ['bbox NE', STUDY_AREA.bbox.east, STUDY_AREA.bbox.north],
  ['zone edge', 89.99, 26.5],
];

describe('UTM 45N projection', () => {
  it.each(POINTS)('matches proj4 to the millimetre at %s', (_name, lon, lat) => {
    const [e, n] = proj4('WGS84', UTM45N, [lon, lat]) as [number, number];
    const p = wgs84ToUtm(lon, lat, 45);
    expect(Math.abs(p.x - e)).toBeLessThan(0.001);
    expect(Math.abs(p.y - n)).toBeLessThan(0.001);
  });

  it.each(POINTS)('round-trips at %s', (_name, lon, lat) => {
    const p = wgs84ToUtm(lon, lat, 45);
    const back = utmToWgs84(p.x, p.y, 45);
    expect(Math.abs(back.lon - lon)).toBeLessThan(1e-8);
    expect(Math.abs(back.lat - lat)).toBeLessThan(1e-8);
  });

  it('puts the central meridian at the false easting', () => {
    expect(wgs84ToUtm(87, 22.5, 45).x).toBeCloseTo(500000, 6);
  });

  it('has a small positive grid convergence east of the central meridian', () => {
    const deg = (gridConvergence(88.3475, 22.5625, 45) * 180) / Math.PI;
    expect(deg).toBeGreaterThan(0.4);
    expect(deg).toBeLessThan(0.6);
  });
});

describe('LocalFrame', () => {
  const frame = LocalFrame.fromBBox(STUDY_AREA.utmZone, STUDY_AREA.bbox);

  it('maps the study-area centre to the origin', () => {
    const { lon, lat } = frame.originLonLat;
    const p = frame.toLocal(lon, lat);
    expect(p.x).toBeCloseTo(0, 9);
    expect(p.y).toBeCloseTo(0, 9);
  });

  it('is metric: 0.01 degrees of latitude is about 1107 m north', () => {
    const { lon, lat } = frame.originLonLat;
    const p = frame.toLocal(lon, lat + 0.01);
    expect(p.y).toBeGreaterThan(1104);
    expect(p.y).toBeLessThan(1110);
    expect(Math.abs(p.x)).toBeLessThan(12); // only grid convergence
  });

  it('inverts toLocal', () => {
    const ll = frame.toLonLat(1234.5, -987.6);
    const p = frame.toLocal(ll.lon, ll.lat);
    expect(p.x).toBeCloseTo(1234.5, 4);
    expect(p.y).toBeCloseTo(-987.6, 4);
  });
});

describe('sun vector in scene axes (X east, Y up, Z south)', () => {
  const at = (iso: string) => sunVector(Date.parse(iso), 22.5625, 88.3475, 0);

  it('is in the east in the morning and the west in the evening', () => {
    expect(at('2024-03-20T02:00:00Z').x).toBeGreaterThan(0.5); // 07:30 IST
    expect(at('2024-03-20T11:30:00Z').x).toBeLessThan(-0.5); // 17:00 IST
  });

  it('is high and to the south at winter-solstice local noon', () => {
    const s = at('2024-12-21T06:07:00Z'); // about solar noon at 88.35 E
    expect(s.z).toBeGreaterThan(0.6);
    expect(Math.abs(s.x)).toBeLessThan(0.05);
    expect((s.altitude * 180) / Math.PI).toBeCloseTo(90 - 22.5625 - 23.44, 0);
  });

  it('is below the horizon at local midnight', () => {
    expect(at('2024-06-21T18:30:00Z').y).toBeLessThan(0);
  });
});
