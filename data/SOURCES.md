# Data sources

Every real-world dataset used by the app is listed here with its licence. Anything not listed is either
derived from a listed source or an explicitly flagged synthetic placeholder.

## OpenStreetMap (buildings, roads, rail, water, green space)
- Source: Overpass API (`overpass-api.de`), queried offline by `tools/fetch-osm.ts`. Never called at runtime.
- Snapshot: OSM base timestamp 2026-11-10 (exact value in `public/data/city.meta.json`).
- Area: bbox in `config/study-area.json` (88.320–88.375 E, 22.535–22.590 N).
- Licence: ODbL 1.0. Attribution "© OpenStreetMap contributors" is shown permanently in the UI.
- `public/data/city.bin` is a derived database under ODbL; redistribute it under the same terms.

## Building heights
| Source | Count | Share | Rendering |
|---|---|---|---|
| `height` tag | 128 | 0.4% | warm wall tones, terracotta roof |
| `building:levels` x 3.2 m + 1.0 m | 118 | 0.4% | warm wall tones, terracotta roof |
| **Estimated (heuristic, not real data)** | 29,448 | 99.2% | greyer walls, cool grey roof |

Estimation heuristic (`tools/lib/heights.ts`): levels guessed from footprint area
(<40 m2: 1, <150: 2, <600: 3, <2500: 4, else 5; sheds, huts, garages etc.: 1), plus one extra level for a
deterministic third of buildings (hash of OSM id), times 3.2 m, plus 1.0 m. The 3.2 m storey height and
1.0 m allowance are assumptions, not surveyed values.

## Road and rail widths
Drawing widths per `highway`/`railway` class (`tools/build-city.ts`, `src/data/city.worker.ts`), overridden
by the OSM `width` tag where present. They are a rendering heuristic, not surveyed carriageway widths.

## Sun position
Computed with SunCalc 2.x (astronomical formulas, no dataset). All years use IST (UTC+05:30); the historical
Calcutta local mean time offset is not modelled (see `src/core/time/ist.ts`).

## Synthetic placeholders
- `src/core/time/scenarios.ts`: "SYNTHETIC placeholder: 24 h test window". A bare time window to exercise
  event-mode playback. No real event data. Badged SYNTHETIC in the UI.
- Terrain: none yet. The ground is a flat plane at 0 m until Phase 2.
