# Data sources

Every real-world dataset used by the app is listed here with its licence. Anything not listed is either
derived from a listed source or an explicitly flagged synthetic placeholder.

## OpenStreetMap (buildings, roads, rail, water, green space)
- Source: Overpass API, queried offline by `tools/fetch-osm.ts`. Never called at runtime. The current extract
  came from the `maps.mail.ru` Overpass mirror because `overpass-api.de` was refusing connections; the
  endpoint and OSM base timestamp are recorded in `data/raw/osm.meta.json` and `public/data/city.meta.json`.
- Snapshot: OSM base timestamp 2026-11-10 (exact value in `public/data/city.meta.json`).
- Areas: the bounding boxes in `config/areas.json`. The two neighbourhood areas were fetched on 12 Nov 2026.
- Licence: ODbL 1.0. Attribution "© OpenStreetMap contributors" is shown permanently in the UI.
- `public/data/city.bin` is a derived database under ODbL; redistribute it under the same terms.

## Building heights
| Source | Count | Share | Rendering |
|---|---|---|---|
| OSM `height` tag | 137 | 0.2% | warm wall tones, terracotta roof |
| Wikidata height (P2048) | 1 | 0.0% | warm wall tones, terracotta roof |
| Google Open Buildings 2.5D Temporal (modelled) | 63,938 | 85.5% | warm wall tones, terracotta roof |
| OSM `building:levels` x 3.2 m + 1.0 m | 128 | 0.2% | warm wall tones, terracotta roof |
| **Estimated (heuristic, not real data)** | 10,609 | 14.2% | greyer walls, cool grey roof |

Priority is the table order (`tools/lib/heights.ts`), except that tagged levels implying more than 90 m
beat the modelled height, because the Open Buildings raster saturates at 100 m.

### Google Open Buildings 2.5D Temporal v1
- Source: public bucket `gs://open-buildings-temporal-data/v1` (tiles `3a024_2023_06_30/tile_Rzy3kb7_Y2U.tif`
  and `tile_qO3pu8BiVlU.tif`), read by `tools/open_buildings.py`. Epoch: 30 June 2023.
- Licence: CC BY 4.0 (also offered under ODbL 1.0). Attribution is shown in the UI footer.
- Processing: 0.5 m source pixels averaged to a 2 m grid (`data/open-buildings/height_2m.u8.gz`), keeping
  cells where `building_presence` >= 0.5. A footprint takes the 75th percentile of its building cells,
  and only if at least 40% of its cells are building (`tools/lib/openBuildings.ts`).
- Accuracy: Google's blog reports 1.5 m mean absolute error; this is not validated for Kolkata and is a
  model estimate from Sentinel-2 imagery, not a survey. Heights are capped at 100 m, and one value is
  applied per footprint, so domes, spires and stepped massing are flattened.

Estimation heuristic for the remainder (`tools/lib/heights.ts`): levels guessed from footprint area
(<40 m2: 1, <150: 2, <600: 3, <2500: 4, else 5; sheds, huts, garages etc.: 1), plus one extra level for a
deterministic third of buildings (hash of OSM id), times 3.2 m, plus 1.0 m. The 3.2 m storey height and
1.0 m allowance are assumptions, not surveyed values.

## Trees: Meta / WRI High Resolution Canopy Height Maps
- Source: public bucket `dataforgood-fb-data` (`forests/v1/alsgedi_global_v6_float/chm/123133323.tif`),
  read by `tools/canopy.py`. Licence: CC BY 4.0. A model estimate of canopy height at about 1 m
  resolution from satellite imagery; not a survey and not a tree census.
- Kolkata has no public tree census (KMC has announced a digital tree map; no dataset was found), and
  OpenStreetMap has only a few hundred mapped trees here, so canopy height is the only sourced basis.
- What is data: where canopy stands and how tall it is.
- What is NOT data: the split into individual trees (one per local height maximum of at least 3 m,
  spaced by height), the crown radius (assumed 0.28 x height + 1 m), tree shape and leaf colour.
  Species is unknown. Tree counts are therefore plausible, not real: 914 in College Street to
  Jorasanko and 4,555 in Gariahat and Rabindra Sarobar, after dropping 243 and 608 that fell inside
  building footprints. Heights are capped at 30 m.
- Not validated on the ground for Kolkata.

## Wikidata (landmark names, facts, heights)
- Source: `Special:EntityData` for each OSM element with a `wikidata` tag (176 items), fetched offline by
  `tools/fetch-wikidata.ts` into `data/wikidata.json`. Licence: CC0.
- Used for: English labels, one-line descriptions and inception years in pop-ups, and building heights
  where an item has one (6 items) or a floor count (3). OSM `height` tags take precedence.

## Wikipedia and Wikimedia Commons (landmark pop-ups)
- Text: the first paragraph of the English Wikipedia article, shortened, for 134 landmarks
  (`tools/fetch-landmark-content.ts`, `tools/lib/wikitext.ts`). Licence: CC BY-SA 4.0. Each pop-up links
  to the article and states the licence and that the text is shortened. Paragraphs that cannot be
  cleaned of markup are dropped, not shown half-cleaned.
- Photos: the Wikidata main image (P18) for 119 landmarks, hot-linked from Wikimedia Commons, used only
  when the file page carries a recognised licence template. Author and licence are stored in
  `public/data/landmark-content.json` and shown under the photo with a link to the file page.
  Licences present: CC BY-SA 2.0/3.0/4.0, CC BY 2.0, GFDL, CC0 and public domain.

## Landmark models
`config/landmark-models.json` lists, per model, the sourced dimensions, the Wikipedia article they come
from, and which parts are schematic. Position and orientation come from OSM geometry.
| Model | Sourced | Schematic |
|---|---|---|
| Howrah Bridge | span 457.2 m, length 705 m, towers 85.3 m, arm and suspended-span lengths, deck width, 8.8 m clearance | truss panel layout, chord depths, member sizes, colour |
| Victoria Memorial | total height 56.1 m, chamber diameter 19.5 m, 4.9 m figure | drum/dome proportions, corner cupolas, body height |
| Shaheed Minar | height 48 m | base, shaft taper, balconies |
| St Paul's Cathedral | spire 61.3 m, nave width 24.7 m | tower footprint and position, pinnacles |
Vidyasagar Setu is not modelled: its main span could not be identified reliably in the OSM extract.

## Simulated and synthetic layers (not data)
- Traffic and trams: vehicle counts, mix, colours, speeds, routes and the hour-of-day activity curve are
  invented (`src/layers/traffic`). Only the road and tram-track centre lines are real (OSM).
- River boats: vessel types, counts and speeds are invented; lanes follow OSM river centre lines where
  they lie on mapped water.
- Festival lights: lamp strings on every main street. No Durga Puja or pandal location data is used.

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
- Licence: CC BY 4.0. "Weather data by Open-Meteo.com" with a licence link is shown in the UI.
  Open-Meteo's free tier is for non-commercial use; check their terms before any commercial deployment.

## Rendering heuristics (not data)
Rain particle count, cloud dimming, exposure and haze density are perceptual mappings defined in
`src/core/environment/weather.ts` and `src/layers/sky/SunSkyLayer.ts`. Haze range is floored at 9 km.

## Placeholders
- Terrain: none yet. The ground is a flat plane at 0 m until Phase 2.

## Painted map (generated; pilot area in the app)
Made by `tools/pixelmap/` after flash1405/isometric-mumbai and cannoneyed/isometric-nyc (both MIT).
- **Google Photorealistic 3D Tiles** (Map Tiles API, owner's own key), rendered top-down as ground and
  roof imagery. Google's Map Tiles API policies restrict caching, offline use and machine interpretation
  of the imagery. Using it as the source for a stored, model-redrawn map, and committing the painted
  tiles to this repository, was the project owner's explicit decision (11 Nov 2026) after that conflict
  was pointed out; it is an exception to this project's licence rule and the risk sits with the owner's
  Google account. The raw imagery is not in the repository. Google and its data providers are credited
  in the viewer from `public/data/pixelmap/pilot/meta.json`.
- **Buildings**: our OSM footprints with heights as described above.
- **Painter**: FLUX.2 [klein] 4B (Apache 2.0) with the Isometric Mumbai LoRA by Flash1405 (Apache 2.0;
  its training targets were made with an OpenAI image model, see its model card). The prompt adds a
  request for empty roads and water.
- **Compute**: Kaggle Notebooks free GPUs on the owner's account (49 tiles, about 22 minutes).
- **Water**: repainted in one colour from OSM water polygons; nothing else is retouched.
- **It is not data.** A generative model drew every building and street; facades, domes, roof colours,
  trees and any remaining painted cars may be invented, and the style was learned from Mumbai.
  The viewer says so in its credit line and in the view note.
- **Vehicles and boats on it** are the same simulated fleet as in the 3D view, drawn as sprites.
