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
      return { ...this.current.sample, status: 'ok', source: `Live: ${OPEN_METEO_ATTRIBUTION}, current conditions (model analysis, not a gauge)` };
    }
    const s = this.series && sampleSeries(this.series, instant);
    if (s) return { ...s, status: 'ok', source: `Live: ${OPEN_METEO_ATTRIBUTION}, hourly forecast` };
    if (this.failed) return clearState('unavailable', 'Live weather unavailable (Open-Meteo request failed); clear sky shown');
    return clearState('loading', 'Loading live weather…');
  }
}
