#!/usr/bin/env python3
"""
Pack the attack-effect frames into one trimmed atlas.

    python3 tools/pack-attacks.py

This used to stack whole strips vertically, one row each, on the reasoning that
they are already uniform grids and there is nothing to trim. That is true of a
*strip* and false of the frames inside it: an explosion is a few opaque pixels
in a large cell at the start and end of its animation, and every one of those
cells was stored in full.

Measured across the 43 effects the roster actually casts:

    cells as laid out   3.8 M px
    actual opaque art   1.3 M px      67% of the sheet was padding
    as strips           3360x3362 = 11.3 M px  (45 MB decoded)
    trimmed and packed  ~1214x1214 =  1.5 M px  ( 6 MB decoded)

So this now does what `pack-sprites.py` does for creatures, and what PAC does
for the same art with TexturePacker: trim each frame to its opaque bounds, pack
the lot with a shelf algorithm, and record where each frame went along with the
offset it was trimmed by. Nothing is padded to a common size, so the atlas stops
being as wide as the longest animation -- which is what pushed it over the
4096px limit older mobile GPUs still have.

The offset matters and is easy to lose: a trimmed frame must be drawn back at
the position it was cut from, or a flame that shrinks at the edges appears to
slide as it plays.
"""

import json
import os

from PIL import Image

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(HERE, "attacks-raw")
OUT_PNG = os.path.join(HERE, "public", "tiles", "attacks.png")
OUT_JSON = os.path.join(HERE, "src", "data", "attacks-atlas.json")
FX_JSON = os.path.join(HERE, "src", "data", "abilityFx.json")
ATTACKS_JSON = os.path.join(HERE, "src", "data", "attacks.json")

PAD = 1
MAX_WIDTH = 2048


def shelf_pack(sizes, max_width=MAX_WIDTH):
    """Left to right in rows, new row when full. Same as pack-sprites.py."""
    placed = {}
    x = y = row_h = 0
    width = 0
    for key, (w, h) in sizes:
        if x + w + PAD > max_width:
            x = 0
            y += row_h + PAD
            row_h = 0
        placed[key] = (x, y)
        x += w + PAD
        row_h = max(row_h, h)
        width = max(width, x)
    return placed, width, y + row_h


def frames_of(strip_path, w, h, count):
    """Cut a strip into cells and trim each to its opaque box."""
    im = Image.open(strip_path).convert("RGBA")
    out = []
    for i in range(count):
        cell = im.crop((i * w, 0, (i + 1) * w, h))
        bb = cell.getbbox()
        if bb is None:
            # A blank frame still has to occupy its slot in the animation, or
            # the timing changes. One transparent pixel is cheaper than a
            # special case downstream.
            out.append((Image.new("RGBA", (1, 1), (0, 0, 0, 0)), 0, 0))
            continue
        out.append((cell.crop(bb), bb[0], bb[1]))
    return out


def main():
    # Every sheet any effect refers to, from both tables.
    wanted = {}
    for path in (FX_JSON, ATTACKS_JSON):
        data = json.load(open(path))
        entries = data.values() if isinstance(data, dict) else data
        for e in entries:
            # attacks.json nests one level deeper: kind -> element -> info
            group = e.values() if isinstance(e, dict) and "sheet" not in e else [e]
            for info in group:
                if isinstance(info, dict) and "sheet" in info:
                    wanted[info["sheet"]] = info

    cells = {}
    for sheet, info in sorted(wanted.items()):
        p = os.path.join(SRC, f"{sheet}.png")
        if not os.path.exists(p):
            print(f"  ! {sheet}: no strip staged")
            continue
        for i, (img, ox, oy) in enumerate(
                frames_of(p, info["w"], info["h"], info["frames"])):
            cells[f"{sheet}/{i}"] = (img, ox, oy, info["w"], info["h"])

    sizes = sorted(((k, v[0].size) for k, v in cells.items()),
                   key=lambda kv: -kv[1][1])
    placed, width, height = shelf_pack(sizes)

    sheet_img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    frames = {}
    for key, (img, ox, oy, sw, sh) in cells.items():
        x, y = placed[key]
        sheet_img.paste(img, (x, y))
        # x, y, w, h in the atlas, then the offset it was trimmed by and the
        # size of the cell it came from -- everything needed to put it back.
        frames[key] = [x, y, img.width, img.height, ox, oy, sw, sh]

    os.makedirs(os.path.dirname(OUT_PNG), exist_ok=True)
    sheet_img.save(OUT_PNG)
    json.dump({"frames": frames}, open(OUT_JSON, "w"), separators=(",", ":"))
    open(OUT_JSON, "a").write("\n")

    px = width * height
    print(f"  packed {len(cells)} frames from {len(wanted)} effects")
    print(f"  {width}x{height} = {px/1e6:.1f} M px, {px*4/1e6:.0f} MB decoded")
    print(f"  fits a 4096 texture: {'yes' if max(width, height) <= 4096 else 'NO'}")
    print(f"  {os.path.getsize(OUT_PNG)//1024} KB on disk")


if __name__ == "__main__":
    main()
