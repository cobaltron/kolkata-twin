"""
Offline: place trees from the Meta / WRI global canopy-height map (1 m, CC BY 4.0).

Run:  python tools/canopy.py <area>      (after build-city has run once for the area)
In:   https://dataforgood-fb-data.s3.amazonaws.com/forests/v1/alsgedi_global_v6_float/chm/<tile>.tif
      (public; the ~500 MB tile is cached in data/canopy/raw/, git-ignored)
Out:  data/canopy/<area>/trees.json   {"trees": [[x, y, height, crownRadius], ...], ...} in the area's local metres

What is data and what is not:
  - WHERE canopy stands and HOW TALL it is come from the canopy-height map, a model estimate from
    satellite imagery (not a survey, not a tree census).
  - Splitting canopy into individual trees is this script's approximation: one tree per local height
    maximum, spaced according to height. A continuous row of crowns becomes a plausible number of
    trees, not the real count.
  - Crown radius is an assumed proportion of height. Species is unknown.
"""
import json
import math
import pathlib
import subprocess
import sys

import numpy as np
import rasterio
from rasterio.warp import transform
from rasterio.windows import from_bounds

ROOT = pathlib.Path(__file__).resolve().parent.parent
BUCKET = "https://dataforgood-fb-data.s3.amazonaws.com/forests/v1/alsgedi_global_v6_float"
RAW = ROOT / "data" / "canopy" / "raw"
MIN_HEIGHT_M = 3.0      # below this it is shrub or noise
MAX_TREES_PER_KM2 = 9000


def fetch(url: str, dest: pathlib.Path) -> None:
    if dest.exists() and dest.stat().st_size > 0:
        return
    dest.parent.mkdir(parents=True, exist_ok=True)
    print(f"  downloading {url}")
    subprocess.run(["curl", "-sS", "-L", "--fail", "--retry", "4", "-o", str(dest), url], check=True)


def local_maxima(h: np.ndarray, reach: int) -> np.ndarray:
    """True where a pixel equals the maximum of its (2*reach+1)^2 neighbourhood."""
    best = h.copy()
    for dy in range(-reach, reach + 1):
        for dx in range(-reach, reach + 1):
            if dx == 0 and dy == 0:
                continue
            shifted = np.roll(np.roll(h, dy, axis=0), dx, axis=1)
            np.maximum(best, shifted, out=best)
    return h >= best


def main() -> None:
    area = next((a for a in sys.argv[1:] if not a.startswith("--")), None)
    if not area:
        sys.exit("Name an area, e.g. python tools/canopy.py college-street")
    meta = json.loads((ROOT / "public" / "data" / area / "city.meta.json").read_text())
    cfg = json.loads((ROOT / "config" / "areas.json").read_text())[area]
    b = cfg["bbox"]

    # Which canopy tile(s) cover the area: the index lists each tile's footprint in lon/lat.
    fetch(f"{BUCKET}/tiles.geojson", RAW / "tiles.geojson")
    tiles = []
    for f in json.loads((RAW / "tiles.geojson").read_text())["features"]:
        ring = f["geometry"]["coordinates"][0]
        xs, ys = [p[0] for p in ring], [p[1] for p in ring]
        if min(xs) < b["east"] and max(xs) > b["west"] and min(ys) < b["north"] and max(ys) > b["south"]:
            tiles.append(f["properties"]["tile"])

    trees = []
    for tile in tiles:
        path = RAW / f"{tile}.tif"
        fetch(f"{BUCKET}/chm/{tile}.tif", path)
        with rasterio.open(path) as ds:
            (x0, x1), (y0, y1) = transform("EPSG:4326", ds.crs, [b["west"], b["east"]], [b["south"], b["north"]])
            window = from_bounds(x0, y0, x1, y1, ds.transform).round_offsets().round_lengths()
            chm = ds.read(1, window=window).astype(np.float32)
            win_transform = ds.window_transform(window)
            crs = ds.crs
        ground_m = abs(win_transform.a) * math.cos(math.radians((b["south"] + b["north"]) / 2))  # Web Mercator pixel on the ground

        # Light smoothing so one crown gives one maximum, then maxima within about 2.5 m.
        k = np.ones(3, dtype=np.float32) / 3
        smooth = np.apply_along_axis(lambda r: np.convolve(r, k, mode="same"), 1, chm)
        smooth = np.apply_along_axis(lambda c: np.convolve(c, k, mode="same"), 0, smooth)
        peaks = local_maxima(smooth, max(1, round(2.5 / ground_m))) & (chm >= MIN_HEIGHT_M)
        rows, cols = np.nonzero(peaks)
        heights = chm[rows, cols]
        order = np.argsort(-heights, kind="stable")

        # Tallest first; a tree suppresses lower maxima within a spacing that grows with its height.
        taken = {}
        cell = 4.0
        for i in order:
            h = float(heights[i])
            gx, gy = cols[i] * ground_m, rows[i] * ground_m
            spacing = min(max(0.38 * h, 3.2), 9.0)
            cx, cy = int(gx // cell), int(gy // cell)
            reach = int(spacing // cell) + 1
            clash = False
            for yy in range(cy - reach, cy + reach + 1):
                for xx in range(cx - reach, cx + reach + 1):
                    for (ox, oy, osp) in taken.get((xx, yy), ()):
                        if (ox - gx) ** 2 + (oy - gy) ** 2 < max(spacing, osp) ** 2:
                            clash = True
                            break
                    if clash:
                        break
                if clash:
                    break
            if clash:
                continue
            taken.setdefault((cx, cy), []).append((gx, gy, spacing))
            mx, my = rasterio.transform.xy(win_transform, int(rows[i]), int(cols[i]))
            trees.append((mx, my, h))
        canopy_share = float((chm >= MIN_HEIGHT_M).mean())

    # Web Mercator -> UTM 45N -> the area's local frame.
    xs, ys = transform(crs, "EPSG:32645", [t[0] for t in trees], [t[1] for t in trees])
    origin, extent = meta["origin"], meta["extent"]
    out = []
    for (x, y, (_, _, h)) in zip(xs, ys, trees):
        lx, ly = x - origin["utmE"], y - origin["utmN"]
        if extent["minX"] <= lx <= extent["maxX"] and extent["minY"] <= ly <= extent["maxY"]:
            # Crown radius: an assumed proportion of height (broad tropical street-tree crowns), clamped.
            out.append([round(lx, 1), round(ly, 1), round(h, 1), round(min(max(0.28 * h + 1.0, 1.6), 7.0), 1)])
    area_km2 = (extent["maxX"] - extent["minX"]) * (extent["maxY"] - extent["minY"]) / 1e6
    if len(out) > MAX_TREES_PER_KM2 * area_km2:
        sys.exit(f"{len(out)} trees is implausibly dense for {area_km2:.2f} km2; check the detection settings")

    dest = ROOT / "data" / "canopy" / area
    dest.mkdir(parents=True, exist_ok=True)
    (dest / "trees.json").write_text(json.dumps({
        "source": "Meta / WRI High Resolution Canopy Height Maps v1 (alsgedi_global_v6_float)",
        "licence": "CC BY 4.0",
        "tiles": tiles,
        "method": "one tree per local canopy-height maximum >= 3 m, spaced by height; crown radius assumed 0.28 x height + 1 m",
        "note": "Canopy position and height are modelled from satellite imagery. Individual trees, crown sizes and counts are approximations; species is unknown.",
        "trees": out,
    }))
    hs = np.array([t[2] for t in out]) if out else np.array([0.0])
    print(f"{area}: {len(out)} trees over {area_km2:.2f} km2 ({len(out) / area_km2:.0f} per km2); "
          f"canopy >= 3 m covers {canopy_share * 100:.1f}% of the window; height median {np.median(hs):.1f} m, max {hs.max():.1f} m")


if __name__ == "__main__":
    main()
