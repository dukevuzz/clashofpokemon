/** The opponent. */

import { config, forwardFor, type Side } from "./config";
import type { Match, Unit } from "./match";

export class AI {
  private timer = 2.5;

  constructor(
    private side: Side = config.ENEMY,
    private rng: () => number = Math.random,
  ) {}

  /** The lane this AI has committed to attacking, until it has reason to switch. */
  private pushLane?: 0 | 1;

  /** Which of the opponent's lanes is softer, for a push. */
  private weakestLane(match: Match): 0 | 1 {
    const theirs = match.towers.filter((t) => t.side !== this.side && t.kind === "side");
    for (const t of theirs) {
      if (t.dead || t.hp <= 0) return t.x < config.arenaWidth / 2 ? 0 : 1;
    }
    const bodies = [0, 0];
    for (const u of match.units) {
      if (u.side === this.side || u.dead) continue;
      bodies[u.x < config.arenaWidth / 2 ? 0 : 1]++;
    }
    if (bodies[0] === bodies[1]) return this.rng() < 0.5 ? 0 : 1;
    return bodies[0] < bodies[1] ? 0 : 1;
  }

  /** Move a drop point off its own towers, toward the river. */
  private clearOfOwnTowers(match: Match, y: number, x: number, back: number): number {
    for (const t of match.towers) {
      if (t.side !== this.side || t.dead) continue;
      // The tower's real shape: wider than the footprint by a body, and taller
      // than it is wide because the art is a spire on a staircase.
      const box = config.towerBox[t.kind];
      const clear = config.towerSize[t.kind] * 0.5 + config.unitSize;
      if (Math.abs(x - t.x) > clear) continue;
      const dy = y - t.y;
      if (dy < -box.up - config.unitSize || dy > box.down + config.unitSize) continue;
      // Out past whichever end faces the river, so the defender still stands
      // between the threat and the tower.
      y = back < 0 ? t.y + box.down + config.unitSize : t.y - box.up - config.unitSize;
    }
    return y;
  }

  /** Is this y-coordinate on the half this AI is defending? */
  private inOwnHalf(y: number): boolean {
    const half = config.arenaHeight / 2;
    return forwardFor(this.side) < 0 ? y > half : y < half;
  }

  update(match: Match, dt: number) {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 1.6 + this.rng() * 1.6;

    const hand = match.hand[this.side];
    const elixir = match.elixir[this.side];

    // Prefer the most expensive card it can afford, so it does not dribble
    // cheap units out and lose to a saved-up push.
    let bestSlot = -1;
    let bestCost = -1;
    for (let i = 0; i < hand.length; i++) {
      const card = hand[i];
      if (card && card.elixir <= elixir && card.elixir > bestCost) {
        bestSlot = i;
        bestCost = card.elixir;
      }
    }
    if (bestSlot < 0) return;

    // Save for the expensive card instead of dribbling cheap ones out.
    //
    // Greedy "most expensive I can afford right now" cannot ever buy above
    // about 5: the timer fires every ~2.4s and elixir regenerates at 0.4/s, so
    // roughly one elixir arrives between decisions and something cheap is
    // always affordable. Measured, the three 7-cost legendaries were deployed
    // zero times in 128 matches -- they sat in hand all game.
    //
    // So: if the hand holds something better than what is affordable, and this
    // side is not being pushed, hold. Pressure overrides it, because a saved
    // elixir is worth nothing if the tower falls first.
    const dearest = Math.max(...hand.map((c) => c?.elixir ?? 0));
    const underPressure = match.units.some(
      (u) => u.side !== this.side && !u.dead && this.inOwnHalf(u.y),
    );
    if (dearest > bestCost && !underPressure && elixir < config.elixirMax) {
      // Not a hard block -- an occasional cheap play keeps it unpredictable and
      // stops it standing idle behind a full bar it is waiting to spend.
      if (this.rng() < 0.75) return;
    }

    // The geometry has to be mirrored rather than hardcoded: written for the
    // enemy only, a player-side AI computed drop points in the opponent's half,
    // every deploy failed canDeploy, and one side walked the board unopposed.
    const forward = forwardFor(this.side); // the way this side advances
    const back = -forward;                 // toward this side's own king
    const half = config.arenaHeight / 2;
    const edge = half + back * config.deployMargin; // nearest legal own-half line

    // Where the deepest intruder is, and in which lane.
    let threat: Unit | undefined;
    for (const u of match.units) {
      if (u.side === this.side || u.dead) continue;
      if (!this.inOwnHalf(u.y)) continue;
      // "Deepest" means furthest along this side's back direction.
      if (!threat || u.y * back > threat.y * back) threat = u;
    }

    let lane: 0 | 1;
    let y: number;

    if (threat) {
      // Defend in FRONT of it, between the intruder and the tower it is walking
      // at -- not at the river.
      //
      // The old code always dropped just behind the halfway line whatever was
      // happening, so a defender spawned level with or behind an intruder that
      // had already walked past. Measured over 200 matches, 54% of deploys made
      // while its own half was invaded landed behind the threat, where they
      // turn around and walk away from the tower being hit. A player put it
      // exactly right: it did not know how to defend its home, only how to
      // summon for attack.
      lane = threat.x < config.arenaWidth / 2 ? 0 : 1;
      y = threat.y + back * (config.unitSize * 1.5);
      // Never behind its own lane tower, which is as deep as defending is worth
      // and stops it dropping bodies next to the king.
      const towerLine = half + back * (config.arenaHeight / 2 - config.towerBackOff.side);
      if (y * back > towerLine * back) y = towerLine;
      if (y * back < edge * back) y = edge;
      y = this.clearOfOwnTowers(match, y, config.laneX[lane], back);
    } else {
      // Nothing to answer, so attack -- and commit to a lane instead of picking
      // a fresh one every 2.4s. Dribbling one unit into each lane in turn is
      // how the old behaviour spent a whole match building nothing.
      if (this.pushLane === undefined || this.rng() < 0.15) {
        this.pushLane = this.weakestLane(match);
      }
      lane = this.pushLane;
      y = edge + back * (10 + this.rng() * 50);
    }

    const x = config.laneX[lane] + (this.rng() * 20 - 10);
    match.deploy(this.side, bestSlot, x, y);
  }

  reset() {
    this.timer = 2.5;
    this.pushLane = undefined;
  }
}
