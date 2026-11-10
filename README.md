# Kolkata through time

Browser-based 3D model of central Kolkata on a single shared time axis: live present, historical years,
event replays. Vite + strict TypeScript + plain three.js (WebGL2).

## Run
```bash
npm install
npm run dev          # http://localhost:5173  (add ?quality=mobile to force the phone tier)
npm test             # projection, sun-vector and TimeController tests
npm run build        # typecheck + production bundle in dist/
npm run data         # optional: re-fetch OSM and rebuild public/data/city.bin
```
`public/data/city.bin` is checked in, so the app runs without the data step.

## Architecture
```
config/study-area.json      bbox, UTM zone, tile size (grow the study area here)
config/landmark-models.json sourced dimensions for the procedural landmark models
tools/                      offline pipeline (Node, tsx); never runs in the browser
  fetch-osm.ts              Overpass (tiled, with retries) -> data/raw/osm.json
  open_buildings.py         Google Open Buildings 2.5D height tiles -> data/open-buildings/ (Python, rasterio)
  fetch-poi.ts              Overpass: Wikidata-tagged places, monuments, museums -> data/raw/poi.json
  fetch-wikidata.ts         Wikidata labels, heights, article titles, images -> data/wikidata.json
  fetch-landmark-content.ts Wikipedia intros + Commons photo credits -> public/data/landmark-content.json
  build-city.ts             project, clip, resolve heights -> public/data/city.bin
  lib/heights.ts, clip.ts
data/SOURCES.md             every dataset, licence and heuristic
src/
  shared/                   projection (WGS84 -> UTM 45N -> local metres), binary format, sun maths, config
  core/time/                TimeController, TimeState/TimeEvents types, IST calendar
  core/layers/              Layer interface, LayerRegistry
  core/environment/         shared weather/daylight state, series sampling, rain and haze mappings
  data/                     CityData (main thread), city.worker.ts, geometry builders
  layers/<id>/              one folder per layer: weather, sky, buildings, models, landmarks, traffic, boats, festival, roads, rail, water, green, ground
  app/                      App (renderer, camera, loop), quality tiers
  ui/                       TimeBar, LayerPanel, SearchBox, LandmarkPopup, ViewSwitch, WeatherPanel, StatsHud
tests/
```

### Time
`TimeController` is the only clock. `App` calls `advance(dt)` once per frame; layers get an immutable
`TimeState` in `update(time, dt)` and may subscribe to typed events
(`tick`, `modechange`, `yearchange`, `seek`, `playstate`, `scenariochange`, `scenarioend`).
`TimeState.epoch` increments on every discontinuity so stateful simulations (Phase 2 water) know to reset;
`simDeltaSeconds` is the simulated time step.

| Mode | Clock | Controls |
|---|---|---|
| live | wall clock | none (speed, pause, scrub ignored) |
| historical | free-running inside 1873..now | year, date, time of day, speed, pause |
| event | confined to a stored `Scenario` window; pauses at the end | scenario, progress, time of day, speed, pause |

### Layers
`Layer = { id, label, load(ctx), update(time, dt), setVisible(v), dispose() }`, owned by `LayerRegistry`.
`LayerContext` provides scene, camera, renderer, time, local frame, shared city data, quality tier, camera
focus and `requestShadowUpdate()`.

### Coordinates
WGS84 -> UTM 45N (own implementation, tested against proj4 to < 1 mm) -> minus the projected bbox centre.
Local frame: x east, y north (grid). Scene: X = x, Y = up, Z = -y. Sun bearings are corrected for grid
convergence (about 0.5 degrees here).

### Data pipeline
Overpass (offline) -> raw JSON -> `build-city.ts` -> `city.bin` (2 MB: footprint rings, polylines,
heights, height source, road class/width/name/OSM id) -> web worker triangulates and extrudes ->
typed arrays transferred to the main thread -> merged meshes.

### Rendering
- Buildings: one merged mesh per 1 km tile (48 tiles), frustum-culled, vertex colours.
- Facades: a procedural window grid and storey lines in the building fragment shader (no textures, no
  extra draw calls), with lit windows at night. Generic pattern, not imagery of real buildings.
- Landmark labels: HTML labels for the 53 OSM features that carry a Wikidata item, de-cluttered per frame.
- Roads, rail, water, green: one merged mesh each. They do not write depth and draw in a fixed order
  after the ground, which removes z-fighting on a flat city.
- Shadows: one directional shadow map around the camera focus, texel-snapped, re-rendered only when
  the sun or focus moves (`shadowMap.autoUpdate = false`).

### Isometric pixel view
A second view mode, modelled on the camera and presentation in Yadong Xie's "How Isometric Pixel City Was
Made": one orthographic camera pointed 15 degrees west of north and tilted 45 degrees down, pan and zoom
only, rendered through three.js `RenderPixelatedPass` (low-resolution render with normal/depth edge
lines, nearest-neighbour upscale) with tilt-shift blur bands at the top and bottom of the page.
It draws the same OSM-derived scene as the 3D view; no generative model is involved. Layers read the
active camera from `ctx.camera` each frame and the view state from `ctx.view`.

What is not adopted from the article: its source imagery (Google Photorealistic 3D Tiles) and the
image-model redraw. See "Decisions" in the phase report.

### Weather (Phase 1)
`WeatherLayer` fetches live conditions and publishes a `WeatherState` on `ctx.environment.weather` every frame;
it is registered first so later layers see the current frame's conditions.

| Mode | Source |
|---|---|
| live | Open-Meteo forecast API: 15-minute `current` block near now, hourly series otherwise; refreshed every 10 min |
| custom time | none: clear sky, stated in the UI |

- Rain: GPU-instanced streaks in a 90 m cube that follows the camera; motion is entirely in the vertex
  shader. Instance count = budget x sqrt(mm/h / 50), capped at 1 (budget 14,000 desktop, 5,000 phone).
- Cloud cover: `SunSkyLayer` dims direct sun by `1 - 0.9 c^2`, greys and dims the ambient fill, lowers
  exposure, and drives the sky dome's cloud deck.
- Haze: `FogExp2` density from humidity and rain (`hazeDensity`). The visual range is floored at 9 km
  on purpose so the city stays readable from the overview in a downpour.
- Hourly precipitation is sampled as a step function (total of the preceding hour), so integrating the
  rate reproduces the source totals. Phase 2 reads the same value as its rainfall input.
- These mappings are rendering heuristics, not radiometry (`src/core/environment/weather.ts`).

### Landmarks, search and pop-ups
- `LandmarksLayer`: clickable labels for 149 places that have a Wikidata item in OSM.
- `LandmarkPopup`: opening paragraph of the English Wikipedia article and the Wikidata main image from
  Wikimedia Commons, each shown with licence, author and a link (`tools/fetch-landmark-content.ts`).
- `SearchBox`: type-ahead over landmark and street names (no address geocoding); `App.flyTo` moves the
  camera and pulses a ring at the destination.
- `LandmarkModelsLayer`: procedural models for Howrah Bridge, Victoria Memorial, Shaheed Minar and
  St Paul's Cathedral. Overall dimensions are sourced per model in `config/landmark-models.json`; the
  `schematic` field there lists what is not sourced.

### Simulated decoration (not data)
- `TrafficLayer`: instanced box vehicles on OSM main-road centre lines (keeping left) and trams on OSM
  tram track, joined into a network at shared end points. No traffic, timetable or signal data.
- `BoatsLayer`: boats on lanes derived from OSM river centre lines, kept to mapped water.
- `FestivalLightsLayer` (off by default): lamp strings along main streets. Not pandal locations.
All three are labelled simulated or synthetic in the layer list and run in real time, pausing with the clock.

### Time modes in the UI
Live (wall clock, live weather) and Custom time (any date and time of day; sun only). There is no year
slider, because the project has no dated city content, and no storm replay: stored storm scenarios were
removed. `TimeController` keeps its historical-year and event-replay support (covered by tests) so a
future events feature can register scenarios; the event button appears only when one is registered.

## Planned phases (not built)
## Planned phases (not built)
- **P2 Waterlogging** `layers/flood`: terrain grid (DEM prior + calibration file of hotspots/depressions),
  ping-pong render-target height-field solver stepped by `simDeltaSeconds`, reset on `epoch` change;
  rain source from P1, drainage sink scaled by a `TideProvider`; depth overlay plus per-street status
  using the road ids/names already in `city.bin`.
- **P3 Ghost trams** `layers/trams`: route segments with `opened`/`closed` years filtered by `TimeState.year`;
  InstancedMesh cars moving along active routes.
- **P4 Heritage** `layers/heritage`: grade records `{ osmId|wikidata, grade, asOf, source }`, joined to
  building footprints; grade colouring and an interventions panel.
- **P5 Soundscape** `layers/sound`: PositionalAudio emitters keyed by zone and hour; manifest with licence
  and attribution per clip.
- **P6 Durga Puja** `layers/puja`: pandal points, agents on the walkable road graph from Metro exits,
  queue heatmap; runs as an event-mode scenario.
- **P7 1910s Calcutta** `layers/oldmaps`: georeferenced map tiles reprojected offline to the local frame
  and draped on the terrain; visible for the matching years.
