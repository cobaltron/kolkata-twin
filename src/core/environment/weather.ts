/** Weather quantities shared between layers (sky lighting, rain, fog, and the Phase 2 flood model). */
export interface WeatherSample {
  /** Rain rate in mm/h. */
  precipitationMmH: number;
  /** Total cloud cover, 0..1. */
  cloudCover: number;
  /** Relative humidity at 2 m, 0..1. */
  humidity: number;
  temperatureC: number;
  /** 10 m wind speed, m/s. */
  windSpeedMs: number;
  /** Direction the wind blows FROM, degrees clockwise from true north. */
  windFromDeg: number;
}

export type WeatherStatus =
  | 'ok' // values come from the named source
  | 'loading' // waiting for data; values are clear-sky defaults
  | 'unavailable' // fetch failed or instant outside the series; clear-sky defaults
  | 'none'; // this time mode has no weather data by design; clear-sky defaults

export interface WeatherState extends WeatherSample {
  status: WeatherStatus;
  /** Human-readable provenance, shown in the UI. */
  source: string;
}

export const CLEAR_SKY: WeatherSample = {
  precipitationMmH: 0,
  cloudCover: 0,
  humidity: 0.5,
  temperatureC: Number.NaN,
  windSpeedMs: 0,
  windFromDeg: 0,
};

export function clearState(status: WeatherStatus, source: string): WeatherState {
  return { ...CLEAR_SKY, status, source };
}

/** Hourly series as delivered by Open-Meteo. `times` are epoch ms, ascending. */
export interface WeatherSeries {
  times: number[];
  /** mm accumulated over the hour ENDING at times[i] (Open-Meteo "preceding hour sum"). */
  precipitation: number[];
  /** Instantaneous values at times[i]. Percent for cloud cover and humidity. */
  cloudCover: number[];
  humidity: number[];
  temperature: number[];
  windSpeed: number[];
  windDirection: number[];
}

/**
 * Sample a series at `instant`. Returns null outside the covered range.
 * Precipitation is a step function (the hourly total applies to the whole preceding hour, so
 * integrating the rate over time reproduces the source totals); other fields interpolate linearly,
 * wind direction along the shorter arc.
 */
export function sampleSeries(series: WeatherSeries, instant: number): WeatherSample | null {
  const { times } = series;
  const n = times.length;
  if (n < 2 || instant < times[0]! || instant > times[n - 1]!) return null;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid]! <= instant) lo = mid;
    else hi = mid;
  }
  const t = (instant - times[lo]!) / (times[hi]! - times[lo]!);
  const lerp = (a: number[]): number => a[lo]! + (a[hi]! - a[lo]!) * t;
  const d0 = series.windDirection[lo]!;
  const delta = ((series.windDirection[hi]! - d0 + 540) % 360) - 180;
  const hours = (times[hi]! - times[lo]!) / 3600000;
  return {
    precipitationMmH: (instant === times[lo]! ? series.precipitation[lo]! : series.precipitation[hi]!) / hours,
    cloudCover: lerp(series.cloudCover) / 100,
    humidity: lerp(series.humidity) / 100,
    temperatureC: lerp(series.temperature),
    windSpeedMs: lerp(series.windSpeed),
    windFromDeg: (d0 + delta * t + 360) % 360,
  };
}

/**
 * Fraction (0..1) of the rain-particle budget to draw for a rain rate. A perceptual mapping, not physics:
 * square-root so drizzle is visible, saturating at 50 mm/h (IMD "very heavy" hourly intensities and above).
 */
export function rainParticleFraction(mmPerHour: number): number {
  if (!(mmPerHour > 0.05)) return 0;
  return Math.min(1, Math.sqrt(mmPerHour / 50));
}

/**
 * Fog density for THREE.FogExp2 from humidity and rain. A visual heuristic, not a calibrated visibility
 * model: about 60 km visual range in dry air, 10 km at saturation, reduced further by rain. The range is
 * deliberately floored at 9 km (real visibility in a downpour is far lower) so the city, and later the
 * flood overlay, stay readable from the overview camera.
 */
export function hazeDensity(humidity: number, mmPerHour: number): number {
  const h = Math.min(Math.max((humidity - 0.4) / 0.6, 0), 1);
  const rangeM = Math.max(9000, (60000 - 50000 * h * h) / (1 + mmPerHour / 10));
  return 2 / rangeM;
}
