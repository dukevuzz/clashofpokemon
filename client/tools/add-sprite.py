#!/usr/bin/env python3
"""
Pull a creature's sprite out of pokemonAutoChess and into this build.

The old LOVE2D project had tools/pac2anim8.py, which emits a Lua table. This is
the same conversion writing what the Phaser build actually reads: a PNG in
public/sprites/ and an entry merged into src/data/sheets.json. Keeping it here
rather than reaching across to the other repo means the live project can
regenerate its own art.

Source format (pokemonAutoChess/app/public/src/assets/pokemons/<index>.json):
    TexturePacker JSON hash of trimmed frames named
        <Palette>/<Anim>/Anim/<direction 0-7>/<frame 0000>
    plus durations.json, giving per-frame hold times in 1/36s ticks.

Output is a uniform grid, one row per (anim, direction). That is wasteful --
padding every frame to the largest one is why our atlases decode to 13 MB where
PAC's decode to 1 MB -- and replacing it with a packed atlas is still the open
job. It is deliberately unchanged here: adding one creature is not the moment
to change the format every other creature is already in.

    python3 tools/add-sprite.py ../../pokemonAutoChess 0150:mewtwo
"""

import argparse
import json
import os
import subprocess
import sys
from collections import defaultdict

from PIL import Image

# FPS_POKEMON_ANIMS in pokemonAutoChess/app/public/src/game/animation-manager.ts
PMD_FPS = 36.0
# down, down-right, right, up-right, up, up-left, left, down-left
DIRECTIONS = ["0", "1", "2", "3", "4", "5", "6", "7"]
DEFAULT_ANIMS = ["Idle", "Walk", "Attack", "Shoot", "Hurt", "Sleep", "Hop", "DigIn"]

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_PNG = os.path.join(HERE, "sprites-raw")
OUT_JSON = os.path.join(HERE, "src", "data", "sheets.json")


def load_atlas(pac_repo, index):
    base = os.path.join(pac_repo, "app/public/src/assets/pokemons")
    with open(os.path.join(base, f"{index}.json")) as f:
        atlas = json.load(f)["textures"][0]
    sheet = Image.open(os.path.join(base, f"{index}.png")).convert("RGBA")
    with open(os.path.join(base, "durations.json")) as f:
        durations = json.load(f)
    return atlas, sheet, durations


def index_frames(atlas, palette):
    """-> {anim: {direction: [frame dicts ordered by frame number]}}"""
    tree = defaultdict(lambda: defaultdict(list))
    for frame in atlas["frames"]:
        parts = frame["filename"].split("/")
        if len(parts) != 5:
            continue
        pal, anim, mode, direction, number = parts
        if pal != palette or mode != "Anim":
            continue
        tree[anim][direction].append((number, frame))
    for anim in tree:
        for direction in tree[anim]:
            tree[anim][direction].sort(key=lambda p: p[0])
            tree[anim][direction] = [f for _, f in tree[anim][direction]]
    return tree


def cell_size(rows):
    """Largest untrimmed canvas across every frame we are about to pack."""
    w = h = 0
    for frames in rows.values():
        for frame in frames:
            w = max(w, frame["sourceSize"]["w"])
            h = max(h, frame["sourceSize"]["h"])
    return w, h


def paste_frame(sheet, dest, frame, cell_x, cell_y, cw, ch):
    """Undo TexturePacker trimming, then centre the source canvas in the cell."""
    src = frame["frame"]
    off = frame["spriteSourceSize"]
    source = frame["sourceSize"]
    region = sheet.crop((src["x"], src["y"], src["x"] + src["w"], src["y"] + src["h"]))
    if frame.get("rotated"):
        region = region.rotate(90, expand=True)
    x = cell_x + (cw - source["w"]) // 2 + off["x"]
    y = cell_y + (ch - source["h"]) // 2 + off["y"]
    dest.alpha_composite(region, (x, y))


def measure_body(sheet, layout, rows, cw, ch):
    """Opaque bounding box of the resting pose, so the game can size the sprite.

    This is the number everything downstream hangs off: draw scale is anchored
    to it, and so are mass and deploy delay. A wrong body measurement makes a
    creature the wrong size *and* the wrong weight.
    """
    resting = None
    for anim in ("Idle", "Walk", "Hurt"):
        for row, key in enumerate(layout):
            if key[0] == anim and key[1] == "0":
                resting = row
                break
        if resting is not None:
            break
    if resting is None:
        resting = 0

    cell = sheet.crop((0, resting * ch, cw, resting * ch + ch))
    box = cell.getchannel("A").getbbox()
    if not box:
        return {"width": cw, "height": ch, "feetOffset": 0}
    left, top, right, bottom = box
    return {
        "width": right - left,
        "height": bottom - top,
        "feetOffset": bottom - ch // 2,
    }


def convert(pac_repo, index, name, anims, palette):
    atlas, sheet, durations = load_atlas(pac_repo, index)
    tree = index_frames(atlas, palette)

    missing = [a for a in anims if a not in tree]
    if missing:
        print(f"  note: {index} has no {', '.join(missing)} -- skipped")
    anims = [a for a in anims if a in tree]
    if not anims:
        raise SystemExit(f"{index}: none of the requested animations exist")

    # One row per (anim, direction). Animations that are not direction-oriented
    # (Sleep, Eat) only ship direction 0; they get a single row.
    rows, layout = {}, []
    for anim in anims:
        for direction in DIRECTIONS:
            if direction not in tree[anim]:
                continue
            rows[(anim, direction)] = tree[anim][direction]
            layout.append((anim, direction))

    cw, ch = cell_size(rows)
    cols = max(len(f) for f in rows.values())
    out = Image.new("RGBA", (cols * cw, len(layout) * ch), (0, 0, 0, 0))
    for row, key in enumerate(layout):
        for col, frame in enumerate(rows[key]):
            paste_frame(sheet, out, frame, col * cw, row * ch, cw, ch)

    os.makedirs(OUT_PNG, exist_ok=True)
    png_path = os.path.join(OUT_PNG, f"{name}.png")
    out.save(png_path)
    body = measure_body(out, layout, rows, cw, ch)

    # Per-frame durations, in seconds, straight from the PMD tick counts.
    data = defaultdict(dict)
    for row, (anim, direction) in enumerate(layout, start=1):
        ticks = durations.get(f"{index}/{palette}/{anim}/Anim")
        frames = rows[(anim, direction)]
        if ticks and len(ticks) >= len(frames):
            secs = [round(t / PMD_FPS, 4) for t in ticks[: len(frames)]]
        else:
            secs = [round(4 / PMD_FPS, 4)] * len(frames)
        data[anim][direction] = {"row": row, "frames": len(frames), "durations": secs}

    entry = {
        "name": name,
        "index": index,
        "frameWidth": cw,
        "frameHeight": ch,
        "cols": cols,
        "rows": len(layout),
        "bodyWidth": body["width"],
        "bodyHeight": body["height"],
        "feetOffset": body["feetOffset"],
        "anims": {a: dict(sorted(data[a].items(), key=lambda kv: int(kv[0])))
                  for a in sorted(data)},
    }
    print(f"  {name}: {out.width}x{out.height}px, {len(layout)} rows x {cols} cols, "
          f"cell {cw}x{ch}, body {body['width']}x{body['height']}")
    return entry


def main():
    p = argparse.ArgumentParser()
    p.add_argument("pac_repo", help="path to the pokemonAutoChess clone")
    p.add_argument("specs", nargs="+", help="index:name pairs, e.g. 0150:mewtwo")
    p.add_argument("--anims", default=",".join(DEFAULT_ANIMS))
    p.add_argument("--palette", default="Normal")
    args = p.parse_args()

    with open(OUT_JSON) as f:
        sheets = json.load(f)

    anims = args.anims.split(",")
    for spec in args.specs:
        index, name = spec.split(":")
        sheets[name] = convert(args.pac_repo, index, name, anims, args.palette)

    # Sorted, so a regeneration produces a stable file rather than a reshuffle,
    # and written compact to match how sheets.json already ships. Pretty-printing
    # it turned a one-creature change into a 54,000-line diff.
    with open(OUT_JSON, "w") as f:
        json.dump(dict(sorted(sheets.items())), f, separators=(",", ":"))
    print(f"\n  sheets.json now has {len(sheets)} entries")

    # Repack, always. The game loads packed atlases, not these grids, so a
    # conversion that skipped this would write a sheet the game cannot see --
    # and the grids are 12x the texture memory, which is what made the game
    # take a minute to boot before they were packed.
    print()
    # Flushed, or the parent's buffered prints appear after the child's direct
    # writes and the log reads as though packing happened first.
    sys.stdout.flush()
    subprocess.run([sys.executable,
                    os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                 "pack-sprites.py")], check=True)


if __name__ == "__main__":
    main()
