import { toIst } from '../../core/time/ist';
import type { Scenario } from '../../core/time/types';
import { clearState, sampleSeries, type WeatherSample, type WeatherSeries, type WeatherState } from '../../core/environment/weather';

const HOURLY = 'precipitation,cloud_cover,relative_humidity_2m,temperature_2m,wind_speed_10m,wind_direction_10m';
export const OPEN_METEO_ATTRIBUTION = 'Open-Meteo.com (CC BY 4.0)';

interface OpenMeteoHourly {
  time: number[];
  precipitation: number[];
  cloud_cover: number[];
  relative_humidity_2m: number[];
  temperature_2m: number[];
  wind_speed_10m: number[];
  wind_direction_10m: number[];
}
interface OpenMeteoForecast {
  current?: Omit<{ [K in keyof OpenMeteoHourly]: number }, 'time'> & { time: number; interval: number };
  hourly: OpenMeteoHourly;
}

export function toSeries(h: OpenMeteoHourly): WeatherSeries {
  return {
    times: h.time.map((t) => t * 1000),
    precipitation: h.precipitation,
    cloudCover: h.cloud_cover,
    humidity: h.relative_humidity_2m,
    temperature: h.temperature_2m,
    windSpeed: h.wind_speed_10m,
    windDirection: h.wind_direction_10m,
  };
}

/** Live conditions and the surrounding hourly forecast from Open-Meteo (no API key). */
export class LiveWeather {
  private series: WeatherSeries | null = null;
  private current: { instant: number; sample: WeatherSample } | null = null;
  private failed = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly lat: number, private readonly lon: number) {}

  start(): void {
    if (this.timer) return;
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), 10 * 60 * 1000);
  }
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async refresh(): Promise<void> {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${this.lat.toFixed(4)}&longitude=${this.lon.toFixed(4)}` +
      `&current=${HOURLY}&hourly=${HOURLY}&past_days=1&forecast_days=2&timezone=GMT&timeformat=unixtime&wind_speed_unit=ms`;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as OpenMeteoForecast;
      this.series = toSeries(data.hourly);
      const c = data.current;
      this.current = c
        ? {
            instant: c.time * 1000,
            sample: {
              // "current" precipitation is the sum over the preceding `interval` seconds.
              precipitationMmH: (c.precipitation * 3600) / c.interval,
              cloudCover: c.cloud_cover / 100,
              humidity: c.relative_humidity_2m / 100,
              temperatureC: c.temperature_2m,
              windSpeedMs: c.wind_speed_10m,
              windFromDeg: c.wind_direction_10m,
            },
          }
        : null;
      this.failed = false;
    } catch (err) {
      console.warn('Open-Meteo live fetch failed', err);
      this.failed = true;
    }
  }

  sample(instant: number): WeatherState {
    // Prefer the 15-minute "current" block while it is fresh, else the hourly series.
    if (this.current && Math.abs(instant - this.current.instant) < 20 * 60 * 1000) {
      return { ...this.current.sample, status: 'ok', synthetic: false, source: `Live: ${OPEN_METEO_ATTRIBUTION}, current conditions (model analysis, not a gauge)` };
    }
    const s = this.series && sampleSeries(this.series, instant);
    if (s) return { ...s, status: 'ok', synthetic: false, source: `Live: ${OPEN_METEO_ATTRIBUTION}, hourly forecast` };
    if (this.failed) return clearState('unavailable', 'Live weather unavailable (Open-Meteo request failed); clear sky shown');
    return clearState('loading', 'Loading live weather…');
  }
}

/** Stored scenario file written by tools/fetch-scenarios.ts. */
interface ScenarioFile {
  source: string;
  hourly: OpenMeteoHourly;
}

/** Hourly series for event-mode scenarios: stored files, or the flagged synthetic generator. */
export class ScenarioWeather {
  private readonly cache = new Map<string, { series: WeatherSeries; source: string } | 'loading' | 'failed'>();

  sample(scenario: Scenario, instant: number): WeatherState {
    if (scenario.synthetic) {
      return { ...syntheticStorm(instant), status: 'ok', synthetic: true, source: 'SYNTHETIC placeholder storm (not real data)' };
    }
    if (!scenario.seriesUrl) return clearState('none', 'This scenario has no stored weather series');
    const entry = this.cache.get(scenario.id);
    if (!entry) {
      this.cache.set(scenario.id, 'loading');
      fetch(new URL(scenario.seriesUrl, document.baseURI))
        .then((res) => (res.ok ? (res.json() as Promise<ScenarioFile>) : Promise.reject(new Error(`HTTP ${res.status}`))))
        .then((file) => this.cache.set(scenario.id, { series: toSeries(file.hourly), source: file.source }))
        .catch((err: unknown) => {
          console.warn(`Scenario series ${scenario.id} failed to load`, err);
          this.cache.set(scenario.id, 'failed');
        });
      return clearState('loading', 'Loading scenario weather…');
    }
    if (entry === 'loading') return clearState('loading', 'Loading scenario weather…');
    if (entry === 'failed') return clearState('unavailable', 'Scenario weather failed to load; clear sky shown');
    const s = sampleSeries(entry.series, instant);
    return s ? { ...s, status: 'ok', synthetic: false, source: entry.source } : clearState('unavailable', 'Outside the stored series');
  }
}

/**
 * SYNTHETIC PLACEHOLDER. A smooth, obviously artificial storm keyed on IST time of day: rain peaks at
 * 60 mm/h at 15:00. It exists so rain, cloud and haze rendering can be exercised without real event
 * data. It does not describe any real storm. Badged SYNTHETIC in the UI.
 */
export function syntheticStorm(instant: number): WeatherSample {
  const h = toIst(instant).hours;
  const bump = (centre: number, width: number): number => Math.exp(-(((h - centre) / width) ** 2));
  const storm = bump(15, 3);
  return {
    precipitationMmH: 60 * bump(15, 2),
    cloudCover: 0.2 + 0.8 * storm,
    humidity: 0.65 + 0.33 * storm,
    temperatureC: 30 - 5 * storm,
    windSpeedMs: 3 + 12 * storm,
    windFromDeg: 150,
  };
}
