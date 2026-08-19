/** The creature sitting on your lane towers. */

/** A burst weapon: `shots` at the normal rate, then a long reload. */
export interface Volley {
  shots: number;
  reload: number;
}

export interface TowerTroop {
  id: string;
  /** The species whose sprite sits on the mount. Must be terminal and drawable. */
  species: string;
  name: string;
  /** One line, shown under the name when picking. */
  blurb: string;
  hp: number;
  damage: number;
  /** Seconds between shots. */
  rate: number;
  /** How far it shoots past the tower wall, like config.towerReach. */
  reach: number;
  volley?: Volley;
}

/** The default is the plain tower, unchanged. */
export const TROOPS: TowerTroop[] = [
  {
    id: "togekiss",
    species: "togekiss",
    name: "Togekiss",
    blurb: "Steady. No strength, no weakness.",
    hp: 546,
    damage: 28,
    rate: 1.0,
    reach: 144,
  },
  {
    id: "blastoise",
    species: "blastoise",
    name: "Blastoise",
    blurb: "One heavy shell. Breaks tanks, wasted on runners.",
    hp: 588,
    damage: 60,
    rate: 2.2,
    reach: 144,
  },
  {
    id: "crobat",
    species: "crobat",
    name: "Crobat",
    blurb: "Six fast strikes, then a long breath.",
    hp: 525,
    damage: 14,
    rate: 0.22,
    // Designed at 12 damage, 2.6s reload and 132 reach, and it lost 40.5% of
    // 1800 matches against the other three -- a strict downgrade nobody would
    // ever equip. Two penalties had been stacked on one troop: the lowest
    // sustained damage in the set *and* the shortest reach. A sweep put the
    // reach back and widened the magazine until it landed at 48.2%, inside the
    // +/-2.5 noise band. Worth knowing what the reload alone costs: even at a
    // sustained figure matching Togekiss, the dry window still loses a point or
    // two. The gap is the price, not the damage.
    reach: 144,
    volley: { shots: 6, reload: 1.8 },
  },
  {
    id: "alakazam",
    species: "alakazam",
    name: "Alakazam",
    blurb: "Strikes first, from further out. Hits softest.",
    hp: 483,
    damage: 20,
    rate: 1.0,
    reach: 180,
  },
];

export const DEFAULT_TROOP = TROOPS[0].id;

/** Who sits on a king tower. */
export const KING_SPECIES = "mewtwo";

export function troopById(id?: string): TowerTroop {
  return TROOPS.find((t) => t.id === id) ?? TROOPS[0];
}

/** Damage per second if it never stops shooting. */
export function sustainedDps(t: TowerTroop): number {
  if (!t.volley) return t.damage / t.rate;
  const cycle = t.volley.shots * t.rate + t.volley.reload;
  return (t.volley.shots * t.damage) / cycle;
}

/** Damage per second while the magazine lasts. */
export function burstDps(t: TowerTroop): number {
  return t.damage / t.rate;
}
