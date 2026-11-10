# Data sources

Every real-world dataset used by the app is listed here with its licence. Anything not listed is either
derived from a listed source or an explicitly flagged synthetic placeholder.

## OpenStreetMap (buildings, roads, rail, water, green space)
- Source: Overpass API, queried offline by `tools/fetch-osm.ts`. Never called at runtime. The current extract
  came from the `maps.mail.ru` Overpass mirror because `overpass-api.de` was refusing connections; the
  endpoint and OSM base timestamp are recorded in `data/raw/osm.meta.json` and `public/data/city.meta.json`.
- Snapshot: OSM base timestamp 2026-11-10 (exact value in `public/data/city.meta.json`).
- Area: bbox in `config/study-area.json` (88.320–88.415 E, 22.535–22.610 N, about 9.8 x 8.4 km).
- Licence: ODbL 1.0. Attribution "© OpenStreetMap contributors" is shown permanently in the UI.
- `public/data/city.bin` is a derived database under ODbL; redistribute it under the same terms.

## Building heights
| Source | Count | Share | Rendering |
|---|---|---|---|
| `height` tag | 137 | 0.2% | warm wall tones, terracotta roof |
| Wikidata height (P2048) or floors (P1101) | 1 | 0.0% | warm wall tones, terracotta roof |
| `building:levels` x 3.2 m + 1.0 m | 1,094 | 1.5% | warm wall tones, terracotta roof |
| **Estimated (heuristic, not real data)** | 73,581 | 98.4% | greyer walls, cool grey roof |

Estimation heuristic (`tools/lib/heights.ts`): levels guessed from footprint area
(<40 m2: 1, <150: 2, <600: 3, <2500: 4, else 5; sheds, huts, garages etc.: 1), plus one extra level for a
deterministic third of buildings (hash of OSM id), times 3.2 m, plus 1.0 m. The 3.2 m storey height and
1.0 m allowance are assumptions, not surveyed values.

## Wikidata (landmark names and heights)
- Source: `Special:EntityData` for each OSM way/relation with a `wikidata` tag, fetched offline by
  `tools/fetch-wikidata.ts` into `data/wikidata.json` (64 items). Licence: CC0.
- Used for: English labels of the 53 landmarks in the label layer, and building heights where the item
  has a height (P2048) or floor count (P1101). Only 4 items carry a height and 2 a floor count, so this
  barely changes the skyline; Victoria Memorial, for example, has neither.
- OSM `height` tags take precedence over Wikidata.

## Facades (not data)
Window grids, storey lines and lit windows are a procedural shader pattern (3.2 m storeys, 3 m bays).
They are not imagery of the real buildings. The pale stone colour of landmark buildings is a highlight.

## Road and rail widths
Drawing widths per `highway`/`railway` class (`tools/build-city.ts`, `src/data/city.worker.ts`), overridden
by the OSM `width` tag where present. They are a rendering heuristic, not surveyed carriageway widths.

## Sun position
Computed with SunCalc 2.x (astronomical formulas, no dataset). All years use IST (UTC+05:30); the historical
Calcutta local mean time offset is not modelled (see `src/core/time/ist.ts`).

## Weather: Open-Meteo
- Live mode: `https://api.open-meteo.com/v1/forecast`, called from the browser (no key). Values are model
  analysis/forecast for the grid cell containing the study-area centre, not gauge readings.
- Event mode: `tools/fetch-scenarios.ts` downloads hourly series from the Open-Meteo Historical Weather
  API (`archive-api.open-meteo.com`, reanalysis) into `public/data/scenarios/`. Each file records its
  request URL, fetch time and grid cell. Reanalysis smooths local extremes, so peaks will be lower than
  gauge records for the same event.
- Licence: CC BY 4.0. "Weather data by Open-Meteo.com" with a licence link is shown in the UI.
  Open-Meteo's free tier is for non-commercial use; check their terms before any commercial deployment.

### Scenarios (config/scenarios.json)
| id | Window (IST) | Why this date | Reference |
|---|---|---|---|
| `amphan-2020` | 20 May 2020 00:00 to 21 May 12:00 | Cyclone Amphan made landfall on 20 May 2020; winds over 110 km/h reported at Alipore | Down To Earth (URL in config) |
| `downpour-2025-09` | 22 Sep 2025 12:00 to 23 Sep 18:00 | IMD press release, 23 Sep 2025: 251.4 mm in the 24 h to 08:30 IST, 98 mm between 03:00 and 04:00 IST | IMD press release, The Week (URLs in config) |

The figures in this table come from the cited reports and are context only; the app does not display
them as measurements. A scenario appears in the app only once its series has been downloaded.

## Rendering heuristics (not data)
Rain particle count, cloud dimming, exposure and haze density are perceptual mappings defined in
`src/core/environment/weather.ts` and `src/layers/sky/SunSkyLayer.ts`. Haze range is floored at 9 km.

## Synthetic placeholders
- `src/core/time/scenarios.ts` and `syntheticStorm` in `src/layers/weather/providers.ts`: "SYNTHETIC storm",
  a 24-hour artificial rain/cloud/wind curve (peak 60 mm/h at 15:00) for exercising the rendering.
  It represents no real event. Badged SYNTHETIC in the time bar and the weather panel.
- Terrain: none yet. The ground is a flat plane at 0 m until Phase 2.
