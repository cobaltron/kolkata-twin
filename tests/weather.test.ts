import { describe, expect, it } from 'vitest';
import { hazeDensity, rainParticleFraction, sampleSeries, type WeatherSeries } from '../src/core/environment/weather';
import { syntheticStorm } from '../src/layers/weather/providers';

const H = 3600000;
const SERIES: WeatherSeries = {
  times: [0, H, 2 * H],
  precipitation: [0, 12, 4],
  cloudCover: [0, 50, 100],
  humidity: [60, 80, 100],
  temperature: [30, 28, 26],
  windSpeed: [2, 4, 6],
  windDirection: [350, 10, 30],
};

describe('sampleSeries', () => {
  it('returns null outside the covered range', () => {
    expect(sampleSeries(SERIES, -1)).toBeNull();
    expect(sampleSeries(SERIES, 2 * H + 1)).toBeNull();
  });
  it('treats precipitation as the total of the preceding hour (step function)', () => {
    expect(sampleSeries(SERIES, 0.1 * H)!.precipitationMmH).toBe(12);
    expect(sampleSeries(SERIES, 0.9 * H)!.precipitationMmH).toBe(12);
    expect(sampleSeries(SERIES, 1.5 * H)!.precipitationMmH).toBe(4);
  });
  it('conserves the rainfall total when the rate is integrated', () => {
    let mm = 0;
    const step = H / 600;
    for (let t = step / 2; t < 2 * H; t += step) mm += sampleSeries(SERIES, t)!.precipitationMmH * (step / H);
    expect(mm).toBeCloseTo(16, 6);
  });
  it('interpolates instantaneous fields linearly and scales percentages to 0..1', () => {
    const s = sampleSeries(SERIES, 0.5 * H)!;
    expect(s.cloudCover).toBeCloseTo(0.25, 9);
    expect(s.humidity).toBeCloseTo(0.7, 9);
    expect(s.temperatureC).toBeCloseTo(29, 9);
  });
  it('interpolates wind direction through north, not the long way round', () => {
    expect(sampleSeries(SERIES, 0.5 * H)!.windFromDeg).toBeCloseTo(0, 6);
  });
});

describe('rendering heuristics', () => {
  it('draws no rain when dry, saturates in very heavy rain, and is monotonic', () => {
    expect(rainParticleFraction(0)).toBe(0);
    expect(rainParticleFraction(200)).toBe(1);
    expect(rainParticleFraction(5)).toBeLessThan(rainParticleFraction(20));
  });
  it('haze thickens with humidity and with rain', () => {
    expect(hazeDensity(0.95, 0)).toBeGreaterThan(hazeDensity(0.5, 0));
    expect(hazeDensity(0.8, 30)).toBeGreaterThan(hazeDensity(0.8, 0));
  });
  it('synthetic storm stays inside physical ranges', () => {
    for (let h = 0; h < 24; h++) {
      const s = syntheticStorm(Date.UTC(2024, 5, 21, h));
      expect(s.cloudCover).toBeLessThanOrEqual(1);
      expect(s.humidity).toBeLessThanOrEqual(1);
      expect(s.precipitationMmH).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('LiveWeather (Open-Meteo forecast response shape)', () => {
  // Fixture follows the documented response for timeformat=unixtime; values are arbitrary test numbers.
  const T = 1_800_000_000;
  const fixture = {
    current: { time: T + 900, interval: 900, precipitation: 2.5, cloud_cover: 80, relative_humidity_2m: 90, temperature_2m: 27, wind_speed_10m: 5, wind_direction_10m: 200 },
    hourly: {
      time: [T, T + 3600, T + 7200],
      precipitation: [0, 3, 1],
      cloud_cover: [10, 50, 90],
      relative_humidity_2m: [70, 80, 90],
      temperature_2m: [30, 29, 28],
      wind_speed_10m: [1, 2, 3],
      wind_direction_10m: [90, 100, 110],
    },
  };

  it('uses the 15-minute current block near "now" and the hourly series elsewhere', async () => {
    const { LiveWeather } = await import('../src/layers/weather/providers');
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify(fixture))) as typeof fetch;
    try {
      const live = new LiveWeather(22.57, 88.36);
      expect(live.sample(T * 1000).status).toBe('loading');
      live.start();
      await new Promise((r) => setTimeout(r, 10));
      live.stop();
      const now = live.sample((T + 900) * 1000);
      expect(now.status).toBe('ok');
      expect(now.precipitationMmH).toBeCloseTo(10, 9); // 2.5 mm in 15 min
      expect(now.cloudCover).toBeCloseTo(0.8, 9);
      const later = live.sample((T + 5400) * 1000);
      expect(later.precipitationMmH).toBe(1);
      expect(later.source).toContain('hourly');
      expect(live.sample((T + 99999) * 1000).status).toBe('loading'); // outside the series, no failure recorded
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('reports unavailable, with clear-sky values, when the request fails', async () => {
    const { LiveWeather } = await import('../src/layers/weather/providers');
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response('{}', { status: 429 })) as typeof fetch;
    const warn = console.warn;
    console.warn = () => {};
    try {
      const live = new LiveWeather(22.57, 88.36);
      live.start();
      await new Promise((r) => setTimeout(r, 10));
      live.stop();
      const s = live.sample(T * 1000);
      expect(s.status).toBe('unavailable');
      expect(s.precipitationMmH).toBe(0);
    } finally {
      globalThis.fetch = realFetch;
      console.warn = warn;
    }
  });
});
