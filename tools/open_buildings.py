"""
Offline: crop Google's Open Buildings 2.5D Temporal height raster to the study area.

Run:  pip install -r tools/requirements.txt && python tools/open_buildings.py <area>   (after build-city once)
In:   public bucket gs://open-buildings-temporal-data (read over HTTPS, no account needed)
Out:  data/open-buildings/<area>/height_2m.u8.gz   uint8 grid, row 0 = north, value = height in 0.5 m steps
                                            (0 = no building detected or no data)
      data/open-buildings/<area>/meta.json         grid georeferencing, source tiles, licence

The source rasters are 0.5 m pixels in EPSG:32645 (the project's own UTM zone) with an effective
resolution of about 4 m, so they are averaged down to 2 m cells. A cell counts as building only where
the model's building_presence is at least PRESENCE_MIN. Heights in the source are capped at 100 m.
"""
import gzip
import json
import math
import pathlib
import subprocess
import sys

import numpy as np
import rasterio
from rasterio.windows import Window

ROOT = pathlib.Path(__file__).resolve().parent.parent
BUCKET = "https://storage.googleapis.com/open-buildings-temporal-data/v1"
EPOCH = "2023_06_30"  # latest annual snapshot in v1
S2_PARENT = "3b"  # level-2 S2 cell containing Kolkata; names the manifest
CELL = 2.0  # output cell size, metres
PRESENCE_MIN = 0.5
RAW = ROOT / "data" / "raw" / "open-buildings"
OUT = ROOT / "data" / "open-buildings"


def fetch(url: str, dest: pathlib.Path) -> None:
    if dest.exists() and dest.stat().st_size > 0:
        return
    dest.parent.mkdir(parents=True, exist_ok=True)
    print(f"  downloading {url}")
    subprocess.run(["curl", "-sS", "-L", "--fail", "--retry", "4", "-o", str(dest), url], check=True)


def main() -> None:
    area = next((a for a in sys.argv[1:] if not a.startswith("--")), None)
    if not area:
        sys.exit("Name an area, e.g. python tools/open_buildings.py college-street")
    global OUT
    OUT = OUT / area
    meta = json.loads((ROOT / "public" / "data" / area / "city.meta.json").read_text())
    if meta["utmZone"] != 45:
        sys.exit("This tool assumes UTM zone 45N (EPSG:32645), the CRS of the source tiles.")
    origin, extent = meta["origin"], meta["extent"]
    # Output grid: whole cells covering the study-area extent, anchored at its north-west corner.
    # It is snapped to whole multiples of the cell size so cells line up with the source pixels and
    # never straddle two source tiles (tile edges fall on even metres).
    west = math.floor((origin["utmE"] + extent["minX"]) / CELL) * CELL
    north = math.ceil((origin["utmN"] + extent["maxY"]) / CELL) * CELL
    cols = math.ceil((origin["utmE"] + extent["maxX"] - west) / CELL)
    rows = math.ceil((north - (origin["utmN"] + extent["minY"])) / CELL)
    east, south = west + cols * CELL, north - rows * CELL

    manifest_path = RAW / f"{S2_PARENT}_EPSG_32645_{EPOCH}.json"
    fetch(f"{BUCKET}/manifests/{manifest_path.name}", manifest_path)
    manifest = json.loads(manifest_path.read_text())
    bands = [b["id"] for b in manifest["bands"]]
    h_band, p_band = bands.index("building_height") + 1, bands.index("building_presence") + 1
    prefix = manifest["uriPrefix"].replace("gs://open-buildings-temporal-data/v1", BUCKET)

    height_sum = np.zeros((rows, cols), dtype=np.float32)
    weight = np.zeros((rows, cols), dtype=np.float32)
    used = []
    k = int(round(CELL / 0.5))
    for src in manifest["tilesets"][0]["sources"]:
        t, d = src["affineTransform"], src["dimensions"]
        if t["scaleX"] != 0.5 or t["scaleY"] != -0.5:
            sys.exit("Unexpected source pixel size")
        tx0, ty1 = t["translateX"], t["translateY"]
        tx1, ty0 = tx0 + d["width"] * 0.5, ty1 - d["height"] * 0.5
        if tx0 >= east or tx1 <= west or ty0 >= north or ty1 <= south:
            continue
        uri = src["uris"][0]
        local = RAW / uri.replace("/", "_")
        fetch(prefix + uri, local)
        used.append(uri)
        # Overlap of this tile with the output grid, in output cells (tile edges fall on whole metres).
        c0, c1 = max(0, math.ceil((tx0 - west) / CELL)), min(cols, math.floor((tx1 - west) / CELL))
        r0, r1 = max(0, math.ceil((north - ty1) / CELL)), min(rows, math.floor((north - ty0) / CELL))
        px0 = int(round((west + c0 * CELL - tx0) / 0.5))
        py0 = int(round((ty1 - (north - r0 * CELL)) / 0.5))
        window = Window(px0, py0, (c1 - c0) * k, (r1 - r0) * k)
        with rasterio.open(local) as ds:
            h = ds.read(h_band, window=window).astype(np.float32)
            p = ds.read(p_band, window=window).astype(np.float32)
        ok = (p >= PRESENCE_MIN) & (h > 0)
        h = np.where(ok, h, 0).reshape(r1 - r0, k, c1 - c0, k)
        n = ok.reshape(r1 - r0, k, c1 - c0, k).sum(axis=(1, 3)).astype(np.float32)
        height_sum[r0:r1, c0:c1] += h.sum(axis=(1, 3))
        weight[r0:r1, c0:c1] += n
        print(f"  {uri}: rows {r0}-{r1}, cols {c0}-{c1}")

    # A 2 m cell is building where at least half of its 0.5 m pixels are; its height is their mean.
    mean = np.divide(height_sum, weight, out=np.zeros_like(height_sum), where=weight > 0)
    grid = np.where(weight >= (k * k) / 2, np.clip(np.rint(mean * 2), 1, 255), 0).astype(np.uint8)

    OUT.mkdir(parents=True, exist_ok=True)
    with gzip.open(OUT / "height_2m.u8.gz", "wb", compresslevel=9) as f:
        f.write(grid.tobytes())
    (OUT / "meta.json").write_text(json.dumps({
        "source": "Google Open Buildings 2.5D Temporal v1",
        "licence": "CC BY 4.0 (also offered under ODbL 1.0)",
        "epoch": EPOCH,
        "tiles": used,
        "crs": "EPSG:32645",
        "cellMetres": CELL,
        "cols": cols, "rows": rows,
        "westUtm": west, "northUtm": north,
        "valueUnitMetres": 0.5,
        "presenceThreshold": PRESENCE_MIN,
        "note": "0 = no building detected. Source heights are model estimates capped at 100 m.",
    }, indent=2) + "\n")
    built = grid > 0
    print(f"grid {cols} x {rows}; {built.mean() * 100:.1f}% of cells are building; "
          f"median {np.median(grid[built]) / 2:.1f} m, p95 {np.percentile(grid[built], 95) / 2:.1f} m, max {grid.max() / 2:.1f} m")


if __name__ == "__main__":
    main()
