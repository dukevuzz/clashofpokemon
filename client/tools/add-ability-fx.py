#!/usr/bin/env python3
"""
Pull an ability's effect frames out of pokemonAutoChess and stage them.

    python3 tools/add-ability-fx.py ../../pokemonAutoChess ROLLOUT WATER_PULSE
    python3 tools/add-ability-fx.py ../../pokemonAutoChess --missing

PAC keeps each effect as a folder of numbered frames -- 000.png, 001.png -- and
this project wants one horizontal strip per effect, because `pack-attacks.py`
stacks strips vertically into a single texture and addresses a frame as (index)
across, (strip) down. So the job is: read the frames in order, lay them out left
to right, write one PNG, and record the frame size.

`--missing` does the useful thing on its own: every skill on the roster that has
no effect yet and that PAC ships art for. That was 23 of 38 the first time it
ran -- the rest are buffs and copies PAC renders without a sprite either.

Run `pack-attacks.py` afterwards to fold the new strips into the atlas.
"""

import argparse
import json
import os
import sys

from PIL import Image

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(HERE, "attacks-raw")
FX_JSON = os.path.join(HERE, "src", "data", "abilityFx.json")


def pac_dir(pac_repo):
    return os.path.join(pac_repo, "app/public/src/assets/abilities{tps}")


def pac_attacks_dir(pac_repo):
    return os.path.join(pac_repo, "app/public/src/assets/attacks{tps}")


# Longest strip we will lay down in one row.
#
# The atlas is as wide as its widest strip, and a texture wider than 4096 will
# not upload at all on the older mobile GPUs that still cap there -- so one
# 37-frame Explosion at 168px a cell made the whole sheet 6216 wide and unusable
# on those devices, effects and all.
#
# Dropping frames is the right trade rather than shrinking cells: these play for
# a fraction of a second over a 24px creature, and PAC animates some of them for
# well over a second. Frames are sampled evenly, so the effect keeps its shape
# and simply plays at a coarser step.
MAX_FRAMES = 20


def strip_for(pac_repo, name):
    """One horizontal strip from a folder of numbered frames."""
    src = os.path.join(pac_dir(pac_repo), name)
    frames = sorted(f for f in os.listdir(src) if f.endswith(".png"))
    if not frames:
        return None

    if len(frames) > MAX_FRAMES:
        step = len(frames) / MAX_FRAMES
        frames = [frames[int(i * step)] for i in range(MAX_FRAMES)]

    images = [Image.open(os.path.join(src, f)).convert("RGBA") for f in frames]
    # Cells inside one effect are uniform in PAC, but take the max rather than
    # the first: a single odd frame would otherwise be cropped, and a clipped
    # explosion is harder to spot than a slightly padded one.
    w = max(im.width for im in images)
    h = max(im.height for im in images)

    out = Image.new("RGBA", (w * len(images), h), (0, 0, 0, 0))
    for i, im in enumerate(images):
        # Centred in its cell, so a frame smaller than the others does not
        # jump to the top-left when it plays.
        out.paste(im, (i * w + (w - im.width) // 2, (h - im.height) // 2))
    return out, w, h, len(images)


def roster_gaps(pac_repo):
    """Skills on the roster with no effect, that PAC has art for."""
    import subprocess
    script = (
        "import { ALL, build } from './src/core/cards';"
        "import * as evolution from './src/core/evolution';"
        "const s=new Set();for(const c of ALL)for(const f of evolution.chainOf(c.id)??[c.id])"
        "s.add(build(f).skill);console.log(JSON.stringify([...s]))"
    )
    out = subprocess.run(["npx", "tsx", "-e", script], capture_output=True,
                         text=True, cwd=HERE)
    skills = set(json.loads(out.stdout.strip().splitlines()[-1]))
    have = set(json.load(open(FX_JSON)))
    shipped = set(os.listdir(pac_dir(pac_repo)))
    return sorted((skills - have) & shipped)


def restore_attacks(pac_repo):
    """
    The generic per-element attack effects, from PAC's `attacks{tps}`.

    These are what an *ordinary* swing draws -- BUG_melee, WATER_range,
    FIRE_hit -- as opposed to an ability. They live one directory deeper than
    the abilities do (ELEMENT/kind/000.png) and `attacks.json` names them
    ELEMENT_kind, so the two have to be walked differently.

    Restorable rather than precious: they were deleted once by a prune that
    keyed only on `abilityFx.json` and concluded 51 staged strips were unused.
    They were not unused, they were used by the other table.
    """
    src = pac_attacks_dir(pac_repo)
    want = json.load(open(os.path.join(HERE, "src", "data", "attacks.json")))
    need = {info["sheet"] for kinds in want.values() for info in kinds.values()}

    made = 0
    for sheet in sorted(need):
        element, _, kind = sheet.rpartition("_")
        folder = os.path.join(src, element, kind)
        if not os.path.isdir(folder):
            print(f"  ! {sheet}: not in PAC ({element}/{kind})", file=sys.stderr)
            continue
        frames = sorted(f for f in os.listdir(folder) if f.endswith(".png"))
        if not frames:
            continue
        images = [Image.open(os.path.join(folder, f)).convert("RGBA") for f in frames]
        w = max(i.width for i in images)
        h = max(i.height for i in images)
        out = Image.new("RGBA", (w * len(images), h), (0, 0, 0, 0))
        for i, im in enumerate(images):
            out.paste(im, (i * w + (w - im.width) // 2, (h - im.height) // 2))
        out.save(os.path.join(RAW, f"{sheet}.png"))
        # attacks.json already records frames/w/h; only the art was missing.
        made += 1
    print(f"  restored {made} of {len(need)} generic attack strips")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("pac_repo")
    p.add_argument("abilities", nargs="*")
    p.add_argument("--missing", action="store_true",
                   help="every roster skill with no effect that PAC ships")
    p.add_argument("--attacks", action="store_true",
                   help="restore the generic per-element attack effects")
    args = p.parse_args()

    if args.attacks:
        os.makedirs(RAW, exist_ok=True)
        restore_attacks(args.pac_repo)
        print("  now run: python3 tools/pack-attacks.py")
        return

    names = args.abilities
    if args.missing:
        names = roster_gaps(args.pac_repo)
        print(f"  {len(names)} roster skills have art in PAC and none here\n")
    if not names:
        print("nothing to do")
        return

    os.makedirs(RAW, exist_ok=True)
    fx = json.load(open(FX_JSON))
    added = 0
    for name in names:
        made = strip_for(args.pac_repo, name)
        if not made:
            print(f"  ! {name}: no frames", file=sys.stderr)
            continue
        img, w, h, count = made
        sheet = f"ABILITY_{name}"
        img.save(os.path.join(RAW, f"{sheet}.png"))
        fx[name] = {"frames": count, "w": w, "h": h, "sheet": sheet}
        added += 1
        print(f"  {name:16} {count:2} frames  {w}x{h}")

    json.dump(fx, open(FX_JSON, "w"), indent=1, sort_keys=True)
    open(FX_JSON, "a").write("\n")
    print(f"\n  {added} added -- abilityFx.json now has {len(fx)}")
    print("  now run: python3 tools/pack-attacks.py")


if __name__ == "__main__":
    main()
