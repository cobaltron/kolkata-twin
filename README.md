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
tools/                      offline pipeline (Node, tsx); never runs in the browser
  fetch-osm.ts              Overpass -> data/raw/osm.json
  build-city.ts             project, clip, resolve heights -> public/data/city.bin
  lib/heights.ts, clip.ts
data/SOURCES.md             every dataset, licence and heuristic
src/
  shared/                   projection (WGS84 -> UTM 45N -> local metres), binary format, sun maths, config
  core/time/                TimeController, TimeState/TimeEvents types, IST calendar, scenarios
  core/layers/              Layer interface, LayerRegistry
  data/                     CityData (main thread), city.worker.ts, geometry builders
  layers/<id>/              one folder per layer: sky, buildings, roads, rail, water, green, ground
  app/                      App (renderer, camera, loop), quality tiers
  ui/                       TimeBar, LayerPanel, StatsHud
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
- Roads, rail, water, green: one merged mesh each. They do not write depth and draw in a fixed order
  after the ground, which removes z-fighting on a flat city.
- Shadows: one directional shadow map around the camera focus, texel-snapped, re-rendered only when
  the sun or focus moves (`shadowMap.autoUpdate = false`).

## Planned phases (not built)
- **P1 Weather** `layers/weather`: Open-Meteo client behind a `WeatherProvider` (live fetch / stored hourly
  series for scenarios). Publishes a `WeatherState` (rain mm/h, cloud cover, humidity) that rain particles
  (InstancedMesh or points in a camera-following volume), sky and fog consume.
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
