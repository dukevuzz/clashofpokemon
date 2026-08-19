#!/usr/bin/env python3
"""
Pack pokemonAutoChess's portraits into one atlas.

Cards and the Pokedex drew the battle sprite: a frame lifted out of the walking
animation, cropped to a body box and scaled up. It is the wrong picture for the
job twice over. A walk frame is drawn to read at 24 pixels in motion from
above, so as a still portrait it is a creature seen from behind and slightly
above with one leg forward; and scaling a 19-pixel body up to fill a card is
asking four times the detail of art that does not have it.

PAC ships the right picture and we were not using it: a hand-drawn 40x40
portrait per species, framed like a face rather than a walk cycle. That is the
single biggest reason its card UI reads better than ours, and it costs one
atlas.

Portraits live at portraits/<index>/Normal.png, with alternate forms one level
deeper at portraits/<index>/<form>/Normal.png -- Megasteelix is 0208/0001,
which is why a flat lookup found 112 of our 113 and reported the last as
missing rather than as nested.

Emotions are ignored. PAC ships nineteen per species and uses them for chat
reactions; we want the neutral one, and shipping the rest would be nineteen
times the atlas for a feature we do not have.

    python3 tools/make-portraits.py ../../pokemonAutoChess
"""

import argparse
import json
import os

from PIL import Image

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_PNG = os.path.join(HERE, "public", "tiles", "portraits.png")
OUT_JSON = os.path.join(HERE, "src", "data", "portraits.json")
SHEETS = os.path.join(HERE, "src", "data", "sheets.json")

SIZE = 40


def find_portrait(root, index):
    """Portrait for a dex index, checking the form subdirectory too."""
    base = os.path.join(root, "app/public/src/assets/portraits")
    # `index` is either "0025" or "0208-0001" for an alternate form.
    if "-" in index:
        dex, form = index.split("-", 1)
        p = os.path.join(base, dex, form, "Normal.png")
        if os.path.exists(p):
            return p
    p = os.path.join(base, index, "Normal.png")
    return p if os.path.exists(p) else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pac_repo", help="path to the pokemonAutoChess clone")
    args = ap.parse_args()

    sheets = json.load(open(SHEETS))
    names = sorted(sheets)

    found, missing = [], []
    for name in names:
        p = find_portrait(args.pac_repo, sheets[name].get("index", ""))
        (found if p else missing).append((name, p))

    if missing:
        print(f"  no portrait for {len(missing)}: " +
              ", ".join(n for n, _ in missing[:8]))

    # One row. 113 portraits at 40px is 4,520 wide, which every target we care
    # about accepts -- the limit that bites is 4,096 on some old mobile GPUs, so
    # wrap into a grid rather than gamble on a strip.
    cols = 16
    rows = (len(found) + cols - 1) // cols
    atlas = Image.new("RGBA", (cols * SIZE, rows * SIZE), (0, 0, 0, 0))
    index = {}
    for i, (name, path) in enumerate(found):
        im = Image.open(path).convert("RGBA")
        if im.size != (SIZE, SIZE):
            im = im.resize((SIZE, SIZE), Image.NEAREST)
        c, r = i % cols, i // cols
        atlas.paste(im, (c * SIZE, r * SIZE))
        index[name] = i

    os.makedirs(os.path.dirname(OUT_PNG), exist_ok=True)
    atlas.save(OUT_PNG)
    json.dump({"size": SIZE, "cols": cols, "frames": index},
              open(OUT_JSON, "w"), indent=1, sort_keys=True)

    kb = os.path.getsize(OUT_PNG) / 1024
    print(f"  {len(found)} portraits -> {atlas.width}x{atlas.height}px, {kb:.0f} KB")
    print(f"  wrote {OUT_PNG}")
    print(f"  wrote {OUT_JSON}")


if __name__ == "__main__":
    main()
