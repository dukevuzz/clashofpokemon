#!/usr/bin/env python3
"""
Write each sheet's attack pose into sheets.json, so nothing guesses at runtime.

    python3 tools/resolve-poses.py

A PMD sheet does not promise an "Attack" row. Charmander has Kick, Machop has
Kick and Strike, Geodude has Punch -- so the renderer resolved a pose by walking
a priority list every time it drew a frame. That worked, mostly, and hid two
things: nine melee creatures were playing a ranged *firing* animation because
"Shoot" is the last resort on the melee list, and nobody could disagree with any
of it, because the choice was emergent from list order rather than written down.

This records the answer. `attack` is the melee pose, `shoot` the ranged one.
OVERRIDE is where a human overrules the list.

Run after add-sprite.py, which is what changes the animation rows.
"""

import json
import os

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHEETS = os.path.join(HERE, "src", "data", "sheets.json")

# The same order the renderer used, kept so this reproduces today's behaviour
# for everything the override table does not touch.
#
# "Shoot" is last on the melee list on purpose: it is the wrong animation for a
# creature that swings, but it is *an* animation, and standing still while
# dealing damage reads as a bug. That trade is right for a fallback and wrong as
# a final answer, which is what OVERRIDE exists to fix.
MELEE = ["Attack", "Punch", "Hit", "Slap", "Slice", "Strike", "Swing", "Kick",
         "Slam", "Shock", "Shoot"]
RANGED = ["Shoot", "Attack", "Special", "Charge", "Swing"]

# PAC names an attack animation per Pokemon, and it is the authority.
#
# It has to be read from source rather than guessed, because the names are not
# predictable: Togepi attacks with "Appeal", Togetic with "Hover", Jolteon with
# "Shock", Blastoise with "Ricochet". Our extractor pulled a fixed list of rows
# -- Idle, Walk, Attack, Shoot, Hurt, Sleep, Hop, DigIn -- so for eleven species
# the row PAC considers their attack was never imported at all. Three of them
# ended up with no attack motion whatsoever and stood in an idle pose while
# dealing damage, which was recorded for weeks as "these creatures have no
# attack animation". They always had one. We did not ask for it.
PAC_ANIMS = os.path.join(
    os.path.dirname(os.path.dirname(HERE)), "pokemonAutoChess",
    "app/public/src/game/components/pokemon-animations.ts")


def pac_attacks():
    """Per-species attack animation, as PAC declares it."""
    if not os.path.exists(PAC_ANIMS):
        print("  (no pokemonAutoChess clone beside this repo -- using the lists only)")
        return {}
    import re
    src = open(PAC_ANIMS).read()
    out = {}
    for m in re.finditer(r"\[Pkm\.([A-Z0-9_]+)\]:\s*\{(.*?)\n  \}", src, re.S):
        a = re.search(r"attack:\s*AnimationType\.(\w+)", m.group(2))
        b = re.search(r"ability:\s*AnimationType\.(\w+)", m.group(2))
        out[m.group(1).lower()] = (a.group(1) if a else None,
                                   b.group(1) if b else None)
    return out

# Where the list picks something wrong, and a person picked better.
#
# Every entry here was a melee creature resolving to "Shoot" -- a firing pose on
# something that hits with its body. Each is replaced by the best *motion* the
# sheet actually ships, which is usually a charge or a hop rather than a strike:
# a lunge reads as a hit even when it was animated for something else.
OVERRIDE: dict = {
    # Empty, and worth explaining, because the obvious entries were tried and
    # rejected.
    #
    # Nine melee creatures resolve to "Shoot" -- a firing pose on something that
    # hits with its body -- and three resolve to nothing at all. The tempting
    # fix is to borrow whatever motion the sheet does ship, which for all twelve
    # is "Hop". That is worse: Hop is a *jump*, and Charge is a run-up. Neither
    # is an attack, so the result is a creature visibly hopping every time it
    # swings. Shoot is at least an attack, merely the wrong kind of one.
    #
    # The real fix for a sheet with no attack row is a lunge driven by the
    # renderer -- a short shove toward the target and back -- not an unrelated
    # animation wearing an attack's name. sprites.ts has claimed such a tween
    # existed for some time; it never has. See PLAN-moves.md.
    #
    # This table stays so a human can overrule the list when a sheet genuinely
    # carries a better *attack* row than the order happens to pick.
}


def pick(anims, order):
    for name in order:
        if name in anims:
            return name
    return None


def main():
    with open(SHEETS) as f:
        sheets = json.load(f)

    pac = pac_attacks()
    stats = {"attack": 0, "shoot": 0, "override": 0, "none": 0, "declared": 0, "ability": 0}
    for name, sheet in sheets.items():
        anims = sheet.get("anims", {})
        # PAC's declaration first, the priority list only where it is silent or
        # names a row this sheet does not carry.
        decl_attack, decl_ability = pac.get(name, (None, None))
        declared = decl_attack if decl_attack in anims else None
        # The cast pose. Falls back to the attack, which is what the renderer
        # did for every creature before this field existed.
        ability = decl_ability if decl_ability in anims else None
        # PAC stores ONE attack animation per Pokemon. The melee/ranged split is
        # ours -- it falls out of `range > 30` -- so its declaration serves both
        # slots, and the lists only fill in where it is silent. Without this,
        # Togepi has a perfectly good Appeal row and still renders nothing,
        # because it happens to be a ranged card in our game and `shoot` is null.
        attack = declared or pick(anims, MELEE)
        shoot = pick(anims, RANGED) or declared
        if declared and declared in anims:
            stats["declared"] += 1

        over = OVERRIDE.get(name, {})
        for slot, want in over.items():
            if want in anims:
                if slot == "attack":
                    attack = want
                else:
                    shoot = want
                stats["override"] += 1
            else:
                print(f"  ! {name}: override wants {want}, sheet has "
                      f"{sorted(anims)} -- ignored")

        # Written even when None, so a missing pose is a visible null rather
        # than an absent key that reads as "not generated yet".
        sheet["attack"] = attack
        sheet["shoot"] = shoot
        sheet["ability"] = ability
        if ability:
            stats["ability"] += 1
        if attack:
            stats["attack"] += 1
        if shoot:
            stats["shoot"] += 1
        if not attack and not shoot:
            stats["none"] += 1
            print(f"  ! {name}: no attack motion at all ({sorted(anims)})")

    with open(SHEETS, "w") as f:
        json.dump(sheets, f, indent=1, sort_keys=True)
        f.write("\n")

    print(f"\n  {len(sheets)} sheets")
    print(f"  melee pose:  {stats['attack']}")
    print(f"  ranged pose: {stats['shoot']}")
    print(f"  from PAC:    {stats['declared']}")
    print(f"  cast pose:   {stats['ability']}")
    print(f"  overridden:  {stats['override']}")
    print(f"  no motion:   {stats['none']}")


if __name__ == "__main__":
    main()
