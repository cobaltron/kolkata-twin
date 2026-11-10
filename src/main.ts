import './ui/ui.css';
import { App } from './app/App';
import { BuildingsLayer } from './layers/buildings/BuildingsLayer';
import { createGreenLayer } from './layers/green/GreenLayer';
import { LandmarksLayer } from './layers/landmarks/LandmarksLayer';
import { LandmarkModelsLayer } from './layers/models/LandmarkModelsLayer';
import { GroundLayer } from './layers/ground/GroundLayer';
import { createRailLayer } from './layers/rail/RailLayer';
import { createRoadsLayer } from './layers/roads/RoadsLayer';
import { SunSkyLayer } from './layers/sky/SunSkyLayer';
import { createWaterLayer } from './layers/water/WaterLayer';
import { TrafficLayer } from './layers/traffic/TrafficLayer';
import { BoatsLayer } from './layers/boats/BoatsLayer';
import { FestivalLightsLayer } from './layers/festival/FestivalLightsLayer';
import { WeatherLayer } from './layers/weather/WeatherLayer';
import { WeatherPanel } from './ui/WeatherPanel';
import { ViewSwitch } from './ui/ViewSwitch';
import { LandmarkPopup } from './ui/LandmarkPopup';
import { SearchBox, type SearchEntry } from './ui/SearchBox';
import { LayerPanel } from './ui/LayerPanel';
import { StatsHud } from './ui/StatsHud';
import { TimeBar } from './ui/TimeBar';

const byId = (id: string): HTMLElement => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`#${id} missing from index.html`);
  return node;
};

const app = new App(byId('viewport'));
// Registration order is the update order and the order of the toggles in the UI.
// Weather runs first so the sky layer sees this frame's conditions.
const landmarkLabels = new LandmarksLayer();
for (const layer of [new WeatherLayer(), new SunSkyLayer(), new BuildingsLayer(), new LandmarkModelsLayer(), landmarkLabels, new TrafficLayer(), new BoatsLayer(), new FestivalLightsLayer(), createRoadsLayer(), createRailLayer(), createWaterLayer(), createGreenLayer(), new GroundLayer()]) {
  app.layers.register(layer);
}

const panel = new LayerPanel(byId('side'), app.layers);
new TimeBar(byId('timebar'), app.time);
new StatsHud(byId('hud'), app);
new WeatherPanel(panel.weatherSection, app.environment);
new ViewSwitch(panel.viewSection, app);

const popup = new LandmarkPopup(byId('popup'));
const search = new SearchBox(panel.searchSection, (entry: SearchEntry) => {
  app.flyTo(entry.x, entry.y, entry.kind === 'street' ? 450 : 650);
  if (entry.landmark) void popup.open(entry.landmark);
  else popup.close();
});
landmarkLabels.onSelect = (landmark) => {
  app.flyTo(landmark.x, landmark.y);
  void popup.open(landmark);
};

app.start();
void app.layers.loadAll();
app.cityData.load().then(
  (city) => {
    panel.showCityInfo(city.header);
    search.setEntries([
      ...city.header.landmarks.map((l): SearchEntry => ({ name: l.name, kind: 'landmark', x: l.x, y: l.y, landmark: l })),
      ...city.streets.map((s): SearchEntry => ({ ...s, kind: 'street' })),
    ]);
  },
  (err: unknown) => {
    byId('hud').textContent = `Failed to load city data: ${err instanceof Error ? err.message : String(err)}`;
  },
);

// Handle for debugging and automated performance capture.
(window as unknown as { __app: App }).__app = app;
