/** Cards are creatures, built from the stat data rather than hand-authored. */

import { SPECIES, typesOf } from "./species";
import * as tiers from "./tiers";
import { ROSTER, FLAVOUR, type Target, type Delivery } from "./roster";
import { costOf, budgetFactor, EVOLVE_STEP } from "./pricing";
import {
  HP_SCALE, DAMAGE_SCALE, SPEED_SCALE, deployDelayFor, massFor, attackRateFor,
} from "./stats";
import type { Role } from "./tiers";
import { config } from "./config";


export interface Card {
  id: string;
  name: string;
  elixir: number;
  count: number;
  hp: number;
  damage: number;
  attackRate: number;
  speed: number;
  range: number;
  aggro: number;
  flying: boolean;
  types: string[];
  sheet: string;
  stage: number;
  skill: string;
  /** Bodies this card may be deployed as, chosen per play. Empty for most. */
  forms: readonly string[];
  rarity: string;
  role: Role;
  /** What this card is willing to attack. */
  targets: Target[];
  jumpsRiver: boolean;
  def: number;
  speDef: number;
  castEvery: number;
  /** Seconds after landing before it can move or fight. */
  deployDelay: number;
  /** How hard this creature is to shove, 0.5 to 2. */
  mass: number;
  /** Deploys as a copy of the last card its owner played, for one more elixir. */
  copies?: boolean;
  /** How this card arrives, if not by simply appearing. */
  delivery?: Delivery;
  /**
   * A shiny pull, or a shiny the player owns.
   *
   * Absent rather than false for the common case, the way `copies` and
   * `delivery` already do it here: most cards never carry this flag at all,
   * and giving every card in the roster an explicit `shiny: false` would
   * make a diff of this file when the feature shipped touch every card
   * definition instead of none of them.
   */
  shiny?: boolean;

  /**
   * Which face this pull wears -- an index into `EMOTIONS` in `ui/emotions.ts`.
   *
   * Absent means the default face, which is what every card in the roster is.
   * Only a pull carries one, and the same creature in two different emotions is
   * two different things to own.
   */
  emotion?: number;
}


/** Hand-set feel, for the two things a role cannot express: how many bodies a card puts out, and whether it flies. */

/** Free placement -- the rule the own-half check defers to. */
// Pricing lives in pricing.ts now, but it was always part of this module's
// surface -- the Pokedex and three tools ask cards what a species would cost.
export { costOf, type Traits } from "./pricing";
export { attackRateFor } from "./stats";

export type { Target, Delivery } from "./roster";

export function arrivesAnywhere(d?: Delivery): boolean {
  return d === "tunnel" || d === "throw";
}




/** Build a card for any species. */
/**
 * What a card calls itself.
 *
 * Species keys have no spaces -- `megacharizard`, `primalkyogre` -- so simply
 * capitalising the first letter gave "Megacharizard" on every transformation.
 * The prefix is split off so the card reads the way the creature is named.
 */
function displayName(key: string): string {
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  for (const prefix of ["mega", "primal"]) {
    const rest = key.slice(prefix.length);
    // The remainder has to be a species in its own right. Without that check
    // Meganium -- a real creature, no relation -- came out as "Mega Nium".
    if (key.startsWith(prefix) && rest && SPECIES[rest]) {
      return `${cap(prefix)} ${cap(rest)}`;
    }
  }
  return cap(key);
}

export function build(name: string, from?: Card): Card | undefined {
  const info = SPECIES[name];
  if (!info) return undefined;

  const flav = FLAVOUR[name];
  const rarity = tiers.rarityOf(name);
  // Role is re-derived rather than inherited. Small fighters cross into tank at
  // stage two as their defence and bulk pass the threshold -- Geodude to
  // Graveler, Machop to Machoke. That progression is worth having.
  const role = flav?.role ?? tiers.roleOf(name);

  // Resolved before it is needed twice: the delivery decides both the card's
  // trait and its minimum flight time, and reading `flav` for one and the
  // inherited value for the other is how an evolved Electrode kept the throw
  // but lost the 1.5s arc that makes a throw answerable.
  const delivery = flav?.delivery ?? from?.delivery;

  let flying = flav?.flying ?? from?.flying ?? false;
  // How many bodies a card puts down is the card's identity, and evolution does
  // not change it.
  //
  // This used to shrink the crowd by 0.7 a stage, on the reading that an evolved
  // form is one bigger creature rather than the same swarm of them. It reads
  // fine as prose and plays badly: a player levelling Zubat watched a two-body
  // card become a one-body card and reported it as a bug, which is the right
  // call. Levelling is supposed to make a card stronger, and rounding meant the
  // loss landed as a cliff -- 2 -> 1 is half the card gone in one step.
  //
  // Keeping the count is affordable because `costOf` below is given it: two
  // Golbats cost more elixir than one, so the extra body is bought rather than
  // granted. The swarm archetype also survives its own chain now, where before
  // every swarm converged on a single body by its last stage.
  const count = flav?.count ?? from?.count ?? 1;

  // Wings are read from the typing rather than guessed: Charizard flies because
  // its data says Flying, not because someone remembered to say so.
  //
  // Uppercase. The LÖVE version tested for "Flying" while typesOf returned
  // "FLYING", so this branch never once fired and the only cards that flew were
  // the two with a hand-set flag. Fletchling -- a bird -- walked.
  const types = typesOf(name);
  if (types.includes("FLYING")) flying = true;

  const runner = tiers.isRunner(role, flying);
  const shape = tiers.ROLE_STATS[role] ?? tiers.ROLE_STATS.fighter;

  // What this card will attack, resolved here rather than at the bottom of the
  // return because the price depends on it.
  const targets = flav?.targets ?? from?.targets ?? ["troop", "building"];

  // A win condition is a card the opponent must *answer*, because it will not
  // trade: it walks past their army at the tower. So the premium is read off
  // the one thing that decides that -- whether the card will attack troops at
  // all -- and not off its role.
  //
  // Role used to decide it, via `ignoresUnits(role)`, and that survived the
  // targets refactor as a leftover. It charged x1.22 to every tank and every
  // runner for a behaviour the refactor had deleted: 11 of 43 cards paying a
  // 22% tax while all 43 fought everything, six of them a full elixir over.
  // Yamper, Sandshrew and Voltorb were 3 where they should have been 2.
  //
  // Derived this way it cannot drift again. No card that fights troops pays
  // it, and the day one is given `targets: ["building"]` it starts paying
  // without anyone remembering to say so.
  const wincon = !targets.includes("troop");

  // An evolution costs a flat step more than the form it grew out of.
  //
  // Pricing each stage from its own stats independently is more accurate and
  // played worse, for two reasons that both come out of the cost curve's
  // asymptote. Cheap lines were fine -- Charmander 1 -> 3 -> 5 is the shape
  // everyone expects -- but the step ran anywhere from +0 to +3, so there was
  // no way to plan an elixir curve around evolving. Worse, four chains had a
  // *free* last stage: Gastly 5 -> Haunter 6 -> Gengar 6, and the same at the
  // top of Onix, Fletchling and Beldum. Every high-power species converges on
  // the same CEILING, so the strictly better form cost exactly nothing.
  //
  // The free upgrade was only half the damage. `budgetFactor` scales a card's
  // health and damage down to what its price affords, so a Gengar pinned at
  // Haunter's cost was also pinned near Haunter's power -- the evolution
  // charged nothing and delivered little. Charging the step raises what the
  // form can afford, so it keeps more of its own statline: the fix to the
  // price is the fix to the payoff.
  //
  // Clamped rather than allowed to run off the top, so a 5-cost base form
  // reaches 7 and then 8 instead of an unplayable 9.
  const elixir = from
    ? Math.min(8, from.elixir + EVOLVE_STEP)
    : costOf(info, rarity, count,
        { wincon, jumps: runner, flying, anywhere: arrivesAnywhere(delivery) });
  const rawPower = info.hp / 30 + info.atk / 3 + (info.def + info.speDef) / 8;
  const budget = budgetFactor(rawPower, elixir);

  return {
    id: name,
    name: displayName(name),
    elixir,
    count,
    hp: Math.floor(info.hp * HP_SCALE * budget * (runner ? tiers.RUNNER_HP_BONUS : 1)),
    damage: Math.floor(info.atk * DAMAGE_SCALE * budget),
    attackRate: attackRateFor(info.speed),
    // Movement is PAC's declared per-species speed scaled into world units. It
    // used to be derived from evolution stage, which made every Rattata and
    // every Geodude of the same stage move identically.
    // A rooted card is a building: it holds ground and never advances.
    //
    // The roster has described Sudowoodo as "a building that does not move"
    // since it was added, and it was not one -- its card speed was 10.5,
    // identical to Onix, so the tree walked. `tiers.traitsOf` reported `static`
    // off a species-speed threshold nothing in movement read, so the Pokedex
    // agreed with the comment and the game did not.
    //
    // Zero needs no special case in the mover: every step multiplies by speed,
    // so it simply never advances, and separation and crowding fall out the
    // same way. It still turns, targets and fights whatever comes to it.
    speed: flav?.rooted
      ? 0
      : info.speed * SPEED_SCALE * (runner ? tiers.RUNNER_SPEED_BONUS : 1),
    // Reach always comes from the role, so what a card says it is and how it
    // fights can never drift apart. It used to be a `ranged` boolean that
    // quietly won over the role, so Abra was labelled artillery and then fought
    // at skirmisher range. A label that lies is worse than no label.
    range: shape.range,
    aggro: shape.aggro,
    flying,
    types,
    sheet: name,
    stage: info.stars,
    skill: flav?.skill ?? info.skill,
    forms: flav?.forms ?? from?.forms ?? [],
    rarity,
    role,
    targets,
    jumpsRiver: runner,
    def: info.def,
    speDef: info.speDef,
    castEvery: tiers.attacksToCast(name),
    // A delivered card is in the air for at least as long as its arc needs,
    // which is also the window the opponent gets to answer it.
    deployDelay: delivery
      ? Math.max(deployDelayFor(name, info.hp), config.deliveryTime[delivery])
      : deployDelayFor(name, info.hp),
    mass: massFor(name, info.hp),
    copies: flav?.copies,
    // Inherited, like flying. How a card arrives is a property of the line,
    // not of one form: a Voltorb you can throw becomes an Electrode you can
    // throw, and a Diglett that tunnels becomes a Dugtrio that tunnels. Read
    // from FLAVOUR alone, evolving silently deleted the card's whole identity
    // -- the roster entry names the base form, so no evolved form ever had one.
    delivery,
  };
}

/** The playable roster, cheapest first. */
export const ALL: Card[] = ROSTER
  .map((name) => build(name))
  .filter((c): c is Card => c !== undefined)
  .sort((a, b) => a.elixir - b.elixir);

export function byId(id: string): Card | undefined {
  return ALL.find((c) => c.id === id);
}

/** A deck drawn at random from the roster. */
export function newDeck(rng: () => number = Math.random): Card[] {
  const pool = [...ALL];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, Math.min(config.deckSize, pool.length));
}
