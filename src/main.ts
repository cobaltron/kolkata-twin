import './ui/ui.css';
import { App } from './app/App';
import { BuildingsLayer } from './layers/buildings/BuildingsLayer';
import { createGreenLayer } from './layers/green/GreenLayer';
import { LandmarksLayer } from './layers/landmarks/LandmarksLayer';
import { GroundLayer } from './layers/ground/GroundLayer';
import { createRailLayer } from './layers/rail/RailLayer';
import { createRoadsLayer } from './layers/roads/RoadsLayer';
import { SunSkyLayer } from './layers/sky/SunSkyLayer';
import { createWaterLayer } from './layers/water/WaterLayer';
import { WeatherLayer } from './layers/weather/WeatherLayer';
import { loadScenarios } from './core/time/scenarios';
import { WeatherPanel } from './ui/WeatherPanel';
import { ViewSwitch } from './ui/ViewSwitch';
import { LayerPanel } from './ui/LayerPanel';
import { StatsHud } from './ui/StatsHud';
import { TimeBar } from './ui/TimeBar';

const byId = (id: string): HTMLElement => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`#${id} missing from index.html`);
  return node;
};

const app = new App(byId('viewport'), await loadScenarios());
// Registration order is the update order and the order of the toggles in the UI.
// Weather runs first so the sky layer sees this frame's conditions.
for (const layer of [new WeatherLayer(), new SunSkyLayer(), new BuildingsLayer(), new LandmarksLayer(), createRoadsLayer(), createRailLayer(), createWaterLayer(), createGreenLayer(), new GroundLayer()]) {
  app.layers.register(layer);
}

const panel = new LayerPanel(byId('side'), app.layers);
new TimeBar(byId('timebar'), app.time);
new StatsHud(byId('hud'), app);
new WeatherPanel(panel.weatherSection, app.environment);
new ViewSwitch(panel.viewSection, app);

app.start();
void app.layers.loadAll();
app.cityData.load().then(
  (city) => panel.showCityInfo(city.header),
  (err: unknown) => {
    byId('hud').textContent = `Failed to load city data: ${err instanceof Error ? err.message : String(err)}`;
  },
);

// Handle for debugging and automated performance capture.
(window as unknown as { __app: App }).__app = app;
