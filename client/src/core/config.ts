/** Match rules for a two-lane tower battler. */

export const config = {
  // ------------------------------------------------------------------ arena
  // World units, deliberately small: the arena is scaled to fill the window,
  // so fewer units across means everything drawn inside it reads larger.
  // Multiples of the 24px terrain tile, because at 300x520 the two lanes
  // landed at different offsets inside their tiles and the left road was
  // visibly narrower than the right.
  // 16 x 28 tiles. Aspect 1.75 against Clash Royale's 1.78 -- the shape was
  // never the problem, the SIZE was. At 12 x 22 each half was 11 tiles deep
  // against their 16, leaving only 5.5 tiles behind a tower, so a tower sat
  // crowded against its own baseline with nowhere to defend from.
  //
  // Chosen so the board does not shrink on screen: the arena is scaled to fit
  // the available height, so a taller board draws smaller. 16 x 28 comes out at
  // 455px wide in a 620px design space, slightly wider than the 434px of the
  // old 12 x 22. 14 x 28 would have been 398 -- more depth, narrower board.
  arenaWidth: 384,
  arenaHeight: 672,
  riverY: 336,
  /** How deep the water is, and it is not cosmetic. */
  riverHeight: 72,

  /** The two crossings, and the only places ground troops may pass. */
  bridgeX: [80, 304] as const,
  /** Half a bridge's width, so a span is 32 units against a 24-unit body. */
  bridgeHalfWidth: 16,

  /** How far short of the bank a ground unit lines up with the bridge. */
  bridgeApproach: 14,

  /** How fast a thrown card flies, in board units a second. */
  throwSpeed: 415,
  /** Even a throw at your own feet leaves the hand. */
  throwMinTime: 0.45,

  /** Whether anything may cross the river away from a bridge. */
  riverBypass: false,

  /** How long a river-jumper spends in the air. */
  leapTime: 0.55,

  /** How fast a shot crosses the gap, before the shooter's own speed is applied. */
  projectileSpeed: 190,
  // 19.5% in from each edge, Clash Royale's proportion, so the lanes are as far
  // apart relative to the board as theirs.
  laneX: [75, 309] as const,

  /** A creature's footprint: how much board one body occupies, in world units. */
  unitSize: 24,

  /** How close two bodies may stand, as a fraction of a footprint. */
  crowding: 0.82,

  /** The sprite body size, in source pixels, that draws exactly one footprint across. */
  referenceBody: 21,

  /** How much board a tower occupies, in world units. */
  towerSize: { side: 64, king: 85 },

  /** How far a tower's stonework reaches above and below its own position. */
  towerBox: {
    // Symmetric, though the art is not.
    //
    // These were the drawn shape: a spire with a staircase below, so `down` was
    // larger. The physics box is not mirrored per side and the art is not
    // either, so both towers' staircases point the same way -- and an attacker
    // meets whichever face happens to point at it. Yours climbs toward their
    // tower from below and is held off by the 57-unit staircase; theirs comes
    // down onto yours and is held at 41 by the plate.
    //
    // Measured, that is 36 units sideways and 30 vertical for your creature
    // against 0 and 47 for theirs: yours cannot reach straight on, so it slides
    // around the side to find range while theirs stands square. A player
    // spotted it immediately -- "my pokemon has to go to left or right side to
    // attack, but enemy pokemon are correct straight up to tower".
    //
    // Fairness beats matching the drawing. The staircase is decoration; the
    // clearance a fight happens at is a rule, and a rule that differs by which
    // end of the board you started at is not one.
    side: { up: 41, down: 57 },
    king: { up: 61, down: 93 },
  },

  /** How far each tower sits from its own back edge. */
  towerBackOff: { side: 168, king: 52 },

  // --------------------------------------------------------------- resource
  elixirMax: 10,
  // One elixir every 2.5s. Swept from 0.34 to 0.72 against the simulator: the
  // rate is the tempo dial and it shows up as how crowded the board gets --
  // 10.6 units on average at 0.72, 7.2 at 0.40. At the fast end you react to a
  // scrum; here you choose. It also makes the last minute mean something,
  // since doubling 0.40 is a gear change you feel and doubling 0.72 was noise.
  elixirRate: 0.4,
  startElixir: 5,

  // ------------------------------------------------------------------ match
  matchSeconds: 180,
  suddenDeathAt: 60, // last minute: double elixir

  // ----------------------------------------------------------------- towers
  //
  // Health and damage do different jobs, and it is worth being precise about
  // which one to reach for:
  //
  //   health  = how big a PUSH must be to take a tower
  //   damage  = how badly an UNSUPPORTED attacker is punished
  //
  // The problem was a single 7-cost legendary soloing a tower in 9 seconds.
  // That reads like a damage problem and is not: swept from 34 to 52 -- a 53%
  // buff -- and Raikou still soloed, because 886 health simply absorbs it. What
  // actually governs a solo is whether the tower outlasts one unit's damage
  // output, and that is health.
  //
  // Re-tuned after movement speed was halved. Slower units sit under tower
  // fire for roughly twice as long on the approach, which is an effective
  // doubling of tower damage that nobody chose: at the old 2000/34 only 20% of
  // matches ended with a king down and 80% went to the clock, so pushes stopped
  // landing and the game became a chip-damage contest.
  //
  // 1300 health and 28 damage restores a 55/45 split between destruction and
  // the clock. The correction is split across both levers rather than taken out
  // of one, because both were mis-set by the same cause.
  //
  // 950 -> 2000 was picked off a sweep, not a feel. At 2000 a 9-elixir push
  // (Pikachu + Larvitar + Machop) takes a tower in 25 seconds, which is the
  // same as a lone legendary -- the relationship a win condition should have to
  // a push. At 2400 three matches in fourteen ran out of clock; at 1700 three
  // separate cards soloed. This is the only value in the range that does
  // neither.
  //
  // Armour was tried here first and removed. It is mathematically identical to
  // scaling health -- 20 armour is exactly 2x health through the mitigation
  // formula -- so keeping both meant two knobs for one job, and health is the
  // one written on the bar the player is reading.
  /** Retuned when nothing walks past troops any more. */
  towerHP: { side: 546, king: 2402 },
  towerDamage: { side: 28, king: 33 },
  /** 161 world units, which is 6.7 of our 24-unit tiles. */
  /**
   * How far off its line of march a creature will look, in degrees.
   *
   * A half-angle from forward, so this is the *whole* circle: 180 either way.
   * Not 360 -- `cos(360°)` is 1, which would accept nothing at all and leave
   * every unit walking to a tower ignoring the army around it.
   *
   * It was 110 (a 220° cone, 140° blind behind), which meant a Pokemon
   * deployed behind another was invisible to it no matter how close, and
   * something walking up from behind was never answered. Clash Royale targets
   * in a full circle and the game reads better for it: what is nearest is what
   * you fight.
   */
  aggroArc: 180,

  /** What a dropped creature does to the ground it lands on. */
  dropImpact: { radius: 36, damage: 1.6 },

  /**
   * How fast a tunneller travels underground, in units per second.
   *
   * Clash Royale's Miner is the model: he digs from his own king tower to
   * wherever you put him and cannot be touched on the way. The whole board is
   * 672 deep, so the longest dig -- your king to their far corner -- runs
   * about 1.8 seconds at this speed, and a short one is floored by
   * `deliveryTime.tunnel` so it never reads as teleporting.
   */
  tunnelSpeed: 380,

  /** How long a delivered card is in the air, at minimum. */
  deliveryTime: { tunnel: 1.2, throw: 1.5, drop: 2.2 },

  towerReach: 144,
  towerRate: 1.0,
  /** How long a king takes to come online after it is woken. */
  kingWakeSeconds: 4.0,

  // ------------------------------------------------------------------- deck
  // Deck length governs how fast a card comes back around and therefore how
  // fast anything evolves. It was eight, and eight was measurably worse: the
  // curve is flat early, nobody could break a tower, and three matches in ten
  // ended as draws. At six, ten in ten were decisive.
  deckSize: 6,
  handSize: 4,

  // --------------------------------------------------------------- specials
  // A unit charges one point per attack and casts at its own maxPP/10. Charging
  // on attacks rather than on a timer means a unit that is fighting earns its
  // special and one walking down an empty lane does not.
  skillDamage: 2.4, // fallback only, for abilities PAC gives no figure for
  skillRadius: 26,

  /** You may only deploy on your own half, until you break a tower. */
  deployMargin: 40,
  /** Elixir to Mega the deck's first card, once it is on the board. */
  megaCost: 3,

  PLAYER: 1,
  ENEMY: 2,
} as const;

export type Side = 1 | 2;

/** How far a tower shoots, measured from its centre -- which is what the targeting code needs, and what a range circle draws. */
export function towerRangeOf(kind: "side" | "king"): number {
  return config.towerReach + config.towerSize[kind] * 0.5;
}

/** The lane tower's range. */
export const towerRange = (): number => towerRangeOf("side");

/** Players walk up the board, the opponent walks down. */
export function forwardFor(side: Side): -1 | 1 {
  return side === config.PLAYER ? -1 : 1;
}
