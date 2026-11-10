import { Color, FogExp2 } from 'three';
import type { Layer, LayerContext } from '../../core/layers/Layer';
import type { TimeState } from '../../core/time/types';
import { clearState, hazeDensity, rainParticleFraction, type WeatherState } from '../../core/environment/weather';
import { LiveWeather, ScenarioWeather } from './providers';
import { RainParticles } from './RainParticles';

const FOG_DAY = new Color(0xc4cfd9);
const FOG_OVERCAST = new Color(0xa3aab0);
const FOG_NIGHT = new Color(0x0a0e18);

/**
 * Weather: owns the data (live Open-Meteo, stored scenario series) and publishes it on
 * ctx.environment.weather; renders rain particles and humidity/rain haze (fog).
 * Cloud cover is rendered by SunSkyLayer, which reads the published state.
 *
 *   live       -> Open-Meteo current + hourly
 *   event      -> stored hourly series of the active scenario (or the flagged synthetic storm)
 *   historical -> no data: clear sky, stated in the UI
 */
export class WeatherLayer implements Layer {
  readonly id = 'weather';
  readonly label = 'Weather (rain, haze, cloud)';
  private ctx: LayerContext | null = null;
  private live: LiveWeather | null = null;
  private readonly scenarios = new ScenarioWeather();
  private rain: RainParticles | null = null;
  private readonly fog = new FogExp2(0xc4cfd9, 0);
  private readonly fogTarget = new Color();
  // Smoothed values actually rendered, so hourly steps do not pop.
  private rainRate = 0;
  private density = 0;
  private lastEpoch = -1;

  async load(ctx: LayerContext): Promise<void> {
    this.ctx = ctx;
    const { lat, lon } = ctx.frame.originLonLat;
    this.live = new LiveWeather(lat, lon);
    this.live.start();
    this.rain = new RainParticles(ctx.quality.maxRainDrops);
    ctx.scene.add(this.rain.mesh);
    ctx.scene.fog = this.fog;
  }

  private resolve(time: TimeState): WeatherState {
    if (time.mode === 'live') return this.live!.sample(time.instant);
    if (time.mode === 'event' && time.scenario) return this.scenarios.sample(time.scenario, time.instant);
    return clearState('none', 'No weather data in historical mode; clear sky shown');
  }

  update(time: TimeState, dt: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.rain) return;
    const weather = this.resolve(time);
    ctx.environment.weather = weather;

    // Ease towards the target; snap after a scrub or mode change.
    const snap = time.epoch !== this.lastEpoch;
    this.lastEpoch = time.epoch;
    const k = snap ? 1 : 1 - Math.exp(-dt * 1.5);
    this.rainRate += (weather.precipitationMmH - this.rainRate) * k;
    this.density += (hazeDensity(weather.humidity, weather.precipitationMmH) - this.density) * k;

    const daylight = ctx.environment.daylight;
    this.fog.density = this.density;
    this.fogTarget.lerpColors(FOG_DAY, FOG_OVERCAST, weather.cloudCover).lerp(FOG_NIGHT, 1 - daylight);
    this.fog.color.lerp(this.fogTarget, k);

    // Wind: meteorological "from" bearing -> scene velocity (X east, Z south), grid-north corrected.
    const to = ((weather.windFromDeg + 180) * Math.PI) / 180 - ctx.frame.convergence;
    const speed = Math.min(weather.windSpeedMs, 15);
    // Rain animates in real time regardless of playback speed (9 m/s at 3600x would be noise); it freezes when paused.
    const rainDt = time.paused ? 0 : dt;
    this.rain.update(rainDt, rainParticleFraction(this.rainRate), ctx.camera.position, { x: Math.sin(to) * speed, z: -Math.cos(to) * speed }, daylight);
  }

  setVisible(visible: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !this.rain) return;
    ctx.scene.fog = visible ? this.fog : null;
    if (!visible) {
      this.rain.mesh.visible = false;
      ctx.environment.weather = clearState('none', 'Weather layer is off');
    }
  }

  dispose(): void {
    this.live?.stop();
    if (this.ctx && this.rain) {
      this.ctx.scene.remove(this.rain.mesh);
      if (this.ctx.scene.fog === this.fog) this.ctx.scene.fog = null;
    }
    this.rain?.dispose();
  }
}
