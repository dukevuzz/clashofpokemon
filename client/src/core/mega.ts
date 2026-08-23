/**
 * Mega Evolution: a button, not an evolution.
 *
 * Slot one of the deck is the Mega slot, chosen when the deck is built. If that
 * card is on the board and you can pay, the button turns a unit already
 * fighting into its Mega form -- bigger stats, its own sprite, for the rest of
 * that unit's life. One at a time, per side.
 *
 * Deliberately *not* wired into `evolution.ts`. PAC's data had
 * `steelix.evolution = "mega_steelix"`, which meant Onix already Mega'd for
 * free by playing it enough; that link is removed so all eleven cost the same.
 */

import { config, type Side } from "./config";
import * as cards from "./cards";
import * as evolution from "./evolution";
import type { Card } from "./cards";
import type { Match, Unit } from "./match";

/**
 * Base form -> Mega form, for the eleven with real PMD art.
 *
 * Written out rather than derived from a `mega` prefix: the species table
 * carries Mega entries for creatures this game cannot reach, and a prefix rule
 * would offer those too.
 */
export const MEGA: Readonly<Record<string, string>> = {
  absol: "megaabsol",
  aerodactyl: "megaaerodactyl",
  alakazam: "megaalakazam",
  altaria: "megaaltaria",
  banette: "megabanette",
  camerupt: "megacamerupt",
  charizard: "megacharizard",
  darkrai: "megadarkrai",
  diancie: "megadiancie",
  dragalge: "megadragalge",
  drampa: "megadrampa",
  eelektross: "megaeelektross",
  excadrill: "megaexcadrill",
  floette: "megafloette",
  gallade: "megagallade",
  gardevoir: "megagardevoir",
  gengar: "megagengar",
  glalie: "megaglalie",
  groudon: "primalgroudon",
  houndoom: "megahoundoom",
  kangaskhan: "megakangaskhan",
  kyogre: "primalkyogre",
  latias: "megalatias",
  latios: "megalatios",
  lopunny: "megalopunny",
  lucario: "megalucario",
  manectric: "megamanectric",
  mawile: "megamawile",
  medicham: "megamedicham",
  mewtwo: "megamewtwo",
  rayquaza: "megarayquaza",
  sableye: "megasableye",
  skarmory: "megaskarmory",
  steelix: "megasteelix",
  tatsugiri: "megatatsugiri",
  tyranitar: "megatyranitar",
  zeraora: "megazeraora",
  zygarde: "megazygarde",
};

/** Every Mega form, for the loader -- these are not in any evolution chain. */
export const MEGA_FORMS: readonly string[] = Object.values(MEGA);

/** What this card becomes, if anything. */
export function megaOf(card?: Card): Card | undefined {
  const id = card && MEGA[card.id];
  return id ? cards.build(id) : undefined;
}

/**
 * Can a deck slot ever Mega?
 *
 * Asked of the card in the deck, which is usually a *base* form -- Charmander,
 * not Charizard. Seven of the eleven are only ever reached by evolving, so
 * testing the slot's own id would have offered the button to the four final
 * forms and silently refused the rest.
 */
export function canEverMega(card?: Card): boolean {
  if (!card) return false;
  return evolution.chainOf(card.id).some((f) => f in MEGA);
}

/**
 * Which unit the button would transform.
 *
 * Exactly one, or none. With two of the card on the board there is no way to
 * say which you meant, and guessing -- the furthest forward, the healthiest --
 * spends three elixir on a unit you did not choose. The button goes dark
 * instead, which makes fielding a second one a deliberate trade rather than a
 * silent loss of the ability.
 */
export function megaTarget(match: Match, side: Side): Unit | undefined {
  const slot = match.megaPick[side];
  if (!canEverMega(slot)) return undefined;
  if (match.units.some((u) => u.side === side && u.mega)) return undefined;
  // Only a form this deck slot can actually reach, so a Charizard the opponent
  // left behind is not a legal target for a deck built around Gastly.
  const reachable = new Set(evolution.chainOf(slot!.id));

  let found: Unit | undefined;
  for (const u of match.units) {
    if (u.side !== side || u.dead || u.mega) continue;
    if (!reachable.has(u.card.id) || !(u.card.id in MEGA)) continue;
    if (found) return undefined;      // ambiguous: two of them are out
    found = u;
  }
  return found;
}

/** Is the button live right now? */
export function canMega(match: Match, side: Side): boolean {
  return match.elixir[side] >= config.megaCost && megaTarget(match, side) !== undefined;
}

/**
 * Transform, keeping the damage already taken.
 *
 * Health carries across as a fraction rather than a number: a Mega pressed on
 * a unit at half health arrives at half health, so the button rescues a push
 * without also being a heal.
 */
export function mega(match: Match, side: Side): Unit | undefined {
  if (!canMega(match, side)) return undefined;
  const unit = megaTarget(match, side)!;
  const form = megaOf(unit.card);
  if (!form) return undefined;

  match.elixir[side] -= config.megaCost;
  match.note("mega.cast", "discrete", side, { from: unit.card.id, to: form.id });

  const fraction = unit.maxHP > 0 ? unit.hp / unit.maxHP : 1;
  unit.card = form;
  unit.maxHP = form.hp;
  unit.hp = Math.max(1, Math.round(form.hp * fraction));
  unit.damage = form.damage;
  unit.range = form.range;
  unit.aggro = form.aggro;
  unit.speed = form.speed;
  unit.attackRate = form.attackRate;
  unit.castEvery = form.castEvery;
  unit.targets = form.targets;
  unit.def = form.def;
  unit.speDef = form.speDef;
  unit.mass = form.mass;
  unit.mega = true;

  match.events.push({ type: "mega", side, unit, from: form.id });
  return unit;
}
