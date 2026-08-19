/** What a card costs, and how much creature that price buys. */

import { config } from "./config";
import * as tiers from "./tiers";
import type { Species } from "./species";
import { attackRateFor, REFERENCE_RATE } from "./stats";

// ---------------------------------------------------------------------- cost
//
// The mapping is linear across the base forms and compressive above them.
//
// Linear everywhere put a legendary at cost 16 before clamping, so all three
// pinned to the ceiling. Compressive everywhere (a plain square root) was worse
// in the other direction: it squeezed the base forms as hard as the legendaries
// and dropped 12 of 22 cards onto the same cost of 3.
//
// So the two ranges get different treatment. Base forms are where the roster
// lives and they spread linearly over 1..5. Above that the curve bends and
// approaches CEILING asymptotically, which keeps an evolved form and a
// legendary distinguishable without either running off the scale.
//
// The anchors are measured across the 364 *base forms*, not all 1,149 species:
// anchoring on the whole population put every playable card at 1 or 2, because
// a roster of stage-1 creatures sits at the bottom of a range whose top is
// fully evolved legendaries.
const POWER_LOW = 3.3;
const POWER_HIGH = 9.2;
const COST_LOW = 1;
const COST_HIGH = 5;
/** How much power buys a cost point past POWER_HIGH. Larger is flatter. */
const FALLOFF = 5.5;
const CEILING = 7.5;

/** A card that puts three bodies out is three creatures for one price. */
const BODY_VALUE = 0.5;

/** How much of the price rarity argues for. */
const RARITY_WEIGHT = 0.3;

/** What one evolution step adds to a card's price. */
export const EVOLVE_STEP = 2;

/** What behaviour is worth over and above stats. */
const TRAIT_VALUE = {
  wincon: 1.22, // ignores units: the opponent must answer, not trade
  jumps: 1.12, // crosses the river anywhere, and is bulkier to survive the trip
  flying: 1.15, // same bypass, and only some cards can reach it

  /** Lands anywhere on the board -- Diglett tunnels, Voltorb is thrown. */
  anywhere: 1.13,
};

export interface Traits {
  wincon?: boolean;
  jumps?: boolean;
  flying?: boolean;
  /** Tunnelled or thrown: may be placed anywhere on the board. */
  anywhere?: boolean;
}

/** The only place a card's cost is decided. */
export function costOf(
  info: Species,
  rarity: string,
  count = 1,
  traits: Traits = {},
): number {
  // Defence counts. It was missing, so Roggenrola carried the roster's best
  // armour (8 def, 6 speDef) and paid nothing for it.
  //
  // Attack is weighted by how often it lands, for the same reason. The moment
  // attack rate stopped being a constant, `atk` stopped describing damage
  // output: a Fletchling swinging every 0.88s and an Onix swinging every 1.49s
  // are not the same card at the same attack figure. Without this, speed bought
  // both movement and damage and paid for neither -- and the roster's fastest
  // cards are also several of its cheapest.
  const rateFactor = REFERENCE_RATE / attackRateFor(info.speed);
  let power =
    (info.hp / 30 + (info.atk / 3) * rateFactor + (info.def + info.speDef) / 8) *
    (1 + BODY_VALUE * (count - 1));

  for (const [name, mult] of Object.entries(TRAIT_VALUE)) {
    // A premium for crossing the river anywhere is only honest while crossing
    // anywhere is possible. With `riverBypass` off every creature walks to a
    // bridge, so `jumps` and `flying` buy nothing and must not be charged for.
    if ((name === "jumps" || name === "flying") && !config.riverBypass) continue;
    if (traits[name as keyof Traits]) power *= mult;
  }

  let fromPower: number;
  if (power <= POWER_HIGH) {
    const t = Math.max(0, (power - POWER_LOW) / (POWER_HIGH - POWER_LOW));
    fromPower = COST_LOW + (COST_HIGH - COST_LOW) * t;
  } else {
    const over = 1 - Math.exp(-(power - POWER_HIGH) / FALLOFF);
    fromPower = COST_HIGH + (CEILING - COST_HIGH) * over;
  }

  const fromRarity = tiers.RARITY_COST[rarity] ?? 2;
  const cost = (1 - RARITY_WEIGHT) * fromPower + RARITY_WEIGHT * fromRarity;
  return Math.max(1, Math.min(8, Math.round(cost)));
}

/** Whatever the cost curve compresses, the stats must compress with it. */
export function budgetFactor(power: number, cost: number): number {
  // Only what the *asymptote* discounted. Below POWER_HIGH the curve is linear
  // and honest, so a card there has already paid full price -- correcting it
  // as well would be punishing the rounding of its cost, which cost the cheap
  // cards health they had legitimately bought.
  if (power <= POWER_HIGH) return 1;

  const affordable = POWER_LOW + ((cost - COST_LOW) / (COST_HIGH - COST_LOW)) * (POWER_HIGH - POWER_LOW);
  if (power <= affordable) return 1;
  // Square-rooted so the correction is firm but not flattening: a legendary
  // should still read as a legendary next to a base form.
  return Math.sqrt(affordable / power);
}
