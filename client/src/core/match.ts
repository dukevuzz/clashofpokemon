/** A whole match, in one headless object. */

import { config, towerRangeOf, type Side } from "./config";
import * as status from "./status";
import * as combat from "./combat";
import * as hand from "./hand";
import * as tick from "./tick";
import * as deployment from "./deploy";
import { newDeck, type Card, type Target } from "./cards";
import type { Trace, Reach } from "./trace";
import { troopById, DEFAULT_TROOP } from "./towerTroops";

/*
 * Distances use sqrt, never Math.hypot.
 *
 * Math.hypot is permitted to be approximate and V8's approximation is not the
 * JVM's, so the two engines disagreed in the last bit of a distance. Invisible
 * almost everywhere; decisive at a boundary -- a projectile whose remaining
 * distance sat exactly on one frame's travel landed in one engine and not the
 * other, and the differential suite reported a single missing blow, in a
 * different match each time the rules moved.
 *
 * IEEE 754 requires sqrt to be correctly rounded, so this is bit-for-bit
 * identical in both. Overflow was the only thing hypot bought, and the board
 * is 384 by 672 units across.
 */
const span = (dx: number, dy: number): number => Math.sqrt(dx * dx + dy * dy);


// ---------------------------------------------------------------- the board

export interface Unit {
  id: number;
  card: Card;
  side: Side;
  x: number;
  y: number;
  hp: number;
  maxHP: number;
  damage: number;
  range: number;
  aggro: number;
  speed: number;
  attackRate: number;
  cooldown: number;
  target?: Unit | Tower;
  dead: boolean;
  /** Counts attacks; at `castEvery` the unit casts instead of swinging. */
  charge: number;
  castEvery: number;
  /** What this unit is willing to attack. See Card.targets. */
  targets: readonly Target[];
  jumpsRiver: boolean;
  flying: boolean;
  def: number;
  speDef: number;
  /** Temporary health that soaks damage before real health does, and never regenerates. */
  shield: number;
  lane: 0 | 1;
  /** How hard it is to shove aside. Copied from the card for hot-loop access. */
  mass: number;
  /** PMD facing, 0 down through 7 down-left. Rendering reads it; rules do not. */
  facing: number;
  action: "Walk" | "Idle" | "Attack" | "Shoot";
  /** What is currently afflicting it. */
  statuses: status.Status[];
  /** Mid-leap over the river, and how far through it is (0 to 1). */
  leap?: { t: number; dur: number; fromY: number; toY: number };
  /** Seconds left before this unit can act. */
  spawning: number;
  /** Has this unit Mega Evolved? One per side at a time. */
  mega?: boolean;
  /** Where a tunneller surfaces, and where it set off from. Diggers only. */
  digTo?: { x: number; y: number };
  digFrom?: { x: number; y: number };
  /** How long this unit's arrival takes in total, so the renderer can draw the fraction of it that has elapsed. */
  arriveTime: number;
  isTower?: false;
}

export interface Tower {
  id: number;
  side: Side;
  kind: "side" | "king";
  x: number;
  y: number;
  hp: number;
  maxHP: number;
  damage: number;
  range: number;
  cooldown: number;
  dead: boolean;
  isTower: true;
  /** Structures have no typing, so nothing is strong or weak against them. */
  def: number;
  speDef: number;
  /** A king tower does not fire until it is woken. */
  active: boolean;
  /** Seconds left before a woken king can shoot. */
  waking: number;
  /** Seconds between shots. A troop can make a lane tower faster or slower. */
  rate: number;
  /** A burst weapon's remaining shots, and how long it is dry for. */
  volley?: { shots: number; reload: number };
  ammo: number;
  reloading: number;
}

export type Thing = Unit | Tower;

/** A shot in the air. */
export interface Projectile {
  x: number;
  y: number;
  target: Thing;
  /** Last known target position, so a shot at a dying unit still lands there. */
  tx: number;
  ty: number;
  amount: number;
  mult: number;
  source: Unit | Tower;
  speed: number;
}

// -------------------------------------------------------------------- events
//
// The core never draws. It says what happened and the scene decides how that
// looks -- which is also exactly the list a server would send to a client.

export type MatchEvent =
  | { type: "spawn"; unit: Unit }
  | { type: "ready"; unit: Unit }
  | { type: "hit"; target: Thing; amount: number; mult: number; source: Unit | Tower }
  | { type: "cast"; unit: Unit; target: Thing; skill: string }
  | { type: "mega"; side: Side; unit: Unit; from: string }
  | { type: "status"; unit: Unit; kind: status.StatusKind; seconds: number }
  | { type: "shot"; from: Unit | Tower; to: Thing; amount: number; mult: number }
  | { type: "death"; thing: Thing }
  | { type: "towerDown"; tower: Tower }
  | { type: "kingWakes"; tower: Tower }
  | { type: "evolve"; side: Side; from: Card; to: Card }
  | { type: "choice"; side: Side; id: string; from: Card; options: Card[] }
  | { type: "over"; result: Result };

export type Result = "player" | "enemy" | "draw";

const dist = (ax: number, ay: number, bx: number, by: number) =>
  span(bx - ax, by - ay);

/** How close two creatures are allowed to stand, in world units. */
export const CROWD_RADIUS = config.unitSize * config.crowding;

/** Half a tower's footprint: how far its wall stands from its centre. */
export function radiusOf(thing: Thing): number {
  return thing.isTower ? config.towerSize[thing.kind] * 0.5 : 0;
}

/**
 * A tower's collision box, relative to the way it faces.
 *
 * `towerBox` is asymmetric because the art is. Every tower faces the middle,
 * so the far half's faces are reversed and both players meet the same one.
 */
export function boxOf(t: Tower): { up: number; down: number } {
  const box = config.towerBox[t.kind];
  return t.y < config.arenaHeight / 2
    ? { up: box.up, down: box.down }
    : { up: box.down, down: box.up };
}

/** How far something is from a thing's *surface*, not its centre. */
export const gapTo = (from: { x: number; y: number }, target: Thing) => {
  if (!target.isTower) {
    return Math.max(0, dist(from.x, from.y, target.x, target.y) - radiusOf(target));
  }
  // To the same rectangle the collision uses, not to a circle around it.
  //
  // A tower's art is a spire with a staircase, so its box reaches further below
  // the centre than above -- and `pushOutOfTowers` respects that. Range did
  // not: it measured to a symmetric circle, so a creature held off by the
  // 57-unit staircase was outside a circle of 32 and could not swing, while one
  // held at 41 by the plate could. The attacker climbing from below therefore
  // slid around the side to find range, and the one coming down stood square.
  //
  // Measured, that was 36 sideways and 30 vertical for the player against 0 and
  // 47 for the enemy -- an asymmetry that came from which end of the board you
  // started at. One shape for both, and the two agree.
  const box = boxOf(target);
  const half = config.towerSize[target.kind] * 0.5;
  const dx = Math.max(0, Math.abs(from.x - target.x) - half);
  const dy = from.y < target.y
    ? Math.max(0, target.y - from.y - box.up)
    : Math.max(0, from.y - target.y - box.down);
  return span(dx, dy);
};

/** PMD direction order: 0 down, 1 down-right, 2 right ... 7 down-left. */
export function facingFor(dx: number, dy: number): number {
  if (dx === 0 && dy === 0) return 0;
  const angle = Math.atan2(dy, dx);
  return ((Math.round((Math.PI / 2 - angle) / (Math.PI / 4)) % 8) + 8) % 8;
}

export interface MatchOptions {
  playerDeck?: Card[];
  enemyDeck?: Card[];
  rng?: () => number;
  /** A branch chosen ahead of time, per side, so the match never has to ask. */
  preferredBranch?: Partial<Record<Side, string>>;
  /** Which sides play themselves. */
  bot?: Partial<Record<Side, boolean>>;
  /** Deal the deck in the order given, rather than shuffling it. */
  shuffle?: boolean;
  /** Which creature sits on each side's lane towers, by troop id. */
  playerTroop?: string;
  enemyTroop?: string;
  /** Report every mutation. See core/trace.ts -- off costs one undefined check. */
  trace?: Trace;
}

/** An evolution offer waiting on an answer. */
/** Shuffle a deck for one match, without disturbing the one that was saved. */
function shuffled(deck: Card[], rng: () => number): Card[] {
  const out = [...deck];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export interface PendingChoice {
  id: string;
  slot: number;
  from: Card;
  options: Card[];
}

export class Match {
  units: Unit[] = [];
  towers: Tower[] = [];
  projectiles: Projectile[] = [];
  events: MatchEvent[] = [];

  /** Seconds remaining, counting down. */
  time: number = config.matchSeconds;
  elapsed = 0;
  over?: Result;

  elixir: Record<Side, number>;
  deck: Record<Side, Card[]>;
  /** The card each side may Mega: deck slot one, before shuffling. */
  megaPick: Record<Side, Card | undefined>;
  hand: Record<Side, (Card | undefined)[]>;
  drawIndex: Record<Side, number>;
  /** Times each card has been played this match, for evolution. */
  plays: Record<Side, Record<string, number>>;

  /** Which troop each side's lane towers carry. */
  troop: Record<Side, string>;

  /** The last card each side actually put on the board -- what Ditto copies. */
  lastPlayed: Record<Side, Card | undefined> = { 1: undefined, 2: undefined };
  /** Which body a form-choosing card will deploy as, per side. */
  form: Record<number, string | undefined> = {};

  /** A branching species waiting on the player to pick a form. */
  pendingChoice: Partial<Record<Side, PendingChoice>> = {};

  /** Committed in the deck builder: evolve straight into it, no interruption. */
  preferredBranch: Partial<Record<Side, string>>;

  /** Which sides answer for themselves. See MatchOptions.bot. */
  bot: Partial<Record<Side, boolean>>;

  /** Names offers `c1`, `c2`, ... */
  private choiceSeq = 0;

  /** Injected so a match is reproducible; see the determinism test. */
  rng: () => number;
  nextId = 1;

  /** The next offer's id, consumed when an offer is actually raised. */
  nextChoiceId(): string {
    return `c${++this.choiceSeq}`;
  }

  /** Set to record what the match does. See core/trace.ts. */
  trace?: Trace;

  /** Report one state change. */
  note(
    name: string, reach: Reach,
    side?: Side, detail?: Record<string, string | number | boolean | undefined>,
  ) {
    this.trace?.({ name, reach, side, at: this.time, detail });
  }

  constructor(opts: MatchOptions = {}) {
    this.rng = opts.rng ?? Math.random;
    this.preferredBranch = opts.preferredBranch ?? {};
    // One human, one bot, unless told otherwise -- which keeps every existing
    // single-player caller behaving exactly as it did.
    this.bot = opts.bot ?? { [config.ENEMY]: true };
    this.trace = opts.trace;
    // Assigned before setupArena(), because the towers read it as they are built.
    this.troop = {
      1: opts.playerTroop ?? DEFAULT_TROOP,
      2: opts.enemyTroop ?? DEFAULT_TROOP,
    };
    const p = opts.playerDeck ?? newDeck(this.rng);
    const e = opts.enemyDeck ?? newDeck(this.rng);

    this.elixir = { 1: config.startElixir, 2: config.startElixir };
    // Copied even when not shuffled. A match rewrites its own deck as cards
    // evolve, so holding the caller's array means evolving the caller's deck --
    // and a caller that passed one array for both sides had each side's
    // evolutions land in the other's cycle. `shuffled` already copies, so this
    // only ever bit the unshuffled path, which is tests and fixtures.
    this.deck = {
      1: opts.shuffle === false ? [...p] : shuffled(p, this.rng),
      2: opts.shuffle === false ? [...e] : shuffled(e, this.rng),
    };
    // The Mega slot is a deck-building position, so it has to be read before
    // the shuffle. `deck[side][0]` after this point is whichever card the
    // shuffle happened to put first, which is not the one the player chose.
    this.megaPick = { 1: p[0], 2: e[0] };
    this.hand = { 1: [], 2: [] };
    this.drawIndex = { 1: config.handSize, 2: config.handSize };
    this.plays = { 1: {}, 2: {} };

    for (const side of [config.PLAYER, config.ENEMY] as Side[]) {
      for (let i = 0; i < config.handSize; i++) {
        this.hand[side][i] = this.deck[side][i];
      }
    }
    this.setupArena();
  }

  // ----------------------------------------------------------------- towers

  private setupArena() {
    const { arenaWidth: W, arenaHeight: H, laneX } = config;
    for (const side of [config.PLAYER, config.ENEMY] as Side[]) {
      const back = config.towerBackOff;
      const baseY = side === config.PLAYER ? H - back.side : back.side;
      const kingY = side === config.PLAYER ? H - back.king : back.king;
      this.addTower(side, "side", laneX[0], baseY);
      this.addTower(side, "side", laneX[1], baseY);
      this.addTower(side, "king", W / 2, kingY);
    }
  }

  private addTower(side: Side, kind: "side" | "king", x: number, y: number): Tower {
    // A troop rewrites a *lane* tower and only a lane tower. The king keeps the
    // game's own statline, as in Clash Royale -- which also protects the sudden
    // death maths, since the tower that decides a tied match never changes.
    const troop = kind === "side" ? troopById(this.troop[side]) : undefined;

    const hp = troop ? troop.hp : config.towerHP[kind];
    const t: Tower = {
      id: this.nextId++, side, kind, x, y,
      hp, maxHP: hp,
      damage: troop ? troop.damage : config.towerDamage[kind],
      range: troop ? troop.reach + config.towerSize[kind] * 0.5 : towerRangeOf(kind),
      rate: troop ? troop.rate : config.towerRate,
      volley: troop?.volley,
      ammo: troop?.volley?.shots ?? 0,
      reloading: 0,
      // Structures carry no armour: their toughness is health, so that the
      // number the player watches is the number that decides the fight.
      def: 0, speDef: 0,
      active: kind !== "king",
      waking: 0,
      cooldown: 0, dead: false, isTower: true,
    };
    this.towers.push(t);
    return t;
  }

  // ------------------------------------------------------------------ cards

  // ------------------------------------------------------------- deploying
  //
  // The rules live in deploy.ts; these keep the shape every caller already
  // uses. A match is still the thing you ask "can I put this here", even
  // though the answer is no longer computed in this file.

  /** Where a card dropped at this point would actually land. */
  nearestDeploy(
    side: Side, x: number, y: number, approachX = x, anywhere = false,
    delivered = anywhere,
  ): { x: number; y: number } {
    return deployment.nearestDeploy(this, side, x, y, approachX, anywhere, delivered);
  }

  /** Is this a legal place for the card in that slot, at this moment? */
  canDeploy(side: Side, slot: number, x: number, y: number): boolean {
    return deployment.canDeploy(this, side, slot, x, y);
  }

  /** Play it. False if it was not legal or not affordable. */
  deploy(
    side: Side, slot: number, x: number, y: number, form?: string): boolean {
    return deployment.deploy(this, side, slot, x, y, form);
  }


  /** Split out from `deploy` so a drag preview can colour itself by the same rule the deploy enforces -- two copies of this test would drift. */


  /** The closest place this side may legally drop, to where the finger let go. */









  // --------------------------------------------------------------- fighting




















  // ----------------------------------------------------------------- update

  // ------------------------------------------------------------ your cards
  //
  // The rules live in hand.ts; these keep the shape callers already use.

  /** What that card costs this side right now. */
  costOf(side: Side, card: Card): number {
    return hand.costOf(this, side, card);
  }

  /** What a copying card would become if played now. */
  copyTarget(side: Side, card: Card): Card | undefined {
    return hand.copyTarget(this, side, card);
  }

  /** Plays made toward the next evolution, and how many are needed. */
  evolutionProgress(
    side: Side, card: Card,
  ): { done: number; needed: number } | undefined {
    return hand.evolutionProgress(this, side, card);
  }

  /** Answer a pending branch choice. */
  takeChoice(side: Side, choiceId: string, cardId: string): boolean {
    return hand.takeChoice(this, side, choiceId, cardId);
  }

  /** Advance the match. */
  update(dt: number): MatchEvent[] {
    if (this.over) return this.drain();

    this.elapsed += dt;
    const wasDouble = this.time <= config.suddenDeathAt;
    this.time = Math.max(0, this.time - dt);
    this.note("clock.tick", "continuous", undefined, { left: this.time });

    const double = this.time <= config.suddenDeathAt;
    const rate = config.elixirRate * (double ? 2 : 1);
    if (double && !wasDouble) this.note("clock.suddenDeath", "discrete");
    for (const side of [config.PLAYER, config.ENEMY] as Side[]) {
      this.elixir[side] = Math.min(config.elixirMax, this.elixir[side] + rate * dt);
      this.note("elixir.regen", "continuous", side, { to: this.elixir[side] });
    }

    combat.updateProjectiles(this, dt);
    for (const u of this.units) if (!u.dead) tick.updateUnit(this, u, dt);
    for (const t of this.towers) if (!t.dead) tick.updateTower(this, t, dt);

    // A unit that walks off the far end has nothing left to do.
    // Two very different removals share this filter, and the protocol cares
    // which is which. A dead unit already announced itself; one that simply
    // walked off the end never did, so nothing downstream knows it is gone.
    for (const u of this.units) {
      if (u.dead) continue;
      if (u.y > -20 && u.y < config.arenaHeight + 20) continue;
      this.note("unit.walkedOff", "discrete", u.side, { id: u.id, y: u.y });
    }
    this.units = this.units.filter(
      (u) => !u.dead && u.y > -20 && u.y < config.arenaHeight + 20,
    );

    this.checkOver();
    return this.drain();
  }

  private drain(): MatchEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  // ------------------------------------------------------------------ result

  towersLeft(side: Side): number {
    return this.towers.filter((t) => t.side === side && !t.dead).length;
  }

  /** Total remaining tower health as a fraction: the tiebreak when time runs out and both sides have the same number standing. */
  towerHealth(side: Side): number {
    let hp = 0, max = 0;
    for (const t of this.towers) {
      if (t.side !== side) continue;
      hp += t.hp; max += t.maxHP;
    }
    return max > 0 ? hp / max : 0;
  }

  kingDown(side: Side): boolean {
    return this.towers.some((t) => t.side === side && t.kind === "king" && t.dead);
  }

  /** A side loses when its king falls; otherwise the most towers taken wins. */
  private checkOver() {
    let result: Result | undefined;
    if (this.kingDown(config.ENEMY)) result = "player";
    else if (this.kingDown(config.PLAYER)) result = "enemy";
    else if (this.time <= 0) {
      const mine = this.towersLeft(config.PLAYER);
      const theirs = this.towersLeft(config.ENEMY);
      if (mine !== theirs) {
        result = mine > theirs ? "player" : "enemy";
      } else {
        const hpMine = this.towerHealth(config.PLAYER);
        const hpTheirs = this.towerHealth(config.ENEMY);
        result =
          Math.abs(hpMine - hpTheirs) < 0.01 ? "draw"
          : hpMine > hpTheirs ? "player" : "enemy";
      }
    }
    if (result) {
      this.over = result;
      this.note("match.over", "discrete", undefined, { result });
      this.events.push({ type: "over", result });
    }
  }
}
