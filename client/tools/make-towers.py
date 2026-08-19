#!/usr/bin/env python3
"""
Cut the tower sprites out of the Foozle Spire pack.

The source (art-src/foozle-spire-tower-01.png, CC0 -- see foozle-LICENSE.txt)
is a 192x128 strip of one tower at three upgrade levels, 64px each. We take:

  level I   -> the lane tower
  level III -> the king, so the king reads as the fortified version of the
               same building rather than as a different building

Each is emitted twice, once per side, because the banner is the only team
colour on the structure and it is baked into the art. Recolouring the two
banner blues is safe: they appear nowhere else in the sprite (checked -- they
occupy y 91..115 and nothing outside the banner uses them), so a straight
palette swap cannot bleed into the stonework.

Tinting the whole sprite was the alternative and it is worse. These towers are
grey stone with a dark outline; a red multiply turns the stone to rust and
costs the art everything that makes it look like stone. One recoloured banner
says "theirs" just as clearly and leaves the building alone.

    python3 tools/make-towers.py
"""

import os
from PIL import Image

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(HERE, "art-src", "foozle-spire-tower-01.png")
OUT = os.path.join(HERE, "public", "tiles")

FRAME = 64
# The banner's two blues, light and shadow.
BANNER = [(76, 147, 173, 255), (65, 114, 145, 255)]
# Player keeps the blue it was drawn with; it already matches our team colour.
SIDES = {
    "player": None,
    "enemy": [(214, 74, 74, 255), (158, 52, 58, 255)],
}
# Which upgrade level each kind of tower uses.
LEVEL = {"side": 0, "king": 2}


def cut(strip, level):
    """One frame, trimmed to its opaque content."""
    f = strip.crop((level * FRAME, 0, (level + 1) * FRAME, strip.height))
    return f.crop(f.getbbox())


def recolour(img, mapping):
    if mapping is None:
        return img
    out = img.copy()
    px = out.load()
    swap = dict(zip(BANNER, mapping))
    for y in range(out.height):
        for x in range(out.width):
            c = px[x, y]
            if c in swap:
                px[x, y] = swap[c]
    return out


def main():
    strip = Image.open(SRC).convert("RGBA")
    if strip.width != FRAME * 3:
        raise SystemExit(f"expected a 3-frame strip, got {strip.size}")

    os.makedirs(OUT, exist_ok=True)
    sizes = {}
    for kind, level in LEVEL.items():
        base = cut(strip, level)
        sizes[kind] = base.size
        for side, mapping in SIDES.items():
            img = recolour(base, mapping)
            path = os.path.join(OUT, f"tower_{kind}_{side}.png")
            img.save(path)
            print(f"  wrote {os.path.relpath(path, HERE)}  {img.size[0]}x{img.size[1]}")

    print("\nput these in src/data/terrain.json under \"towers\":")
    for kind, (w, h) in sizes.items():
        print(f'  "{kind}": {{ "sheet": "tower_{kind}", "w": {w}, "h": {h} }},')


if __name__ == "__main__":
    main()
