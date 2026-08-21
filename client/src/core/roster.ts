/** Which creatures are in the game, and the handful of things about them the data cannot say. */

import type { Role } from "./tiers";

/** What a card is willing to attack. */
export type Target = "troop" | "building";

/** How a card arrives, if not by simply appearing. */
export type Delivery = "tunnel" | "throw" | "drop";

export interface Flavour {
  count?: number; flying?: boolean; role?: Role; copies?: boolean;
  delivery?: Delivery; targets?: Target[]; rooted?: boolean;
  /** Override the species' move. See the Eevee block for the only use. */
  skill?: string;
  /** Alternate bodies chosen at the moment of deployment. */
  forms?: readonly string[];
}

/** The playable roster: base forms only. */
export const ROSTER = [
  "eevee", "charmander", "squirtle", "bulbasaur", "pikachu", "machop",
  "zubat", "geodude", "gastly", "abra", "caterpie", "spheal",
  "larvitar", "aron", "togepi", "fletchling", "roggenrola", "bagon",

  // The roster's runner, chosen on the numbers rather than the theme. Ponyta
  // reads like a runner but its stats price it past what a six-card deck can
  // carry. Yamper is the fastest thing with a complete evolution chain (speed
  // 77 against Ponyta's 59), so it crosses in 5.7s and survives 6.9s.
  "yamper",

  // Legendaries: cards you play, not cards you evolve into. All three price at
  // the top of the curve, so cost stops telling them apart and role does the
  // work instead -- Raikou runs at the towers, Entei soaks, Zapdos shoots from
  // the air.
  "zapdos", "raikou", "entei",

  // ------------------------------------------------------------ the gaps
  //
  // Everything above came from one narrow slice of the data: nine fighters and
  // eight skirmishers, which is one archetype with a range slider rather than a
  // counter-web. The set has 405 tanks and 40 artillery available; we had one
  // of each. These are drawn deliberately against the roles we were missing.

  // Artillery -- outranges a tower's own 120, so it can siege from safety.
  "clauncher", "elgyem", "chinchou",
  // Tanks: big bodies that soak while something behind them does the work.
  //
  // They are NOT win conditions, whatever an earlier version of this comment
  // claimed. A win condition in the Clash Royale sense ignores troops and walks
  // at buildings, and no card here does -- all 57 carry `targets:
  // ["troop","building"]`, so `wincon` is derived as false for every one of them
  // and the x1.22 premium in pricing.ts has never been charged. The engine
  // supports it (combat.ts walks a building-only unit past troops); nothing has
  // been given it yet.
  "onix", "bronzor", "beldum",
  // Swarm bodies, cheap and fast. Nothing on the roster punished a single
  // expensive unit, because nothing came in numbers.
  "rattata", "spearow", "exeggcute",
  // Fliers, which skip the bridge entirely -- still the biggest tempo edge in
  // the game, and now something other than Gastly has it.
  "pidgey", "hoppip", "koffing",
  // Ground types for the burrower role, and a ghost for the swarm-of-souls
  // shape. Diglett is the one that matters: see FLAVOUR.
  "diglett", "drilbur", "sandshrew", "trapinch", "voltorb", "duskull",
  // A building that does not move -- and now actually does not, see `rooted`
  // in FLAVOUR. Sudowoodo is a tree pretending to be a Pokemon, which is
  // exactly the joke a static defence wants to be.
  "sudowoodo",

  // ------------------------------------------------- the status carriers
  //
  // Six chains added for one reason: nothing on the roster could cause burn,
  // poison, sleep, freeze, charm or silence, so six of the ten statuses the
  // system supports were unreachable. Each is here because its own real move
  // causes the one we were missing -- Fire Fang burns, Sludge poisons, Dream
  // Eater puts things to sleep -- not because a status was assigned to it.
  //
  // Chosen for complete art as much as for the move. Hatenna carries silence
  // too and is the better-known creature, but Hatterene ships without an Attack
  // animation and is melee, so it would have stood still swinging nothing.
  "growlithe",    // Fire Fang    -> burn
  "grimer",       // Sludge       -> poison
  "drowzee",      // Dream Eater  -> sleep
  "seel",         // Aurora Beam  -> freeze
  "marill",       // Play Rough   -> charm
  "hippopotas",   // Sand Tomb    -> silence

  // The counter-web. `npm run coverage` measured 17.1% of enemy forms with no
  // answer in an average deck -- Snorlax had none in 86%, since pure NORMAL is
  // answered only by FIGHTING and we carried one Fighting chain. Now 11.0%.
  // Picked by the tool, which ranks on blindness removed and skips forms with
  // no Attack animation.
  "sewaddle",     // GRASS/BUG
  "ledyba",       // BUG/FIGHTING/FLYING -- Fighting, which NORMAL needed
  "paras",        // BUG/POISON/GRASS
  "bounsweet",    // GRASS/FIGHTING
  "dunsparce",    // NORMAL/GROUND/BUG, and terminal: no evolution at all
  "chespin",      // GRASS/FIGHTING
  "sandile",      // DARK/GROUND
  "rowlet",       // GRASS/FLYING/GHOST -- the Ghost supply


  // ------------------------------------------------ competitive staples
  //
  // Chosen from a VGC usage list rather than by what the data made convenient,
  // which is how the first 49 were picked and why the roster read as one
  // archetype with a range slider. Usage is a better signal than any metric we
  // can compute: it says which creatures people actually want to play.
  //
  // Most are a cheap base that grows into the famous thing -- Gible into
  // Garchomp, Magikarp into Gyarados, Dreepy into Dragapult -- so they arrive at
  // the bottom of the curve and pay off late, which is what evolution is for.
  // The single-stage ones (Gardevoir, Scizor, Mimikyu, Skarmory, Heracross)
  // are the only cards that genuinely cost 6 with no chain, and they are the
  // roster's first real weight at the top.
  "pawniard", "gible", "litten", "cottonee", "snorunt", "capsakid",
  "dratini", "girafarig", "duraludon", "fennekin", "rookidee", "wingull",
  "glimmet", "deino", "finizen", "feebas", "honedge", "mareanie",
  "magikarp", "swinub", "larvesta", "tinkatink", "sneasel", 
  "dreepy", "piplup", "crabrawler", "cleffa", "litwick", 
  "popplio", "snivy", "dewpider", "riolu", "staryu", "aerodactyl",
  "vivillon", "politoed", "ceruledge", "gardevoir", "kangaskhan",
  "scizor", "torkoal", "mimikyu", "kleavor", "skarmory", "orthworm",
  "gallade", "heracross", "armarouge",

  // ----------------------------------------------------------- legendaries
  //
  // Twenty-two, and the count is the decision. Cost cannot tell them apart:
  // legendary power spans 13.4 to 27.1 and the curve's asymptote maps all of
  // it onto 7, so a Regigigas at 400 health prices the same as a Xurkitree at
  // 200. Rarity is not the cause -- power alone gives the same answer. That is
  // a real ceiling on how many can be interesting, so these are picked for
  // *distinctness*: seventeen of them fill a type the counter-web was thin in,
  // six are Dragons, three are Ice.
  //
  // Trios are complete or absent. An earlier draft took Articuno without
  // Moltres and Regice without its two, on type coverage alone -- a missing
  // member is noticed in a way a missing type never is.
  //
  //   birds    articuno, zapdos, moltres
  //   beasts   raikou, entei, suicune
  //   golems   regirock, regice, registeel
  "mew", "deoxys", "lugia", "giratina", "dialga", "palkia",
  "suicune", "articuno", "moltres", "celebi", "jirachi", "darkrai",
  "xerneas", "yveltal", "zekrom", "reshiram", "kyurem", "magearna",
  "marshadow", "regirock", "regice", "registeel",

  // The copy. Priced and explained in FLAVOUR.
  "ditto",

  // The three deliveries. Diglett tunnels, Voltorb is thrown, Snorlax falls --
  // see FLAVOUR for why each one arrives the way it does.
  "snorlax",
];

export const FLAVOUR: Record<string, Flavour> = {
  zubat: { count: 2, flying: true },
  // One ghost, not two. Pricing it correctly (3 -> 5) only moved its win rate
  // from 86% to 79%, so cost was never the problem: two *flying* ranged bodies
  // were. Fliers ignore the bridge and go straight for a tower while ground
  // units detour to cross, and doubling that tempo advantage is what no other
  // card could answer.
  gastly: { count: 1, flying: true },
  caterpie: { count: 2 },
  rattata: { count: 3 },

  /** Ditto copies whatever you played last, and costs one more than it did. */
  // Rooted is off until the card works. Reach comes from the role, and a
  // building with a fighter's 15 units cannot hit anything that is not already
  // touching it -- so it stood still, out of range, and died having done
  // nothing. It walks again until it has a building's reach to go with it.
  // sudowoodo: { rooted: true },

  ditto: { count: 1, copies: true },

  /** Diglett digs, so it surfaces wherever it likes. */
  diglett: { delivery: "tunnel" },

  /** Voltorb is thrown, because it is a ball. */
  voltorb: { delivery: "throw" },

  /** Snorlax falls out of the sky, and lands like it. */
  snorlax: { delivery: "drop" },

  /** The card that goes for the building and nothing else. */
  yamper: { targets: ["building"] },

  /** Deoxys picks a body on the way down, every single time. */
  deoxys: {
    forms: ["deoxys", "deoxysattack", "deoxysdefense", "deoxysspeed"],
  },

  /** The Speed form has to actually be the fastest, and derivation said no. */
  deoxysspeed: { role: "runner" },

  /** Eevee's branches, given moves that mean something here. */
  eevee: { count: 2 },
  vaporeon: { skill: "WATER_PULSE" },
  jolteon: { skill: "THUNDER" },
  flareon: { skill: "FIRE_FANG" },
  espeon: { skill: "DREAM_EATER" },
  umbreon: { skill: "BITE" },
  leafeon: { skill: "MAGICAL_LEAF" },
  glaceon: { skill: "AURORA_BEAM" },
  sylveon: { skill: "PLAY_ROUGH" },
};
