#!/usr/bin/env bash
# Build every data file the app needs for one area. Usage: npm run data:area -- <area-id>
# Needs network access (Overpass, Google's and Meta's public buckets, Wikidata, Wikipedia) and,
# for the Python steps, `pip install -r tools/requirements.txt`.
set -euo pipefail
area="${1:?name an area from config/areas.json}"
cd "$(dirname "$0")/.."
npx tsx tools/fetch-osm.ts "$area"          # OpenStreetMap extract
npx tsx tools/fetch-poi.ts "$area"          # named places
npx tsx tools/build-city.ts "$area"         # first pass: fixes the area's frame for the raster steps
python3 tools/open_buildings.py "$area"     # modelled building heights
python3 tools/canopy.py "$area"             # trees from the canopy-height map
npx tsx tools/fetch-wikidata.ts             # labels and facts for tagged places (all areas)
npx tsx tools/build-city.ts "$area"         # final pass, with heights, trees and labels
npx tsx tools/fetch-landmark-content.ts     # pop-up text and photo credits (all areas)
