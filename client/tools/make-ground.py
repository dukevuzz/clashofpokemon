#!/usr/bin/env python3
"""
Pack the ground tiles, and work out which one goes where.

The board used to be four flat 24px tiles -- one grass, one sand, one road, one
water -- laid edge to edge. That is what made it look minimal: not the quality
of the art, but that there was one of each, so every boundary was a straight
hard seam and a field of grass repeated the same square 400 times.

Art is legend-of-lua's overworld set (MIT, Challacade LLC, upstream is
challacade/legend-of-lua). It is 16px and hand-authored, which is the point:
somebody drew the ragged edge where grass meets a dirt path and the foam where
water meets land, and those edges are what the board was missing. PMD tilesets
cannot supply them -- a PMD dungeon has exactly one floor, so its floor group is
47 paintings of the same surface with no transitions at all. Checked before
concluding it, because the docstring that claimed otherwise was wrong twice.

Output is one atlas strip plus a JSON index:

    grass      plain fills and tufted variants, picked per tile
    dirt       lane fills
    dirtEdgeL  lane tiles with a ragged left edge, transparent beyond it
    dirtEdgeR  the same on the right
    water      a 3x3 autotile ring, indexed by which neighbours are also water

The lane edges are baked here rather than masked at draw time: the board is a
RenderTexture and Phaser has no cheap per-pixel stencil, so the ragged cut is
done once in Pillow and shipped as its own tile.

    python3 tools/make-ground.py ../../legend-of-lua
"""

import argparse
import json
import os

from PIL import Image

T = 16                      # the art's native cell size
FIRSTGID = 1481             # Overworld-edit.png starts here in the Tiled maps

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_PNG = os.path.join(HERE, "public", "tiles", "ground.png")
OUT_JSON = os.path.join(HERE, "src", "data", "ground.json")

# Chosen by tiling each candidate and looking at it. The plain fills are the
# flat green; the tufted ones carry grass blades and are mixed in sparsely --
# at full density the field reads as confetti and the creatures get lost in it.
GRASS_PLAIN = [2656, 2696, 2657, 2697, 2736, 2776]
GRASS_TUFT = [2655, 2658, 2695, 2698, 2735, 2737, 2775, 2778, 2815, 2818]
DIRT = [2682, 2842, 2882]

# A 3x3 water block with a painted foam bank, centre 1764. Keyed by which of
# (north, east, south, west) is also water. The diagonal-only cases fall back to
# an edge rather than the centre, so a one-tile-wide river still gets a bank.
WATER = {
    "1111": 1764,
    "0111": 1724, "1101": 1804, "1011": 1765, "1110": 1763,
    "0110": 1723, "0011": 1725, "1100": 1803, "1001": 1805,
    "0101": 1724, "1010": 1763, "0000": 1764,
    "0010": 1723, "0100": 1803, "1000": 1805, "0001": 1725,
}

# Hand-painted dirt blobs, used only for the shape of their edge.
STENCIL_SRC = [2682, 2842, 2882]


def load(lol_root):
    p = os.path.join(lol_root, "maps/_tilesets/Overworld-edit.png")
    return Image.open(p).convert("RGBA")


def tile(sheet, gid):
    cols = sheet.width // T
    i = gid - FIRSTGID
    c, r = i % cols, i // cols
    return sheet.crop((c * T, r * T, c * T + T, r * T + T))


def dirt_mask(sheet, gid):
    """Which pixels of a dirt blob are dirt -- the ragged outline we reuse."""
    px = list(tile(sheet, gid).convert("RGB").getdata())
    return [1 if (r > 140 and r > g + 20 and g > b) else 0 for r, g, b in px]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("lol_root", help="path to the legend-of-lua clone")
    args = ap.parse_args()
    sheet = load(args.lol_root)

    order = []
    for gid in GRASS_PLAIN + GRASS_TUFT + DIRT + sorted(set(WATER.values())):
        if gid not in order:
            order.append(gid)

    # Baked lane edges: solid dirt on the side that continues, the hand-painted
    # ragged outline on the side that meets grass.
    edges = []
    for src in STENCIL_SRC:
        m = dirt_mask(sheet, src)
        for facing in ("L", "R"):
            img = tile(sheet, src).copy()
            px = img.load()
            for y in range(T):
                for x in range(T):
                    solid = x >= T // 2 if facing == "L" else x < T // 2
                    if not (m[y * T + x] or solid):
                        px[x, y] = (0, 0, 0, 0)
            edges.append((facing, img))

    atlas = Image.new("RGBA", ((len(order) + len(edges)) * T, T))
    for n, gid in enumerate(order):
        atlas.alpha_composite(tile(sheet, gid), (n * T, 0))
    for k, (_, img) in enumerate(edges):
        atlas.alpha_composite(img, ((len(order) + k) * T, 0))
    os.makedirs(os.path.dirname(OUT_PNG), exist_ok=True)
    atlas.save(OUT_PNG)

    at = {gid: n for n, gid in enumerate(order)}
    data = {
        "tile": T,
        "count": len(order) + len(edges),
        "grassPlain": [at[g] for g in GRASS_PLAIN],
        "grassTuft": [at[g] for g in GRASS_TUFT],
        "dirt": [at[g] for g in DIRT],
        "water": {k: at[v] for k, v in WATER.items()},
        "dirtEdgeL": [len(order) + i for i, (f, _) in enumerate(edges) if f == "L"],
        "dirtEdgeR": [len(order) + i for i, (f, _) in enumerate(edges) if f == "R"],
        "credit": "legend-of-lua overworld set, MIT, Challacade LLC",
    }
    with open(OUT_JSON, "w") as f:
        json.dump(data, f, separators=(",", ":"))

    print(f"  {OUT_PNG}  {atlas.width}x{atlas.height} ({len(order)} tiles)")
    print(f"  {OUT_JSON}  {os.path.getsize(OUT_JSON) // 1024} KB")


if __name__ == "__main__":
    main()
