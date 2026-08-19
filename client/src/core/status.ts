/** Status effects, and the one rule about them: a plain attack never causes one. */

export type StatusKind =
  | "paralysis"
  | "flinch"
  | "confusion"
  | "armorBreak"
  | "burn"
  | "poison"
  | "sleep"
  | "freeze"
  | "silence"
  | "charm";

export interface Status {
  kind: StatusKind;
  /** Seconds left. Counted down in updateUnit. */
  left: number;
  /** Who did it. */
  by?: number;
  /** Seconds until the next burn or poison tick. */
  tick?: number;
}

/** What a move does to what it hits. Absent means the move is damage only. */
export interface StatusEffect {
  kind: StatusKind;
  seconds: number;
  /** 1 means it always lands. PAC rolls for only three of ours. */
  chance: number;
}

/** Move -> status, taken from PAC's ability strategies. */
export const MOVE_STATUS: Record<string, StatusEffect> = {
  // Always.
  BITE: { kind: "flinch", seconds: 5.0, chance: 1 },
  NUZZLE: { kind: "paralysis", seconds: 3.0, chance: 1 },
  HURRICANE: { kind: "paralysis", seconds: 3.0, chance: 1 },
  STRING_SHOT: { kind: "paralysis", seconds: 5.0, chance: 1 },
  MAGICAL_LEAF: { kind: "armorBreak", seconds: 3.0, chance: 1 },

  // The six added to cover statuses nothing on the roster could cause. Same
  // source: PAC's own strategies, with its stage-one durations where the
  // duration there scales with a star rating we do not have.
  FIRE_FANG: { kind: "burn", seconds: 2.0, chance: 1 },
  SLUDGE: { kind: "poison", seconds: 4.0, chance: 1 },
  DREAM_EATER: { kind: "sleep", seconds: 2.0, chance: 1 },
  PLAY_ROUGH: { kind: "charm", seconds: 2.5, chance: 1 },
  SAND_TOMB: { kind: "silence", seconds: 2.0, chance: 1 },

  // Rolled.
  THUNDER: { kind: "paralysis", seconds: 3.0, chance: 0.3 },
  WATER_PULSE: { kind: "confusion", seconds: 2.0, chance: 0.3 },
  EGG_BOMB: { kind: "armorBreak", seconds: 4.0, chance: 0.25 },
  AURORA_BEAM: { kind: "freeze", seconds: 2.0, chance: 0.5 },

};

/** Burn and poison, as a fraction of max health per second. */
export const DOT_FRACTION = 0.05;
export const DOT_INTERVAL = 1.0;

/** Statuses that stop a creature acting entirely. */
export function frozen(list: Status[] | undefined): boolean {
  return has(list, "freeze") || has(list, "sleep");
}

/** How much armour a broken-armour target loses, as a fraction. */
export const ARMOR_BREAK = 0.5;

/** How much of its speed a paralysed creature keeps. */
export const PARALYSIS_SPEED = 0.4;

export function has(list: Status[] | undefined, kind: StatusKind): boolean {
  return !!list && list.some((s) => s.kind === kind && s.left > 0);
}

/** Apply, or refresh if it is already there. */
export function apply(list: Status[], kind: StatusKind, seconds: number, by?: number) {
  const existing = list.find((s) => s.kind === kind);
  if (existing) {
    existing.left = Math.max(existing.left, seconds);
    if (by !== undefined) existing.by = by;
    return;
  }
  list.push({ kind, left: seconds, by, tick: DOT_INTERVAL });
}

/** Wake it. Sleep breaks when something hits you, the way it does in the games. */
export function wake(list: Status[]) {
  const i = list.findIndex((s) => s.kind === "sleep");
  if (i >= 0) list.splice(i, 1);
}

/** Count down, and drop what has expired. Returns true if anything changed. */
export function tick(list: Status[], dt: number): boolean {
  if (list.length === 0) return false;
  let changed = false;
  for (let i = list.length - 1; i >= 0; i--) {
    list[i].left -= dt;
    if (list[i].left <= 0) { list.splice(i, 1); changed = true; }
  }
  return changed;
}
