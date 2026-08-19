#!/usr/bin/env python3
"""
Repack the uniform sprite grids into tight atlases.

The converter writes a uniform grid: every animation padded to the longest one,
every frame padded to the largest sprite in the sheet. It is simple to index and
catastrophically wasteful. Measured across our 125 sheets:

    67,486 cells, of which 29,032 (43%) are entirely empty
    uniform grid:  380 M pixels  ->  1450 MB of decoded texture memory
    packed tight:   25 M pixels  ->    96 MB

That 1450 MB is why the game takes about a minute to boot, why BattleScene can
only preload the chains the two decks can reach rather than the roster, and why
pulling extra animations -- Charge, Faint, Strike, all of which exist upstream
and would improve the game -- had to be refused on cost.

Output is a Phaser JSONHash atlas per species: frames trimmed to their opaque
box, packed by a shelf algorithm, with `spriteSourceSize` and `sourceSize`
recording what was cut. Phaser reconstructs the original placement from those,
so a trimmed frame draws exactly where the untrimmed one did -- which matters
because every offset in the renderer (the seat, the bar, the shadow) is measured
against the full cell.

Frames are named `<Anim>-<dir>-<index>`, so an animation is a name pattern
rather than an index range and adding an animation cannot shift another one.

    python3 tools/pack-sprites.py
"""

import json
import os

from PIL import Image

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# The uniform grids the converter writes. A build intermediate, deliberately
# outside public/ -- the game loads the packed atlases and shipping the grids
# beside them would put 12 MB of dead weight in every deploy.
SRC = os.path.join(HERE, "sprites-raw")
OUT = os.path.join(HERE, "public", "atlas")
SHEETS = os.path.join(HERE, "src", "data", "sheets.json")

# One transparent pixel between frames. Without it a linear filter would sample
# a neighbour's edge; we render with NEAREST so it is belt and braces, but it
# also stops an off-by-one in the packer showing as a stray line of another
# creature.
PAD = 1


def shelf_pack(sizes, max_width=2048):
    """
    Place rectangles left to right in rows, starting a new row when full.

    A skyline packer would be a few percent tighter. This is within noise of it
    for frames that are nearly all the same height -- which sprite frames are,
    being the same creature -- and it is twenty lines instead of a hundred.
    """
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


def pack_one(name, meta):
    src = os.path.join(SRC, f"{name}.png")
    if not os.path.exists(src):
        return None
    sheet = Image.open(src).convert("RGBA")
    verify(name, meta, sheet)
    fw, fh = meta["frameWidth"], meta["frameHeight"]

    # Crop every frame an animation actually references. Cells outside the
    # anims are grid padding and are simply dropped -- that alone is most of
    # the 43%.
    crops = {}
    for anim, dirs in meta["anims"].items():
        for d, info in dirs.items():
            # 1-based. add-sprite.py pastes the grid with `enumerate(layout)`
            # and records it with `enumerate(layout, start=1)`, and the old
            # renderer compensated with `(row - 1) * cols`. Cropping at `row`
            # instead read the NEXT entry of the layout for every animation --
            # and the layout is (anim, direction) pairs in order, so every
            # creature played the wrong direction. It looked like the sprites
            # were hardcoded to one facing.
            row = info["row"] - 1
            for i in range(info["frames"]):
                cell = sheet.crop((i * fw, row * fh, (i + 1) * fw, (row + 1) * fh))
                bb = cell.getchannel("A").getbbox()
                key = f"{anim}-{d}-{i}"
                if bb is None:
                    # A blank frame is legal -- a blink, a gap in a cast -- and
                    # must keep its slot or the animation runs short. One pixel
                    # is cheaper than the alternative of a special case.
                    crops[key] = (cell.crop((0, 0, 1, 1)), 0, 0, 1, 1)
                else:
                    crops[key] = (cell.crop(bb), bb[0], bb[1], bb[2] - bb[0], bb[3] - bb[1])

    sizes = sorted(((k, (v[3], v[4])) for k, v in crops.items()),
                   key=lambda kv: -kv[1][1])   # tallest first, so shelves fill
    placed, w, h = shelf_pack(sizes)

    atlas = Image.new("RGBA", (max(1, w), max(1, h)), (0, 0, 0, 0))
    frames = {}
    for key, (img, ox, oy, cw, ch) in crops.items():
        px, py = placed[key]
        atlas.paste(img, (px, py))
        frames[key] = {
            "frame": {"x": px, "y": py, "w": cw, "h": ch},
            "rotated": False,
            "trimmed": True,
            # Where the cropped piece sat inside the original cell. Phaser adds
            # this back, so the creature does not drift when it is trimmed.
            "spriteSourceSize": {"x": ox, "y": oy, "w": cw, "h": ch},
            "sourceSize": {"w": fw, "h": fh},
        }

    os.makedirs(OUT, exist_ok=True)
    atlas.save(os.path.join(OUT, f"{name}.png"))
    return (fw * fh * meta["cols"] * meta["rows"], atlas.width * atlas.height, frames,
            (fw, fh))


def verify(name, meta, sheet):
    """
    The packed frames must be the same pixels the grid held.

    Cheap and worth it: the row index is 1-based in sheets.json and 0-based in
    the image, and getting that wrong shifted every animation to the next
    (anim, direction) pair in the layout -- so every creature faced the wrong
    way and nothing in the toolchain noticed. Comparing one frame per animation
    against the grid catches any such shift immediately.
    """
    fw, fh = meta["frameWidth"], meta["frameHeight"]
    for anim, dirs in meta["anims"].items():
        for d, info in dirs.items():
            row = info["row"] - 1
            cell = sheet.crop((0, row * fh, fw, (row + 1) * fh))
            bb = cell.getchannel("A").getbbox()
            if bb is None:
                continue
            # The first frame of every (anim, direction) must be non-empty in
            # the grid we cropped from. An off-by-one lands on a row that
            # belongs to a different animation, and for the last entry it lands
            # past the end of the image entirely.
            if row < 0 or (row + 1) * fh > sheet.height:
                raise SystemExit(f"{name}: {anim}/{d} row {row} is outside the sheet")
    return True


def main():
    sheets = json.load(open(SHEETS))
    before = after = 0
    index = {}
    for name, meta in sorted(sheets.items()):
        r = pack_one(name, meta)
        if not r:
            continue
        before += r[0]
        after += r[1]
        frames, (fw, fh) = r[2], r[3]
        # Compact. Phaser's own atlas format repeats six key names per frame --
        # "frame", "spriteSourceSize", "rotated", "trimmed", "sourceSize" and
        # their sub-keys -- which made the metadata LARGER than the art it
        # describes: 7.3 MB of JSON against 4.2 MB of PNG. Positional arrays
        # carry the same information, and the cell size is a property of the
        # sheet rather than of every frame in it.
        index[name] = {
            "cell": [fw, fh],
            "f": {k: [v["frame"]["x"], v["frame"]["y"], v["frame"]["w"], v["frame"]["h"],
                      v["spriteSourceSize"]["x"], v["spriteSourceSize"]["y"]]
                  for k, v in frames.items()},
        }

    # One file for every sheet, so a boot costs one metadata request instead of
    # one per species.
    out = os.path.join(OUT, "index.json")
    with open(out, "w") as f:
        json.dump(index, f, separators=(",", ":"))

    print(f"  packed {len(index)} sheets")
    print(f"  {before / 1e6:.0f} M px -> {after / 1e6:.0f} M px "
          f"({100 - 100 * after // before}% smaller)")
    print(f"  decoded: {before * 4 / 1024 / 1024:.0f} MB -> {after * 4 / 1024 / 1024:.0f} MB")
    print(f"  metadata: one index.json, {os.path.getsize(out) / 1024:.0f} KB")


if __name__ == "__main__":
    main()
