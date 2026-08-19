/** The species table and the type chart. */

import speciesJson from "../data/species.json";
import abilitiesJson from "../data/abilities.json";
import typeChartJson from "../data/typeChart.json";

export interface Species {
  types: string[];
  stars: number;
  hp: number;
  atk: number;
  def: number;
  speDef: number;
  speed: number;
  maxPP: number;
  range: number;
  skill: string;
  rarity: string;
  evolution?: string;
}

export interface Ability {
  /** One figure per evolution stage. */
  damage: number[];
  /** PHYSICAL is reduced by def, SPECIAL by speDef, TRUE by neither. */
  attackType: "PHYSICAL" | "SPECIAL" | "TRUE";
  scalesWithAttack?: boolean;
}

export const SPECIES = speciesJson as unknown as Record<string, Species>;
export const ABILITIES = abilitiesJson as unknown as Record<string, Ability>;

const CHART = typeChartJson.chart as Record<
  string,
  { strong?: string[]; weak?: string[]; immune?: string[] }
>;
// PAC's own synergy list (FLORA, FIELD, MONSTER, AMORPHOUS...) is not the
// standard type set, so matching on it directly produced nonsense -- a 4x
// multiplier out of GRASS against FIELD. CANON maps its names onto real types
// and EXTRA fills in the ones it has no synergy for at all.
const CANON = typeChartJson.canon as Record<string, string>;
// A few species carry their element only as flavour in the source data.
const EXTRA = typeChartJson.extra as Record<string, string>;
export const TYPE_COLORS = typeChartJson.colors as Record<string, number[]>;
export const TYPE_SHORT = typeChartJson.short as Record<string, string>;

export function speciesOf(name: string): Species | undefined {
  return SPECIES[name];
}

/** Real types for a species, after mapping PAC's synergies onto the chart. */
export function typesOf(name: string): string[] {
  const out: string[] = [];
  for (const raw of SPECIES[name]?.types ?? []) {
    // Types with no canonical mapping are dropped, not passed through: PAC's
    // synergy list carries things like AMORPHOUS and MONSTER that are not
    // types at all, and letting them through produced matchups from nothing.
    const canon = CANON[raw];
    if (canon && !out.includes(canon)) out.push(canon);
  }
  const extra = EXTRA[name];
  if (extra && !out.includes(extra)) out.push(extra);
  return out;
}

/** How hard `attacker` hits `defender`, as a multiplier. */
export function typeMultiplier(attacker?: string, defender?: string): number {
  if (!attacker || !defender) return 1;
  const defTypes = typesOf(defender);
  if (defTypes.length === 0) return 1;

  const atkTypes = typesOf(attacker);
  let best = 0;
  for (const atk of atkTypes) {
    const row = CHART[atk];
    if (!row) continue;
    let mult = 1;
    for (const def of defTypes) {
      if (row.immune?.includes(def)) mult = 0;
      else if (row.strong?.includes(def)) mult *= 2;
      else if (row.weak?.includes(def)) mult *= 0.5;
    }
    if (mult > best) best = mult;
  }
  // No usable attacking type is neutral, not harmless.
  if (best === 0 && atkTypes.length === 0) return 1;
  return best;
}

export function effectivenessLabel(mult: number): string {
  if (mult === 0) return "No effect";
  if (mult >= 4) return "Devastating!";
  if (mult > 1) return "Super effective";
  if (mult < 1) return "Not very effective";
  return "";
}
