/**
 * Every creature the arena will let you field.
 *
 * The lane roster is 151 cards priced for an elixir economy. The arena charges
 * nothing and has no evolution step, so a lane deck walks in as whatever it
 * already is -- and a stage-1 loses to a stage-3 about 98% of the time, because
 * `tiers.skillDamage` reads the stage and hands a stage-1 roughly a third the
 * damage.
 *
 * The fix is not to resolve each card to a final form at the door. It is to
 * stop asking the question: the arena picks from everything we can draw, so
 * Charizard is an entry you choose rather than something Charmander has to
 * become. That also makes branching evolution a non-problem -- Vaporeon is
 * simply its own entry, and nothing has to decide what an unbranched Eevee is.
 *
 * Built from the sheets rather than from `CARD_TABLE`: that table is what the
 * *lane* roster can reach, which silently omits four creatures we have art for.
 */

import { build, type Card } from "./cards";
import { MEGA } from "./mega";
import { SHEETS } from "../data/sheets";

/**
 * Mega forms, excluded.
 *
 * Taken from MEGA's values rather than matched on a "mega" prefix: Groudon and
 * Kyogre become `primalgroudon` and `primalkyogre`, so a prefix rule would let
 * two Megas into the picker.
 */
const MEGA_FORMS: ReadonlySet<string> = new Set(Object.values(MEGA));

export const ARENA_ALL: readonly Card[] = Object.keys(SHEETS)
  .filter((name) => !MEGA_FORMS.has(name))
  // Sorted by id, so adding a sheet does not reshuffle the picker. The lane
  // roster sorts by elixir; the arena has no elixir to sort by.
  .sort()
  .map((name) => build(name))
  .filter((c): c is Card => c !== undefined);

const INDEX = new Map(ARENA_ALL.map((c) => [c.id, c]));

export function arenaById(id: string): Card | undefined {
  return INDEX.get(id);
}
