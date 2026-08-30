/** The match, on screen. */

import Phaser from "phaser";
import {
  Match, AI, config, CROWD_RADIUS, towerTroops,
  type MatchEvent, type Thing, type Unit, type Tower, type Side,
} from "../core";
import * as cards from "../core/cards";
import * as deploy from "../core/deploy";
import * as hand from "../core/hand";
import type { Card } from "../core/cards";
import * as evolution from "../core/evolution";
import * as played from "../net/played";
import { effectivenessLabel, TYPE_COLORS, typesOf } from "../core/species";
import { C, style, px, hex, rarityColor } from "../ui/theme";
import * as sprites from "../ui/sprites";
import * as arena from "../ui/arena";
import { SkillFx } from "../ui/skillFx";
import { CardFace } from "../ui/card";
import { MegaButton } from "../ui/megaButton";
import * as mega from "../core/mega";
import {
  DESIGN_W, DESIGN_H, ARENA_SCALE, ARENA_Y,
  HAND_Y, CARD_W, CARD_H, PIP_Y, ARENA_X, toScreen, toWorld, SPRITE_SCALE, FOOTPRINT,
  setViewSide, viewingFrom, viewFacing,
} from "../ui/layout";
import { loadDeck, loadBranch, loadTroop, loadSettings, recordResult } from "../ui/deckStore";
import * as collection from "../ui/collection";
import { openModal, choiceButton } from "../ui/modal";
import * as portraits from "../ui/portraits";
import { NetMatch } from "../net/client";
import { nextStep, markCoached, type Step } from "../ui/coach";
import { LESSONS, markFinished, type Lesson } from "../ui/tutorial";

/** A colour per status, for the pip that shows it. */
const STATUS_COLOUR: Record<string, number> = {
  paralysis: 0xf7d51d,   // electric yellow, because Thunder and Nuzzle cause it
  flinch: 0xff8c40,
  confusion: 0xbf73ff,
  armorBreak: 0xe76e55,  // the physical-damage colour: armour is what broke
};

/** The simulation's heartbeat, and the only rate it is ever stepped at. */
/**
 * Longer than this and a press is a hold, not a tap -- so it picks a card up
 * rather than asking a Deoxys for its next body. Set at the slow end of a
 * deliberate tap: shorter would refuse taps from anyone unhurried, and longer
 * would let a moment's hesitation change the body under your thumb again.
 */
const TAP_MS = 300;

const SIM_STEP = 1 / 30;

/** How long one frame may spend catching the simulation up, in real milliseconds. */
const CATCHUP_BUDGET_MS = 12;

/** The most simulated time that can ever be owed. */
const MAX_CATCHUP = config.matchSeconds;

/** Events worth watching happen, as opposed to events worth knowing about. */
const COSMETIC: ReadonlySet<string> = new Set([
  "ready", "hit", "shot", "cast", "towerDown", "evolve",
]);

const asColour = (rgb?: number[]): number =>
  rgb ? Phaser.Display.Color.GetColor(rgb[0] * 255, rgb[1] * 255, rgb[2] * 255) : 0x999999;

/**
 * A deck holding every card the tutorial names.
 *
 * The lessons write the hand directly, so this only needs to exist and be the
 * right length -- but it has to contain the real cards, because evolution and
 * form-switching read the deck rather than the hand.
 */
function teachingDeck(): Card[] {
  const wanted = ["charmander", "machop", "snorlax", "deoxys", "diglett", "voltorb"];
  return wanted.map((id) => cards.byId(id)).filter(Boolean) as Card[];
}

export class BattleScene extends Phaser.Scene {
  private match!: Match;
  private ai!: AI;
  private fx!: SkillFx;
  private water!: arena.WaterShimmer;

  private unitLayer!: Phaser.GameObjects.Container;
  private views = new Map<number, UnitView>();
  private towerViews = new Map<number, TowerView>();

  private pips: Phaser.GameObjects.Rectangle[] = [];
  private megaButton?: MegaButton;
  private elixirText!: Phaser.GameObjects.Text;
  private clockText!: Phaser.GameObjects.Text;
  private clockBox!: Phaser.GameObjects.Rectangle;
  private hand: CardFace[] = [];

  private dragging?: { slot: number; cycleOnTap?: boolean; ghost: Phaser.GameObjects.Container };
  /** The tap-to-place preview, which follows the pointer without a drag. */
  private preview?: Phaser.GameObjects.Container;
  private downAt?: { x: number; y: number; t: number };
  /** Set by any ending path, so a late disconnect cannot draw a second screen. */
  private over = false;
  private selected?: number;
  private dropMarker!: Phaser.GameObjects.Graphics;

  /** Aggro/range circles. Off by default -- eight overlapping rings is unreadable. */
  private rings!: Phaser.GameObjects.Graphics;
  private showRings = false;
  private deployLine!: Phaser.GameObjects.Graphics;

  /** Unspent real time, carried between frames so the step stays fixed. */
  private accumulator = 0;
  /** `performance.now()` at the last simulated moment. 0 until the first frame. */
  private lastStepAt = 0;
  /** True while replaying time the player was not watching. */
  private catchingUp = false;
  private choiceUI?: Phaser.GameObjects.Container;
  private banner?: Phaser.GameObjects.Container;
  /** Opponent elixir, shown only if the player asked to see it. */
  private enemyElixirText?: Phaser.GameObjects.Text;

  constructor() {
    super("Battle");
  }

  /** The match exists before preload so preload knows which sheets to fetch. */
  /** Which seat this client is sitting in, and which one it is playing against. */
  private me: Side = config.PLAYER;
  private them: Side = config.ENEMY;

  /** The connection, when this match is being played against a person. */
  private net?: NetMatch;
  /** Shown while waiting for an opponent, and for connection trouble. */
  private netNote?: Phaser.GameObjects.Text;

  /*
   * Coaching a first match.
   *
   * Players who found the game on YouTube asked for a tutorial. Rather than a
   * separate scripted level -- a second game to build, and one most people
   * skip -- the real match carries a line at the moment each rule starts to
   * matter. What to say lives in ui/coach.ts; this is only how it looks.
   */
  private coachText?: Phaser.GameObjects.Text;
  private coachBox?: Phaser.GameObjects.Graphics;
  private coachZone?: Phaser.GameObjects.Graphics;
  private coachStep?: Step;
  private coachRetired = new Set<string>();
  private coaching = false;

  /** Set when this is the scripted tutorial rather than a real match. */
  private lesson?: Lesson;
  private lessonAt = 0;
  private lessonDone = false;
  private teaching = false;

  init(data?: { seat?: Side; net?: NetMatch; tutorial?: boolean }) {
    /*
     * Everything that outlives a match must be reset here.
     *
     * Phaser constructs a scene once and reuses it, so a field initialised at
     * construction keeps its value from the *previous* match. `over` stayed
     * true after the first game ended, and `finish` returns early when it is
     * -- so the second offline match ran to 0:00 and never drew a result. A
     * player found it in one sentence: "play 2 offline games, 1st no problem,
     * 2nd will [freeze]".
     *
     * Anything added below with an initialiser belongs in this list too.
     */
    this.over = false;
    this.accumulator = 0;
    this.lastStepAt = 0;
    this.catchingUp = false;
    this.lesson = undefined;
    this.lessonAt = 0;
    this.lessonDone = false;

    this.net = data?.net;
    /*
     * Coach a first offline match, and only that.
     *
     * Online is not the place to learn: the clock is real, an opponent is
     * waiting, and a band of text over the board while somebody pushes is
     * worse than no help at all. Offline against the bot is where a new
     * player actually is when they need this.
     */
    this.teaching = Boolean(data?.tutorial);
    // The coach and the tutorial teach the same first lessons, so a player
    // doing one is never shown the other.
    /*
     * The in-match coach is off.
     *
     * Same decision as the tutorial: it is written and it is not good enough
     * to be somebody's first two minutes. A line reading "drag a Pokemon onto
     * your half" over the board while a match is running is worse than
     * nothing, and the guide -- which is finished -- says it properly.
     *
     * `coach.ts` and its tests stay, so switching this back on is one line.
     */
    this.coaching = false;
    this.coachRetired = new Set();
    this.me = data?.seat ?? data?.net?.seat ?? config.PLAYER;
    this.them = this.me === config.PLAYER ? config.ENEMY : config.PLAYER;
    // Everything drawn goes through layout, so this is the whole of "turn the
    // board around". It must happen before preload, which already asks the
    // match which art it needs.
    setViewSide(this.me);

    if (this.net) {
      // Online: the board is the server's, already being written into by the
      // connection. There is no local opponent and no local simulation.
      this.match = this.net.match;
      return;
    }

    // The opponent picks a troop at random, so you meet all four rather than
    // only ever fighting the default.
    const pool = towerTroops.TROOPS;
    if (this.teaching) {
      /*
       * The tutorial's match.
       *
       * Same rules, same rendering, same everything -- only the deck and the
       * opponent are ours. `shuffle: false` is what makes a lesson able to say
       * "drag Charmander" and be right, and no bot means nothing happens that
       * the script did not ask for.
       */
      /*
       * Built here and *not* returned from: the rest of create() makes the AI,
       * the views and the HUD. Returning early skipped all of it, the update
       * loop threw on the first frame, and Phaser quietly stopped calling
       * update at all -- so the first lesson drew and nothing ever advanced.
       *
       * The first lesson starts at the end of create(), once there is a scene
       * for it to arrange.
       */
      this.match = new Match({
        playerDeck: teachingDeck(),
        enemyDeck: teachingDeck(),
        shuffle: false,
        bot: {},
      });
    } else {
    this.match = new Match({
      // The deck belongs to the person, not to the seat: whichever seat this
      // client was dealt, that seat plays this account's cards.
      [this.me === config.PLAYER ? "playerDeck" : "enemyDeck"]: loadDeck(),
      preferredBranch: { [this.me]: loadBranch() },
      [this.me === config.PLAYER ? "playerTroop" : "enemyTroop"]: loadTroop(),
      [this.me === config.PLAYER ? "enemyTroop" : "playerTroop"]:
        pool[Math.floor(Math.random() * pool.length)].id,
      // The seat nobody is sitting in answers its own branch offers.
      bot: { [this.them]: true },
    });
    }
    // Both paths need one. The tutorial's opponent never plays a card -- the
    // script decides what appears -- but the update loop calls this every
    // frame, and a missing AI threw on the first one, which is how Phaser
    // quietly stopped calling update at all.
    this.ai = new AI(this.them);
  }

  /** The evolution chains both decks can reach, and nothing else. */
  /** Which ground this match was dealt. */
  arenaTheme = "";

  preload() {
    // Both players hash the same match id, so they get the same board.
    this.arenaTheme = arena.pickTheme(this.net?.matchId);

    // Chains *and* bodies.
    //
    // A chain is what a card evolves into; a form is a body it can be deployed
    // as, and `chainOf` knows nothing about the second. Deoxys' three other
    // bodies each have their own sheet, none of which was ever fetched -- so
    // playing Deoxys-Attack asked Phaser for a texture that did not exist and
    // got its placeholder: a black box with a green diagonal, standing on the
    // board where a creature should be.
    const reachable = ([this.me, this.them] as Side[]).flatMap((side) =>
      this.match.deck[side].flatMap((c) => {
        const chain = evolution.chainOf(c.id) ?? [c.id];
        // Forms of every stage, not just the one in hand: a card that evolves
        // into something with bodies needs those too.
        const forms = chain.flatMap((id) => cards.byId(id)?.forms ?? []);
        return [...chain, ...forms];
      }),
    );
    // Both towers' riders too, or the mount renders empty for a troop that
    // happens not to be in either deck -- which is the normal case.
    for (const side of [this.me, this.them] as const) {
      reachable.push(towerTroops.troopById(this.match.troop[side]).species);
    }
    // Mega forms are deliberately outside the evolution chains, so `chainOf`
    // above will never mention them and the loader would not fetch them.
    for (const side of [this.me, this.them] as const) {
      for (const c of this.match.deck[side]) {
        for (const f of evolution.chainOf(c.id)) {
          const m = mega.MEGA[f];
          if (m) reachable.push(m);
        }
      }
    }

    reachable.push(towerTroops.KING_SPECIES);
    // Two frames side by side: cold, then lit.
    this.load.spritesheet("mega-stone", "tiles/mega-stone.png",
                          { frameWidth: 48, frameHeight: 48 });
    sprites.preload(this.load, reachable);
  }

  create() {
    sprites.init(this.anims, this.textures);
    this.views.clear();
    this.towerViews.clear();
    this.hand = [];
    this.pips = [];
    this.dragging = undefined;
    this.selected = undefined;
    this.choiceUI = undefined;
    // A rematch starts owing nothing. Left set, the first frame would bill the
    // new match for the time spent reading the last one's result screen.
    this.accumulator = 0;
    this.lastStepAt = 0;
    this.catchingUp = false;
    this.banner = undefined;

    this.cameras.main.setBackgroundColor(C.bg);
    arena.drawSurround(this);
    arena.buildGround(this);
    arena.drawEdgesAndBridges(this);
    this.water = new arena.WaterShimmer(this);

    this.fx = new SkillFx(this);
    this.unitLayer = this.add.container(0, 0).setDepth(10);
    this.rings = this.add.graphics().setDepth(9);
    // The deploy area is redrawn every frame, because breaking a lane tower
    // moves it. It was declared and never created for one build -- the field
    // is definite-assigned, so TypeScript believed the declaration and the
    // scene crashed on its first update.
    this.deployLine = this.add.graphics().setDepth(3);
    this.dropMarker = this.add.graphics().setDepth(30);

    for (const t of this.match.towers) {
      this.towerViews.set(t.id, new TowerView(this, t, this.match.troop[t.side]));
    }

    this.buildHud();
    this.buildHand();
    this.setupInput();

    if (this.net) {
      this.netNote = this.add
        .text(DESIGN_W / 2, 64, "", style(13, C.dim))
        .setOrigin(0.5).setDepth(50);
      // Server events reach the renderer through exactly the same call the
      // local simulation uses. `rehydrate` turns the wire's ids back into the
      // objects `render` expects, and drops anything whose subject is not on
      // this client's board rather than inventing one to draw damage on.
      this.net.onEvents = (events) => {
        for (const w of events) {
          const e = this.net!.rehydrate(w);
          if (e) this.render(e);
        }
      };
      /*
       * The server's verdict, which nobody was listening for.
       *
       * `onOver` was set once in the menu, as an empty function, and the battle
       * never replaced it -- so `{"t":"over","result":"draw"}` arrived on the
       * socket and went nowhere. Every symptom reported followed from this one
       * gap: no result screen, a board frozen at 0:00, the socket left open,
       * and then "another tab" refusing the next match because the seat was
       * still held. Confirmed against production by logging the raw messages:
       * the server had sent it every time.
       *
       * `finish` translates the winning side into *this* seat's result, so the
       * server's own naming is passed through unchanged.
       */
      this.net.onOver = (result: string) => {
        // The wire already names the winning *side* as "player" or "enemy"
        // (Wire.seatResult), the same vocabulary `finish` translates for this
        // seat. No second translation here, or seat two would be told it lost
        // a match it won -- a bug this project has already had once.
        this.finish(result === "player" || result === "enemy" ? result : "draw");
      };

      /*
       * Hang up on the way out.
       *
       * Nothing closed this socket. Leaving the result screen started the menu
       * and the connection stayed open, so the next PLAY ONLINE opened a
       * second one -- and the server refuses a second connection for the same
       * account, by design, to stop two tabs sharing a seat. The player was
       * locked out of online play by their own last match until they reloaded.
       */
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.net?.close());

      this.net.onNote = (text) => {
        this.netNote?.setText(text);
        // Our own socket has gone. Without this the board simply freezes on
        // the last snapshot -- reported with a screenshot showing a king at
        // zero, the clock stopped at 1:00, and no way out but a reload.
        if (text === "disconnected") this.endLocally();
      };
      // Art is up. Nothing starts until the other seat says the same.
      this.net.ready();
    }

    // The first lesson, once there is a scene for it to arrange: it writes the
    // hand, sets the elixir and puts things on the board, none of which exists
    // before create() has run.
    if (this.teaching) this.startLesson(0);
  }

  // -------------------------------------------------------------------- hud

  private buildHud() {
    // The clock is glanced at, not read, and the last minute must announce itself.
    this.clockBox = this.add.rectangle(DESIGN_W / 2, 40, 128, 40, C.panelDim, 0.9)
      .setStrokeStyle(2, C.edge);
    this.clockText = this.add
      .text(DESIGN_W / 2, 40, "3:00", px(24))
      .setOrigin(0.5);

    // Elixir as discrete pips. A continuous bar tells you how full you are; the
    // only question a player actually asks is "can I afford the 5 yet".
    const w = config.arenaWidth * ARENA_SCALE;
    const pipW = (w - (config.elixirMax - 1) * 4) / config.elixirMax;
    for (let i = 0; i < config.elixirMax; i++) {
      const x = ARENA_X + i * (pipW + 4);
      this.add.rectangle(x + pipW / 2, PIP_Y, pipW, 16, C.elixirDim);
      this.pips.push(this.add.rectangle(x, PIP_Y, pipW, 16, C.elixir).setOrigin(0, 0.5));
    }
    this.elixirText = this.add.text(ARENA_X + 6, PIP_Y - 9, "5", px(11));

    // In the empty margin beside the arena rather than over it: the board is
    // 384 units wide in a 620 design, so there are ~80px either side doing
    // nothing, and a button on the board covers ground units walk through.
    //
    // Offline only, until the server can be told about a Mega. A button that
    // is visible, charges, lights up and then does nothing is worse than no
    // button -- the player spends the match waiting to use it.
    if (!this.net) {
      this.megaButton = new MegaButton(
        this, ARENA_X / 2, PIP_Y - 46, this.match, this.me, () => this.pressMega());
    }

    // Hidden by default, the way Clash Royale plays it: counting the
    // opponent's elixir is a skill, and a readout hands it to you. Offered
    // anyway, because against a bot there is no bluff to protect and the number
    // is how you learn to count without it.
    //
    // Never online, whatever the setting says. Against a person that number is
    // the bluff itself -- and the server does not send it, so drawing it would
    // mean drawing this client's stale copy: a confident, plausible, wrong
    // number, which is worse than no number at all.
    if (loadSettings().showEnemyElixir && !this.net) {
      this.enemyElixirText = this.add
        .text(DESIGN_W / 2, 66, "", style(13, C.enemy, "bold"))
        .setOrigin(0.5);
    }
  }

  private buildHand() {
    const total = config.handSize * CARD_W + (config.handSize - 1) * 8;
    const startX = (DESIGN_W - total) / 2;
    for (let i = 0; i < config.handSize; i++) {
      this.hand.push(
        new CardFace(this, startX + i * (CARD_W + 8), HAND_Y, {
          width: CARD_W, height: CARD_H,
        }),
      );
    }
  }

  // ------------------------------------------------------------------ input

  /** Two ways to play a card. */
  private setupInput() {
    this.input.keyboard?.on("keydown-F1", () => {
      this.showRings = !this.showRings;
      if (!this.showRings) this.rings.clear();
    });

    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      // An open evolution choice no longer locks the board. It used to, which
      // was consistent with the match pausing and became a trap once it did
      // not: time would pass with every input refused.
      if (this.match.over) return;

      const slot = this.slotAt(p.x, p.y);
      if (slot >= 0) {
        const card = this.match.hand[this.me][slot];
        if (!card) return;
        // Selecting only. Changing body waits for the release -- see below.
        //
        // This cycled here once, and on a touch screen that made a card with
        // bodies almost unplayable: pressing it to *drag* is a pointerdown on
        // an already-selected card, so Deoxys transformed every time you tried
        // to pick it up, and you never got the body you were looking at.
        //
        // Whether it was already chosen has to be remembered *now*, because
        // the next line is about to change the answer -- and the release needs
        // it to tell "picking this up" from "asking for the next body".
        const wasSelected = this.selected === slot && card.forms.length > 0;
        if (!wasSelected) {
          this.selected = this.selected === slot ? undefined : slot;
        }
        this.preview?.destroy();
        this.preview = undefined;
        this.downAt = { x: p.x, y: p.y, t: this.time.now };
        // Drop any ghost still standing. Normally the release handler clears
        // it, but a pointerup that never arrives -- the pointer leaving the
        // window, a synthetic event -- would otherwise leave a card-sized
        // sprite parked on the hand forever, one per press.
        this.dragging?.ghost.destroy();
        // The ghost shows the chosen body too, so what you drag is what lands.
        this.dragging = {
          slot,
          cycleOnTap: wasSelected,
          ghost: this.makeGhost(hand.formOf(this.match, this.me, card), p.x, p.y),
        };
        return;
      }
      if (this.selected !== undefined) {
        // Same rule as a drag: the board plays it, anywhere else lets it go.
        if (!this.overBoard(p)) {
          this.selected = undefined;
          this.preview?.destroy();
          this.preview = undefined;
          this.dropMarker.clear();
          return;
        }
        const w = toWorld(p.x, p.y);
        const held = this.match.hand[this.me][this.selected];
        const at = this.match.nearestDeploy(
          this.me, w.x, w.y, w.x, cards.arrivesAnywhere(held?.delivery),
          Boolean(held?.delivery));
        if (this.play(this.selected, at.x, at.y)) {
          this.selected = undefined;
          this.preview?.destroy();
          this.preview = undefined;
          this.dropMarker.clear();
        }
      }
    });

    // A selected card previews under the pointer even without a drag, which is
    // what Clash Royale does: you see the bodies you are about to place before
    // you commit. Tap-to-select used to show nothing at all between choosing a
    // card and placing it, so the whole decision was made blind.
    this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
      if (!this.dragging && this.selected !== undefined) {
        const held = this.match.hand[this.me][this.selected];
        const card = held && hand.formOf(this.match, this.me, held);
        if (card) {
          this.preview?.destroy();
          this.preview = this.makeGhost(card, p.x, p.y);
          const over = this.overBoard(p);
          this.preview.setAlpha(over ? 0.8 : 0.3);
          // Only where a card could actually land. Drawn unconditionally, the
          // marker followed the pointer back down over the hand and sat clamped
          // to the board's edge with a leader line trailing to the card -- a
          // landing spot promised for a release that would place nothing. The
          // drag path below has always had this check; the tap path never did.
          if (over) this.drawDropMarker(p);
          else this.dropMarker.clear();
        }
        return;
      }
      if (!this.dragging) return;
      this.dragging.ghost.setPosition(p.x, p.y);
      // Faded off the board, so "let go here and nothing happens" is something
      // you can see while the card is still in your hand.
      this.dragging.ghost.setAlpha(this.overBoard(p) ? 1 : 0.4);
      if (this.overBoard(p)) this.drawDropMarker(p);
      else this.dropMarker.clear();
    });

    const release = (p: Phaser.Input.Pointer) => {
      if (!this.dragging) return;
      const moved =
        this.downAt !== undefined &&
        Phaser.Math.Distance.Between(this.downAt.x, this.downAt.y, p.x, p.y) > 12;

      /*
       * A tap changes body; a drag plays the card.
       *
       * The same second press has to mean both things, and the only honest
       * way to tell them apart is what the finger did. Deciding at the press
       * meant deciding before the answer existed, which is why dragging Deoxys
       * transformed it instead of picking it up.
       *
       * A tap is short as well as still, and both halves are load-bearing.
       * Movement alone said a press-hesitate-release was a tap, so pausing
       * before reaching for the board cycled the body -- and the drag after it
       * deployed the body *past* the one on the card's face. Holding is how
       * you pick something up, in every interface anybody has used; it cannot
       * also be how you ask for the next body.
       */
      const held = this.match.hand[this.me][this.dragging.slot];
      const quick = this.time.now - (this.downAt?.t ?? 0) <= TAP_MS;
      if (!moved && quick && this.dragging.cycleOnTap && held?.forms.length) {
        hand.cycleForm(this.match, this.me, held);
        this.dragging.ghost.destroy();
        this.dragging = undefined;
        this.downAt = undefined;
        this.dropMarker.clear();
        return;
      }

      // Over the board deploys; anywhere else puts the card back.
      //
      // This used to happen by accident: an illegal drop was refused, so
      // dragging back to the hand cancelled. Then snapping arrived -- so a
      // missed drop would find the nearest legal square instead of being eaten
      // -- and that quietly removed the only way to change your mind, because
      // every release now had somewhere legal to go. Cancelling has to be its
      // own rule, not a side effect of failure.
      if (moved && this.overBoard(p)) {
        const w = toWorld(p.x, p.y);
        // The drag's origin decides which side of a tower it lands on.
        const from = toWorld(this.downAt?.x ?? p.x, this.downAt?.y ?? p.y);
        const at = this.match.nearestDeploy(
          this.me, w.x, w.y, from.x, cards.arrivesAnywhere(held?.delivery),
          Boolean(held?.delivery));
        if (this.play(this.dragging.slot, at.x, at.y)) {
          this.selected = undefined;
        }
      }
      this.dragging.ghost.destroy();
      this.dragging = undefined;
      this.downAt = undefined;
      this.dropMarker.clear();
    };
    this.input.on("pointerup", release);
    this.input.on("pointerupoutside", release);
  }

  /** Is this release a play, or a change of mind? */
  /** Put a card down -- locally, or as a request. */
  /**
   * Mega the slot-one unit.
   *
   * Offline only -- the button is not built for a networked match. Online will
   * need a message of its own: the server owns elixir, so a client that Mega'd
   * on its own would drift from the match the server is running.
   */
  private pressMega() {
    mega.mega(this.match, this.me);
  }

  private play(slot: number, x: number, y: number): boolean {
    if (!this.net) return this.match.deploy(this.me, slot, x, y);
    const held = this.match.hand[this.me][slot];
    if (!held) return false;
    // Asked locally too, so an obviously illegal tap costs no round trip. The
    // server checks the same thing again and its answer is the one that counts.
    if (!this.match.canDeploy(this.me, slot, x, y)) return false;
    this.net.deploy(slot, x, y, this.match.form[this.me]);
    this.match.form[this.me] = undefined;
    return true;
  }

  private overBoard(p: { x: number; y: number }): boolean {
    return (
      p.x >= ARENA_X && p.x <= ARENA_X + config.arenaWidth * ARENA_SCALE &&
      p.y >= ARENA_Y && p.y <= ARENA_Y + config.arenaHeight * ARENA_SCALE
    );
  }

  private slotAt(x: number, y: number): number {
    if (y < HAND_Y || y > HAND_Y + CARD_H) return -1;
    for (let i = 0; i < this.hand.length; i++) {
      if (x >= this.hand[i].x && x <= this.hand[i].x + CARD_W) return i;
    }
    return -1;
  }

  /** What you are holding, shown as the creature rather than as a labelled box. */
  private makeGhost(card: Card, x: number, y: number) {
    const parts: Phaser.GameObjects.GameObject[] = [];
    for (let i = 0; i < card.count; i++) {
      // The same spread the match will use, so the ghost is a truthful preview
      // of where the bodies land rather than an approximation of it.
      const ox = (i - (card.count - 1) / 2) * CROWD_RADIUS * ARENA_SCALE;
      if (this.textures.exists(`pm-${card.sheet}`)) {
        const art = this.add.sprite(ox, -10, `pm-${card.sheet}`).setScale(SPRITE_SCALE);
        const walk = sprites.resolve(card.sheet, "Walk", 4);
        if (walk) art.play(walk, true);
        parts.push(art);
      } else {
        parts.push(this.add.circle(ox, -10, 8, rarityColor(card.rarity)));
      }
    }
    // A cost badge rides along, because the other half of the judgement is
    // whether you can still answer whatever they send back.
    parts.push(this.add.circle(0, 22, 11, C.elixir));
    parts.push(
      this.add.text(0, 22, String(card.elixir), style(13, C.text, "bold")).setOrigin(0.5),
    );
    return this.add.container(x, y, parts).setDepth(40).setAlpha(0.9);
  }

  /** The footprint the card will actually occupy, coloured by the same test the deploy enforces -- so it can never promise a drop that then fails. */
  private drawDropMarker(p: Phaser.Input.Pointer) {
    // Either gesture. This used to return unless a drag was in progress, but
    // the tap-to-select path calls it too -- so choosing a card and moving the
    // finger showed the ghost and no marker at all, and the one gesture a
    // touchscreen actually uses was the one placing blind.
    const slot = this.dragging?.slot ?? this.selected;
    if (slot === undefined) return;
    const card = this.match.hand[this.me][slot];
    if (!card) return;

    const raw = toWorld(p.x, p.y);
    // Where it will *land*, not where the finger is.
    //
    // The marker was drawn under the pointer, so it promised a position the
    // deploy would not honour. Near a tower the two differ by up to 46 units --
    // most of two bodies -- and a thrown or dropped card is exactly the case a
    // player aims carefully and then watches land somewhere else.
    const from = this.dragging ? toWorld(this.downAt?.x ?? p.x, this.downAt?.y ?? p.y) : raw;
    const w = this.match.nearestDeploy(
      this.me, raw.x, raw.y, from.x,
      cards.arrivesAnywhere(card.delivery), Boolean(card.delivery),
    );
    const ok = this.match.canDeploy(this.me, slot, w.x, w.y);
    const colour = ok ? 0x66ff80 : 0xff5959;
    const c = toScreen(w.x, w.y);

    // A leader line when the landing point is not under the finger, so the
    // snap is something you can see happening rather than a surprise.
    const at = toScreen(raw.x, raw.y);
    this.dropMarker.clear();
    if (Math.hypot(at.x - c.x, at.y - c.y) > 6) {
      this.dropMarker.lineStyle(1, colour, 0.45);
      this.dropMarker.lineBetween(at.x, at.y, c.x, c.y);
    }

    this.dropMarker.lineStyle(2, colour, 0.85);
    this.dropMarker.strokeEllipse(
      c.x, c.y,
      (13 + card.count * 5) * 2 * ARENA_SCALE,
      8 * 2 * ARENA_SCALE,
    );
    // One mark per body, so a card that spawns three reads as three.
    for (let i = 0; i < card.count; i++) {
      const ox = (i - (card.count - 1) / 2) * 14;
      const q = toScreen(w.x + ox, w.y);
      this.dropMarker.fillStyle(colour, ok ? 0.45 : 0.25);
      this.dropMarker.fillCircle(q.x, q.y - 4 * ARENA_SCALE, 4 * ARENA_SCALE);
    }
  }

  // ----------------------------------------------------------------- update

  override update(time: number, _delta: number) {
    // A fixed step, whatever the frame rate.
    //
    // The simulation is timestep-dependent -- separation, crowding and the
    // river push all integrate per frame -- so feeding it the real frame delta
    // meant the game played differently at different frame rates. Measured
    // before this change: of 40 matches run from identical seeds, only 13
    // reached the same outcome at 1/30 as at 1/60. A player on a 144Hz monitor
    // was playing a different game from one on a 60Hz laptop.
    //
    // Fixing the step also removes the blocker on multiplayer, where two
    // clients must agree on what happened, and on replays. It costs nothing
    // visible: at 60fps the match advances twice on alternate frames rather
    // than once per frame, and units move the same distance either way.
    //
    // Only the match ending stops the clock. An open dialog used to stop it
    // too, which made a real-time game pausable on demand: while the evolution
    // choice was up, elixir stopped filling, creatures stopped walking, and a
    // player could take as long as they liked to read the board. That is
    // survivable against a local bot and not survivable against a person, so it
    // was never a rule -- it was a renderer detail standing in for one. Time
    // passing while you decide is the cost of the decision.
    //
    // Real time, not Phaser's. `delta` comes from a loop that Phaser pauses on
    // `visibilitychange`, so it reports nothing at all for the time a tab spent
    // hidden -- switch away for thirty seconds and the game politely waited,
    // which is the same pause wearing a different hat. `performance.now()` keeps
    // counting when the loop does not.
    // Online, the simulation is somewhere else. Snapshots arrive fifteen times
    // a second and are written straight into the match, so there is nothing to
    // step and no time to owe -- the server's clock is the only clock.
    if (this.net) {
      this.water.update(time / 1000);
      this.fx.syncProjectiles(this.match.projectiles);
      this.syncUnits();
      for (const t of this.match.towers) this.towerViews.get(t.id)?.sync(t);
      this.syncHud();
      this.watchdog();
      this.drawDeployArea();
      if (this.showRings) this.drawRings();
      return;
    }

    const now = performance.now();
    // First frame of the scene owes nothing; it is starting, not returning.
    if (this.lastStepAt === 0) this.lastStepAt = now;
    this.accumulator = Math.min(
      this.accumulator + (now - this.lastStepAt) / 1000, MAX_CATCHUP,
    );
    this.lastStepAt = now;

    if (!this.match.over) {
      // Owing more than a couple of frames means this is a catch-up rather than
      // a normal step, and catch-up is simulated but not performed: see
      // COSMETIC.
      this.catchingUp = this.accumulator > SIM_STEP * 3;
      const deadline = now + CATCHUP_BUDGET_MS;
      while (this.accumulator >= SIM_STEP) {
        this.accumulator -= SIM_STEP;
        for (const e of this.match.update(SIM_STEP)) this.render(e);
        // The tutorial's opponent is the script, not an AI. It still needs an
        // AI object -- the loop would throw without one -- but letting it play
        // meant Snorlax and Charmander wandering in during a lesson about
        // stopping one Caterpie.
        if (!this.teaching) this.ai.update(this.match, SIM_STEP);
        if (this.match.over) break;
        // Out of budget: keep the rest of the debt and pay it next frame. The
        // time is not discarded, only deferred, which is the whole difference
        // between catching up and pretending it did not happen.
        if (this.catchingUp && performance.now() >= deadline) break;
      }
      this.catchingUp = false;
    } else {
      this.accumulator = 0;
    }
    this.water.update(time / 1000);
    this.fx.syncProjectiles(this.match.projectiles);
    this.syncUnits();
    for (const t of this.match.towers) this.towerViews.get(t.id)?.sync(t);
    this.syncHud();
    this.watchdog();
    this.coach();
    this.teach();
    this.drawDeployArea();
    if (this.showRings) this.drawRings();
  }

  private render(e: MatchEvent) {
    // While catching up, only the events that change what is on screen are
    // performed. The rest already happened and nobody was watching.
    if (this.catchingUp && COSMETIC.has(e.type)) return;
    switch (e.type) {
      case "spawn":
        this.views.set(e.unit.id, new UnitView(this, e.unit, this.unitLayer));
        break;

      case "mega": {
        // The unit keeps its identity but not its picture. Rebuilding the view
        // is simpler than teaching UnitView to swap sheets mid-life, and a
        // Mega happens once per side per match.
        this.views.get(e.unit.id)?.replace();
        const view = new UnitView(this, e.unit, this.unitLayer);
        this.views.set(e.unit.id, view);
        this.fx.cast(e.unit.x, e.unit.y, "ABILITY_THUNDER", C.gold);
        this.floatText(e.unit.x, e.unit.y - 26, "MEGA", C.gold, 13);
        break;
      }

      case "ready":
        // A small pop as it comes alive, so the moment it becomes dangerous is
        // something you see rather than something you infer.
        this.views.get(e.unit.id)?.ready();
        break;

      case "hit": {
        this.popDamage(e.target, e.amount, e.mult);
        // Melee shows the swing at the point of contact; ranged damage already
        // had a projectile crossing the gap, so it only needs the impact.
        const species = "card" in e.source ? e.source.card.sheet : undefined;
        if (species && e.source.range <= 30) this.fx.melee(e.target.x, e.target.y, species);
        else this.fx.impact(e.target.x, e.target.y, species, e.mult);
        // Melee contact is the moment to show the swing. Ranged creatures are
        // handled by `shot`, when they let go of it rather than when it lands.
        if (species && e.source.range <= 30 && e.source.id !== e.target.id) {
          this.views.get(e.source.id)?.swing();
        }
        break;
      }

      // The projectile itself needs no handler -- the core keeps it and the
      // renderer draws the live list every frame. What does need one is the
      // creature that fired: a tower whose rider sat idle through every shot
      // looked like a decoration bolted to a roof rather than the thing doing
      // the shooting.
      case "shot":
        if (e.from.isTower) this.towerViews.get(e.from.id)?.fire();
        else this.views.get(e.from.id)?.swing();
        break;

      case "cast":
        this.views.get(e.unit.id)?.cast();
        this.fx.cast(e.target.x, e.target.y, e.skill, rarityColor(e.unit.card.rarity));
        this.floatText(e.unit.x, e.unit.y - 22, e.skill.replace(/_/g, " "), C.gold, 12);
        break;

      case "death": {
        const v = this.views.get((e.thing as Unit).id);
        if (v) { v.die(); this.views.delete((e.thing as Unit).id); }
        break;
      }

      case "towerDown":
        this.fx.impact(e.tower.x, e.tower.y, undefined, 2);
        if (e.tower.side === this.them) {
          this.floatText(e.tower.x, e.tower.y - 30, "LANE OPEN", C.player, 16);
        }
        break;

      case "kingWakes":
        this.towerViews.get(e.tower.id)?.wake();
        this.floatText(e.tower.x, e.tower.y - 34, "KING AWAKE", C.gold, 16);
        break;

      case "evolve":
        if (e.side === this.me) this.showBanner(e.to, e.from.name);
        break;

      case "choice":
        // Only the side being asked. The offer is broadcast on one event
        // stream, and without this both players were shown "Choose an
        // evolution" for a card only one of them owns -- which is both a bug
        // and a tell, since it announces that the opponent is evolving.
        if (e.side === this.me) this.showChoice(e.id, e.options);
        break;

      case "over":
        this.finish(e.result);
        break;
    }
  }

  private syncUnits() {
    for (const u of this.match.units) this.views.get(u.id)?.sync(u);
    // Anything lower on the board draws in front, so a unit in the foreground
    // is not hidden behind one further up the lane.
    this.unitLayer.sort("y");
  }

  /**
   * Show the line for whatever the player has not yet done.
   *
   * Called once a frame from the HUD sync. Everything it decides comes from
   * the live match, so nothing has to be scripted or sequenced by a timer --
   * a player who never caps their elixir simply never sees that line.
   */
  private coach() {
    if (!this.coaching) return;
    const step = nextStep(this.match, this.me, this.coachRetired);

    if (step !== this.coachStep) {
      // Retire the one that just finished, so it cannot come back later in
      // the match and read as the game repeating itself.
      if (this.coachStep) this.coachRetired.add(this.coachStep.id);
      this.coachStep = step;
      this.drawCoach(step);
    }
    // Nothing left to teach: stop for good, on this browser.
    if (!step && this.coachRetired.size >= 2) {
      this.coaching = false;
      markCoached();
    }
  }

  private drawCoach(step?: Step) {
    this.coachBox?.destroy();
    this.coachText?.destroy();
    this.coachZone?.destroy();
    this.coachBox = undefined;
    this.coachText = undefined;
    this.coachZone = undefined;
    if (!step) return;

    // The band sits just under the clock, above the board, so it never covers
    // the half the player is being asked to drop a card on.
    const y = 96;
    this.coachText = this.add
      .text(DESIGN_W / 2, y, step.text, style(15, C.text))
      .setOrigin(0.5).setDepth(41)
      .setWordWrapWidth(DESIGN_W - 80);

    const b = this.coachText.getBounds();
    this.coachBox = this.add.graphics().setDepth(40);
    this.coachBox.fillStyle(C.edge, 0.88);
    this.coachBox.fillRoundedRect(b.x - 14, b.y - 9, b.width + 28, b.height + 18, 8);
    this.coachBox.lineStyle(2, C.gold, 0.9);
    this.coachBox.strokeRoundedRect(b.x - 14, b.y - 9, b.width + 28, b.height + 18, 8);

    if (!step.showZone) return;

    // Where you may legally drop, drawn once rather than described. Half the
    // question a new player has is "where am I allowed to put this".
    const top = toScreen(0, this.me === config.PLAYER
      ? config.arenaHeight / 2 + config.deployMargin : 0);
    const bottom = toScreen(config.arenaWidth, this.me === config.PLAYER
      ? config.arenaHeight : config.arenaHeight / 2 - config.deployMargin);
    this.coachZone = this.add.graphics().setDepth(9);
    this.coachZone.fillStyle(C.gold, 0.1);
    this.coachZone.fillRect(top.x, top.y, bottom.x - top.x, bottom.y - top.y);
    this.coachZone.lineStyle(2, C.gold, 0.5);
    this.coachZone.strokeRect(top.x, top.y, bottom.x - top.x, bottom.y - top.y);
  }

  /**
   * Begin a lesson: its hand, its elixir, and whatever it needs on the board.
   *
   * The hand is written directly rather than drawn, because a lesson that says
   * "drag Charmander" has to be able to promise Charmander is there. Elixir is
   * filled unless the lesson is about waiting for it.
   */
  private startLesson(index: number) {
    const lesson = LESSONS[index];
    this.lesson = lesson;
    this.lessonAt = index;
    this.lessonDone = false;
    if (!lesson) {
      // Taught everything. The rest is a match, so hand it back.
      markFinished();
      this.finishTutorial();
      return;
    }

    // Only when the lesson asks. Wiping between every lesson deleted the
    // Charmander the player had just placed -- the first lesson's whole point
    // -- and left the second lesson asking them to watch a creature that was
    // no longer there.
    if (lesson.clear) {
      for (const u of this.match.units) u.dead = true;
      this.match.units = [];
      this.views.forEach((v) => v.die());
      this.views.clear();
    }

    lesson.hand.forEach((id, i) => {
      const card = cards.byId(id) ?? cards.build(id);
      if (card && i < this.match.hand[this.me].length) {
        this.match.hand[this.me][i] = card;
      }
    });
    this.match.elixir[this.me] = lesson.elixir ?? config.elixirMax;

    for (const s of lesson.spawn ?? []) {
      const card = cards.byId(s.card);
      if (card) deploy.spawn(this.match, card, this.them, s.x, s.y);
    }
    this.drawLesson(lesson.text);
  }

  /** Watch for the lesson being done, then move on. */
  private teach() {
    if (!this.teaching || !this.lesson) return;

    /*
     * Hold the hand the lesson asked for.
     *
     * Playing a card draws the next one, so a lesson that says "drag
     * Charmander" was handing out Pikachu by its second sentence. Rewriting
     * every frame is blunt and correct: in a tutorial the deck is a prop, and
     * what matters is that the named card is where the line says it is.
     */
    /*
     * Only the slots the lesson names, and the rest left alone.
     *
     * Writing the whole hand filled it with four identical Diglett, which
     * reads as a broken hand rather than a taught one. The lesson owns its
     * first slot or two; the others stay whatever the deck dealt, so the hand
     * still looks like a hand.
     */
    const want = this.lesson.hand;
    for (let i = 0; i < want.length && i < this.match.hand[this.me].length; i++) {
      const held = this.match.hand[this.me][i];
      if (held?.id === want[i]) continue;
      // An evolved card is not the wrong card -- it is the lesson working, and
      // rewriting it would undo the evolution lesson the frame it succeeded.
      if (held && evolution.chainOf(want[i]).includes(held.id)) continue;
      const card = cards.byId(want[i]) ?? cards.build(want[i]);
      if (card) this.match.hand[this.me][i] = card;
    }

    if (this.lessonDone) return;
    if (!this.lesson.done(this.match, this.me)) return;

    this.lessonDone = true;
    /*
     * A beat on the answer before the next question.
     *
     * Long enough to *watch* what you just did, not only read about it --
     * reported as "Deoxys disappears", because the next lesson cleared the
     * board a second after it landed and the whole point of the lesson walked
     * off screen before it had done anything.
     */
    if (this.lesson.after) this.drawLesson(this.lesson.after);
    this.time.delayedCall(4200, () => this.startLesson(this.lessonAt + 1));
  }

  /** Hand the player a real match, and say so. */
  private finishTutorial() {
    this.teaching = false;
    this.drawCoach(undefined);
    this.add.rectangle(DESIGN_W / 2, DESIGN_H / 2, DESIGN_W, DESIGN_H, C.scrim, 0.72).setDepth(50);
    this.add.text(DESIGN_W / 2, DESIGN_H / 2 - 20, "THAT IS ALL OF IT", px(30, C.gold))
      .setOrigin(0.5).setDepth(51);
    this.add.text(DESIGN_W / 2, DESIGN_H / 2 + 30,
      "tap to go back and play", style(16, C.dim))
      .setOrigin(0.5).setDepth(51);
  }

  /** The lesson's line, reusing the coach's banner. */
  private drawLesson(text: string) {
    this.drawCoach({
      id: "lesson", text,
      showZone: this.lesson?.showZone,
      when: () => true, done: () => false,
    });
  }

  /**
   * The rules say the match is over; make sure the player can see that.
   *
   * A player photographed a board frozen at 0:00 with no result and nothing to
   * tap. The rules end matches correctly -- checked directly, and on
   * production -- and three attempts to reproduce the freeze all ended
   * normally, so the cause is still unknown.
   *
   * This does not pretend to know it. It watches for the one state that must
   * never persist -- the match decided while the screen still shows a game --
   * and shows the result. Whatever swallowed the event, the player gets an
   * answer and a way back to the menu.
   */
  private watchdog() {
    if (this.over || !this.match.over) return;
    this.finish(this.match.over === "player" ? "player"
      : this.match.over === "enemy" ? "enemy" : "draw");
  }

  private syncHud() {
    const m = Math.floor(this.match.time / 60);
    const s = Math.floor(this.match.time % 60);
    const urgent = this.match.time <= config.suddenDeathAt;
    this.clockText.setText(`${m}:${s.toString().padStart(2, "0")}`);
    this.clockText.setColor(urgent ? hex(C.elixir) : hex(C.text));
    this.clockBox.setFillStyle(urgent ? C.elixir : 0x000000, urgent ? 0.18 : 0.35);

    const elixir = this.match.elixir[this.me];
    for (let i = 0; i < this.pips.length; i++) {
      this.pips[i].setScale(Math.max(0, Math.min(1, elixir - i)), 1);
    }
    this.elixirText.setText(elixir.toFixed(1));
    this.megaButton?.update();
    this.enemyElixirText?.setText(
      `opponent ${this.match.elixir[this.them].toFixed(1)}`,
    );

    for (let i = 0; i < this.hand.length; i++) {
      // A card being dragged is out of its slot, so the slot is drawn empty --
      // Clash Royale's rule, and the thing that makes putting it back a visible
      // option rather than a guess.
      const held = this.dragging?.slot === i
        ? undefined
        : this.match.hand[this.me][i];
      // Draw the body it would actually deploy as. Tapping Deoxys again cycles
      // its form, and the card face is the only place that choice is visible --
      // so the face has to be the form, not the card the form came from.
      const card = held && hand.formOf(this.match, this.me, held);
      // Ditto's price is its copy target plus one, so the badge has to ask the
      // match rather than read the card. A printed cost that lies is worse than
      // no cost at all.
      //
      // Everything but the art is asked about `held`, the card in the hand,
      // because that is what the rules charge and evolve. A form is a body, not
      // a different card: deploying Deoxys-Attack costs Deoxys' elixir, and
      // printing the form's own number would be exactly the lying badge this
      // comment already warns about.
      const price = held ? this.match.costOf(this.me, held) : 0;
      this.hand[i].update(card, {
        affordable: held ? elixir >= price : false,
        priceOverride: held && (held.copies || held !== card) ? price : undefined,
        copyOf: held ? this.match.copyTarget(this.me, held)?.name : undefined,
        selected: this.selected === i,
        progress: held ? this.match.evolutionProgress(this.me, held) : undefined,
      });
    }
  }

  /** Where you may drop, which is not a constant. */
  /** Where you may drop, shown only while you are holding something. */
  private drawDeployArea() {
    const g = this.deployLine;
    g.clear();

    const slot = this.dragging?.slot ?? this.selected;
    if (slot === undefined || this.match.over) return;
    const held = this.match.hand[this.me][slot];
    if (!held) return;

    const w = config.arenaWidth * ARENA_SCALE;
    const half = config.arenaHeight / 2;

    if (cards.arrivesAnywhere(held.delivery)) {
      // The whole board, marked as such.
      const a = toScreen(0, 0);
      const b = toScreen(config.arenaWidth, config.arenaHeight);
      g.fillStyle(C.player, 0.10);
      g.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
      g.lineStyle(2, C.player, 0.85);
      g.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
      return;
    }

    const line = toScreen(0, half + config.deployMargin);
    g.fillStyle(C.player, 0.10);
    g.fillRect(ARENA_X, line.y, w, ARENA_Y + config.arenaHeight * ARENA_SCALE - line.y);
    g.fillStyle(C.player, 0.9);
    g.fillRect(ARENA_X, line.y, w, Math.max(2, 2 * ARENA_SCALE));

    // Each opened lane, shaded to exactly where it now ends.
    //
    // This shaded to the enemy baseline, which stopped being true when the
    // opened area was bounded at the tower you broke. A deploy overlay that
    // claims ground the rules refuse is worse than none: you aim at it, the
    // drop snaps somewhere else, and nothing explains why.
    for (let lane = 0; lane < 2; lane++) {
      const x = lane === 0 ? 0 : config.arenaWidth / 2;
      const broken = this.match.towers.find(
        (t) => t.side !== this.me && t.kind === "side" && t.dead &&
          (t.x < config.arenaWidth / 2 ? 0 : 1) === lane);
      if (!broken) continue;
      const top = broken.y + config.towerBox.side.up;
      const a = toScreen(x, top);
      const b = toScreen(x + config.arenaWidth / 2, half + config.deployMargin);
      g.fillStyle(C.player, 0.12);
      g.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
      g.lineStyle(2, C.player, 0.8);
      g.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
    }
  }

  /** The notice radius, drawn as what it actually is: a circle centred on the unit. */
  private drawRings() {
    this.rings.clear();
    for (const u of this.match.units) {
      const p = toScreen(u.x, u.y);
      this.rings.lineStyle(1, u.side === this.me ? C.player : C.enemy, 0.34);
      this.rings.strokeCircle(p.x, p.y, u.aggro * ARENA_SCALE);
      this.rings.lineStyle(1, C.gold, 0.45);
      this.rings.strokeCircle(p.x, p.y, u.range * ARENA_SCALE);
    }
  }

  // --------------------------------------------------------------- feedback

  private popDamage(target: Thing, amount: number, mult: number) {
    if (amount <= 0) return;
    const colour = mult > 1 ? C.gold : mult < 1 ? C.dim : C.text;
    this.floatText(target.x, target.y - 14, String(amount), colour, mult !== 1 ? 17 : 14);

    // The named verdict for a lopsided hit. Drawn in screen space, because
    // inside an arena transform the font would scale with the world.
    const label = effectivenessLabel(mult);
    if (label && mult !== 1) this.floatText(target.x, target.y - 32, label, colour, 12);

    const view = this.views.get((target as Unit).id) ?? this.towerViews.get(target.id);
    view?.flash();
  }

  private floatText(wx: number, wy: number, text: string, colour: number, size: number) {
    const p = toScreen(wx, wy);
    // Outlined, for the reason the nameplate is: these are drawn over grass,
    // and C.text and C.gold both sit near grass's own luma, so an unstroked
    // number is legible against the UI panels it was designed on and vanishes
    // on the board where it is actually used.
    const t = this.add
      .text(p.x, p.y, text, {
        ...style(size, colour, "bold"),
        stroke: "#000000",
        strokeThickness: 3,
      })
      .setOrigin(0.5).setDepth(25);
    this.tweens.add({
      targets: t, y: p.y - 26, alpha: 0, duration: 700,
      ease: "Quad.easeOut", onComplete: () => t.destroy(),
    });
  }

  /** Evolution is the biggest thing that can happen to your hand, so it is announced over the board rather than left for you to notice on a card. */
  private showBanner(card: Card, fromName: string) {
    this.banner?.destroy(true);
    const y = ARENA_Y + config.arenaHeight * ARENA_SCALE * 0.34;
    const w = config.arenaWidth * ARENA_SCALE;

    const bg = this.add.rectangle(0, 0, w, 62, 0x000000, 0.55);
    const big = this.add.text(0, -12, `${card.name}!`, style(30, C.gold, "bold")).setOrigin(0.5);
    const sub = this.add.text(0, 18, `${fromName} evolved`, style(15, C.text)).setOrigin(0.5);

    this.banner = this.add.container(DESIGN_W / 2, y, [bg, big, sub]).setDepth(35);
    this.tweens.add({
      targets: this.banner, alpha: 0, delay: 1500, duration: 700,
      onComplete: () => { this.banner?.destroy(true); this.banner = undefined; },
    });
  }

  /** Branching evolution. */
  /** The evolution picker, in the DOM. */
  private showChoice(choiceId: string, options: Card[]) {
    const modal = openModal({
      title: "Choose an evolution", dismissable: false, blocking: false,
    });
    this.choiceUI = this.add.container(0, 0).setDepth(45);

    const row = document.createElement("div");
    row.className = "lr-choices";
    options.forEach((card) => {
      row.append(choiceButton({
        art: portraits.styleFor(card.sheet, 72),
        name: card.name,
        sub: `${card.elixir} elixir`,
        onPick: () => {
          if (this.net) this.net.choose(choiceId, card.id);
          else this.match.takeChoice(this.me, choiceId, card.id);
          modal.close();
          this.choiceUI?.destroy(true);
          this.choiceUI = undefined;
        },
      }));
    });
    modal.body.append(row);
  }

  /**
   * End the match from what we already know, because nobody will tell us.
   *
   * The server decides every result and sends it. If the connection dies
   * first, that message never arrives -- so a match whose king is already
   * down, or whose clock has already run out, would sit there forever.
   *
   * The rules used here are the server's own, applied to the last state we
   * received: a fallen king decides it, otherwise towers standing, otherwise
   * remaining tower health. It is only ever a guess about a match we can no
   * longer see, so it does not touch the record -- `finish` does that, and
   * this deliberately calls it only when the outcome is not in doubt.
   */
  private endLocally() {
    if (this.over) return;
    const kingDown = (side: Side) =>
      this.match.towers.some((t) => t.side === side && t.kind === "king" && t.dead);

    if (kingDown(config.ENEMY)) return this.finish("player");
    if (kingDown(config.PLAYER)) return this.finish("enemy");
    if (this.match.time <= 0) {
      const mine = this.match.towersLeft(config.PLAYER);
      const theirs = this.match.towersLeft(config.ENEMY);
      if (mine !== theirs) return this.finish(mine > theirs ? "player" : "enemy");
      const hpMine = this.match.towerHealth(config.PLAYER);
      const hpTheirs = this.match.towerHealth(config.ENEMY);
      return this.finish(
        Math.abs(hpMine - hpTheirs) < 0.01 ? "draw" : hpMine > hpTheirs ? "player" : "enemy");
    }
    // Still a live match as far as we know: say so, and let them leave.
    this.abandonScreen();
  }

  /** The match is unfinished and unreachable. Do not pretend to know a result. */
  private abandonScreen() {
    this.over = true;
    this.add.rectangle(DESIGN_W / 2, DESIGN_H / 2, DESIGN_W, DESIGN_H, C.scrim, 0.72).setDepth(50);
    this.add.text(DESIGN_W / 2, DESIGN_H / 2 - 16, "CONNECTION LOST", px(30, C.dim))
      .setOrigin(0.5).setDepth(51);
    this.add.text(DESIGN_W / 2, DESIGN_H / 2 + 22, "tap to go back", px(16, C.dim))
      .setOrigin(0.5).setDepth(51);
    this.input.once("pointerdown", () => this.scene.start("Menu"));
  }

  private finish(result: "player" | "enemy" | "draw") {
    if (this.over) return;
    this.over = true;

    /*
     * The way out, registered first.
     *
     * Everything below can throw -- storage, a font, a texture -- and the
     * guard above means finish() will never run again. Registering the tap
     * last meant one bad frame left a player looking at a frozen board with no
     * result and no way back to the menu, which is exactly what was
     * photographed at 0:00.
     */
    this.input.once("pointerdown", () => this.scene.start("Menu"));
    /*
     * `result` names the side that won, not *your* result.
     *
     * "player" means side one, and the very same string goes to both seats --
     * so reading it directly told whoever sat in seat two that they had lost
     * a match they had just won, and recorded the loss. It was invisible in
     * single player, where you are always side one and the two readings agree.
     */
    const mine: "player" | "enemy" | "draw" =
      result === "draw" ? "draw"
        : (result === "player") === (this.me === config.PLAYER) ? "player" : "enemy";

    // `recordResult` guards its own storage, so a browser refusing to write
    // costs a tally rather than the screen.
    recordResult(mine);
    /*
     * And tell the server the match happened at all.
     *
     * Only offline and tutorial matches: online ones the server ran itself and
     * already counted. Not awaited -- the result screen is drawn below and
     * must not wait for a network round trip to appear.
     */
    const outcome = mine === "player" ? "win" : mine === "enemy" ? "loss" : "draw";
    if (!this.net) {
      // The result goes with it. A tutorial has no winner, so it sends none
      // and the account's counters do not move.
      played.record(
        this.teaching ? "tutorial" : "offline",
        this.teaching ? undefined : outcome,
      );
    }

    /*
     * What the match was worth.
     *
     * Not the tutorial: paying for a scripted match makes the tutorial the
     * cheapest way to farm, which is a thing people will find within a day.
     */
    const earned = this.teaching ? undefined : collection.reward(outcome);
    const label = mine === "player" ? "YOU WIN" : mine === "enemy" ? "YOU LOSE" : "DRAW";
    const colour = mine === "player" ? C.hp : mine === "enemy" ? C.enemy : C.dim;

    this.add.rectangle(DESIGN_W / 2, DESIGN_H / 2, DESIGN_W, DESIGN_H, C.scrim, 0.72).setDepth(50);
    this.add.text(DESIGN_W / 2, DESIGN_H / 2 - 20, label, px(42, colour))
      .setOrigin(0.5).setDepth(51);
    /*
     * What the match paid, said here.
     *
     * A reward the player is not told about may as well not have happened --
     * and this is the only moment they are looking. A pack earned is the
     * loud line; the coins and the countdown are the quiet one that makes
     * the next match feel like it is going somewhere.
     */
    if (earned) {
      this.add
        .text(DESIGN_W / 2, DESIGN_H / 2 + 34, `+${earned.coins} coins`, px(20, C.gold))
        .setOrigin(0.5)
        .setDepth(51);

      const note = earned.pack
        ? "A PACK! open it from the menu"
        : `${earned.toNextPack} more ${earned.toNextPack === 1 ? "match" : "matches"} for a free pack`;
      this.add
        .text(DESIGN_W / 2, DESIGN_H / 2 + 66, note,
          style(16, earned.pack ? C.gold : C.dim))
        .setOrigin(0.5)
        .setDepth(51);
    }

    this.add.text(DESIGN_W / 2, DESIGN_H / 2 + 104, "tap to continue", style(18, C.dim))
      .setOrigin(0.5).setDepth(51);

    this.input.once("pointerdown", () => this.scene.start("Menu"));
  }
}

// ---------------------------------------------------------------- the views

/** A creature: sprite, shadow, health bar and element chips. */
class UnitView {
  private sprite: Phaser.GameObjects.Sprite;
  private shadow: Phaser.GameObjects.Ellipse;
  private bar: Phaser.GameObjects.Rectangle;
  private barBg: Phaser.GameObjects.Rectangle;
  private chips: Phaser.GameObjects.Rectangle[] = [];
  /** The name that fades after landing. Undefined once it has. */
  private name?: Phaser.GameObjects.Text;
  /** One dot per active status. Grown on demand, never shrunk. */
  private statusPips: Phaser.GameObjects.Arc[] = [];
  private barW = 30;
  /** Mid-arc, so the landing can put depth and shadow back. */
  private arriving = false;
  private spawnRing?: Phaser.GameObjects.Graphics;
  private current = "";
  /** Frames left of the cast pose, if one is playing. Counted in sync(). */
  private castFor = 0;
  /** A swing landed this frame, so the attack pose is played again. */
  private swung = false;

  /** Show this creature casting, for a beat. */
  cast() { this.castFor = 12; }

  /*
   * A blow landed: show the swing again.
   *
   * Attack poses are registered as one-shots, and the animation is only
   * started when the *key* changes -- so a creature standing in one place
   * hitting the same target played its attack once and then held the last
   * frame for the rest of the fight. It looked like it had no attack
   * animation at all, which is exactly how it was reported. Casts escaped
   * this only because `cast()` changes the key and back.
   */
  swing() { this.swung = true; }

  /** Half the drawn body height: what the bar and chips have to clear. */
  private lift: number;
  /** Drawn body width, for the shadow and the landing ring. */
  private girth: number;

  constructor(private scene: Phaser.Scene, u: Unit, layer: Phaser.GameObjects.Container) {
    const p = toScreen(u.x, u.y);

    // Furniture is sized from the creature's own art, not from one constant.
    // An Onix and a Caterpie wearing the same 30px bar and the same shadow made
    // the big one look pasted on; and once sprites grew, a fixed bar offset put
    // the bar through the tall ones' heads.
    const sheet = sprites.SHEETS[u.card.sheet];
    this.girth = (sheet?.bodyWidth ?? config.referenceBody) * SPRITE_SCALE;
    this.lift = ((sheet?.bodyHeight ?? config.referenceBody) * SPRITE_SCALE) / 2;

    this.shadow = scene.add.ellipse(
      p.x, p.y + 4, this.girth * 0.78, this.girth * 0.34, 0x000000, 0.3);
    this.sprite = scene.add.sprite(p.x, p.y, `pm-${u.card.sheet}`).setScale(SPRITE_SCALE);

    // Wide enough to read, never wider than the creature it belongs to.
    const w = Math.round(Phaser.Math.Clamp(this.girth, FOOTPRINT * 0.8, FOOTPRINT * 2));
    this.barW = w;
    this.barBg = scene.add.rectangle(p.x, p.y, w, 4, 0x000000, 0.55);
    this.bar = scene.add
      .rectangle(p.x - w / 2, p.y, w, 4, u.side === viewingFrom() ? C.player : C.enemy)
      .setOrigin(0, 0.5);

    // Element pips: small chips in the type colours. Not text -- at this size a
    // word is unreadable, but "the red one is losing to the blue one" is
    // legible at a glance, and that is the whole decision.
    for (const t of typesOf(u.card.sheet).slice(0, 2)) {
      this.chips.push(scene.add.rectangle(0, 0, 6, 3, asColour(TYPE_COLORS[t])));
    }

    // Its name, for as long as it takes to read once.
    //
    // A player asked for this after a drop and the reason is the obvious one:
    // 43 creatures is more than anyone holds in their head, and a 24-pixel
    // sprite at arena scale is not a label. Permanent nameplates would be
    // twenty overlapping words in a fight, so it fades -- long enough to answer
    // "what did I just put down", gone before it becomes clutter.
    // White with a side-coloured outline, not side-coloured text.
    //
    // The team colours are a light blue and a light red picked to read on the
    // dark UI panels, and on grass they do not: C.player is luma 166 against
    // grass at 148, so the two are nearly the same brightness and only hue
    // separates them. Nine-pixel text over tufted terrain then vanishes. White
    // is luma 255 against everything on the board, and moving the team colour
    // into a heavy outline keeps whose-unit-is-it legible without asking the
    // fill to do a job it cannot.
    this.name = scene.add
      .text(p.x, p.y, u.card.name, {
        ...style(9, C.text, "bold", true),
        stroke: hex(u.side === viewingFrom() ? 0x123c5e : 0x5e1212),
        strokeThickness: 3,
      })
      .setOrigin(0.5, 1);
    scene.tweens.add({
      targets: this.name, alpha: 0, delay: 1400, duration: 600,
      onComplete: () => { this.name?.destroy(); this.name = undefined; },
    });

    layer.add([this.shadow, this.sprite, this.barBg, this.bar, ...this.chips, this.name]);
    this.sync(u);
  }

  sync(u: Unit) {
    const p = toScreen(u.x, u.y);

    // Leaping the river.
    //
    // The same trick the throw uses -- shadow on the true position, sprite
    // lifted above it -- because it is the same event: a body in the air over
    // ground it is not touching. A player put it plainly, that a river-jumper
    // "walks" when it should jump, and they were right that the walk was the
    // whole problem. The rule was never wrong; it just had no picture.
    if (u.leap) {
      const k = Math.min(1, u.leap.t / u.leap.dur);
      const z = FOOTPRINT * 2.2 * 4 * k * (1 - k);
      this.sprite.setPosition(p.x, p.y - z).setAlpha(1).setDepth(40);
      this.shadow.setPosition(p.x, p.y + 4)
        // Tightest at the apex, so the height reads even against flat water.
        .setScale(1 - 0.35 * 4 * k * (1 - k))
        .setAlpha(0.30 - 0.12 * 4 * k * (1 - k));
      const hop = sprites.resolve(u.card.sheet, "Hop", viewFacing(u.facing));
      if (hop && hop !== this.current) { this.current = hop; this.sprite.play(hop, true); }
      this.bar?.setPosition(p.x, p.y - z - this.girth);
      return;
    }

    // Landing. A unit that is on the board and cannot act has to look like it:
    // translucent, with a ring that closes as the timer runs down. Without the
    // ring the delay reads as the game being laggy rather than as a rule.
    if (u.spawning > 0) {
      // The unit's own total, not the card's. A thrown card's arrival is timed
      // by distance, so two Voltorbs from the same card can be in the air for
      // different lengths of time and each has to draw its own progress.
      const frac = 1 - u.spawning / Math.max(0.01, u.arriveTime);

      // Arriving, for the cards that arrive rather than appear.
      //
      // Height in a flat engine is the trick legend-of-lua's vessel.lua uses:
      // the shadow stays at the true position and the sprite is drawn offset
      // upward. A throw is a long jump -- the same arc with the shadow
      // travelling from a to b -- and a drop is the degenerate case where it
      // does not travel, so the shadow has to carry the timing on its own.
      // That is why it starts wide and tightens: a stationary shadow must show
      // the countdown that a moving one shows by moving.
      const mode = u.card.delivery;
      if (mode === "drop" || mode === "throw") {
        const t = toScreen(u.x, u.y);
        // Where it came from: straight above for a drop, your own baseline for
        // a throw.
        const fromY = u.side === config.PLAYER ? config.arenaHeight : 0;
        const start = mode === "throw" ? toScreen(u.x, fromY) : t;
        const px = start.x + (t.x - start.x) * frac;
        const py = start.y + (t.y - start.y) * frac;
        // Falling accelerates; a throw is a parabola over its whole path.
        //
        // `1 - frac^2`, not `(1 - frac)^2`. The comment always said accelerates
        // and the maths did the opposite: squaring the *remaining* time makes
        // the sprite drop fastest at the start and creep at the end, so a
        // Snorlax was visually on the ground by 70% of its timer and then sat
        // there for the last 0.66s. It waits 2.2 seconds and reads as instant,
        // which is precisely how a player described it -- "snorlax is fast, not
        // slow, it drops quite fast".
        const peak = FOOTPRINT * (mode === "throw" ? 2.4 : 5);
        const z = mode === "throw"
          ? peak * 4 * frac * (1 - frac)
          : peak * (1 - frac * frac);

        this.sprite.setPosition(px, py - z).setAlpha(1).setDepth(40);
        this.shadow.setPosition(px, py + 4)
          .setScale(1 + (1 - frac) * 1.6)
          .setAlpha(0.12 + 0.22 * frac);
        // The landing ring would fight the shadow, which is now the timer.
        this.spawnRing?.destroy();
        this.spawnRing = undefined;
        const key = sprites.resolve(u.card.sheet, "Hop", viewFacing(u.facing));
        if (key && key !== this.current) { this.current = key; this.sprite.play(key, true); }
        return;
      }

      /*
       * Tunnelling: underground, then out.
       *
       * Diglett's whole idea is that it arrives from below, and it was drawn
       * standing translucently on the spot like everything else -- "does not
       * use dig to spawn", exactly as reported. The sheets have had a DigIn
       * animation for both Diglett and Dugtrio the whole time, unused.
       *
       * Played in reverse, because digging *in* run backwards is coming out,
       * and it is the same frames either way. For the first stretch there is
       * nothing to see but disturbed ground: a unit that cannot be hit should
       * not be standing there looking hittable.
       */
      if (mode === "tunnel") {
        /*
         * Diving in, crossing, coming up.
         *
         * The sheet's DigIn is not a creature burrowing -- it is a burst of
         * soil, clumps of earth thrown outward, with Diglett already gone. Its
         * later frames only grow because the debris scatters wider. Holding one
         * of them for the journey put a pile of golden lumps on the board and
         * earned the question "what do you call this animation".
         *
         * So it is used for what it depicts: the moment of going under. The
         * crossing is drawn here instead, as a small ridge of turned earth,
         * because nothing in the sheets shows a Pokemon travelling below
         * ground and a top-down mound is legible in a way a side-on effect is
         * not. Coming up is the same burst played backwards -- soil gathering
         * rather than spraying.
         */
        const dug = sprites.resolve(u.card.sheet, "DigIn", viewFacing(u.facing));
        const diving = frac < 0.2;
        const surfacing = frac >= 0.78;
        this.sprite.setAlpha(1);

        if (dug) {
          const dir = dug.split(":")[2];
          if (diving || surfacing) {
            const key = `${dug}:${diving ? "in" : "out"}`;
            if (this.current !== key) {
              this.current = key;
              if (diving) this.sprite.play(dug, true);
              else this.sprite.playReverse(dug, true);
            }
          } else {
            /*
             * Crossing: the sheet's own mound, frames six to eight.
             *
             * Those three are turned earth and nothing else -- frame nine is
             * where the head starts showing. A hand-drawn ellipse stood in here
             * for a while and was wrong twice over: vector shapes in a pixel
             * game, and unnecessary, because the art existed the whole time. I
             * had dismissed these frames as "too small" without looking at
             * them.
             *
             * Cycled slowly rather than held, so the soil shifts as it travels
             * -- which is what makes it read as burrowing rather than sliding.
             */
            this.sprite.anims.stop();
            this.current = "";
            this.sprite.setFrame(`DigIn-${dir}-${6 + (Math.floor(frac * 26) % 3)}`);
          }
        }

        // The sprite has to be carried along too. This branch returns before
        // the usual position update, so without this the dive and the surfacing
        // both animated back at the king tower while the mound travelled on
        // its own -- and the creature appeared to teleport at the end.
        this.sprite.setPosition(p.x, p.y);
        this.shadow.setPosition(p.x, p.y + 4).setAlpha(0);
        this.spawnRing?.destroy();
        this.spawnRing = undefined;
        // The bar *and* the name, or the label stays behind at the king tower
        // announcing a Diglett that is already halfway up the board.
        const barY = p.y - this.girth;
        this.bar?.setPosition(p.x, barY);
        this.barBg?.setPosition(p.x, barY);
        this.name?.setPosition(p.x, barY - 11);
        return;
      }
      this.sprite.setAlpha(0.45);
      if (!this.spawnRing) {
        this.spawnRing = this.scene.add.graphics().setDepth(11);
        (this.sprite.parentContainer ?? this.scene.children).add(this.spawnRing);
      }
      this.spawnRing.clear();
      this.spawnRing.lineStyle(2, u.side === viewingFrom() ? C.player : C.enemy, 0.9);
      this.spawnRing.beginPath();
      this.spawnRing.arc(p.x, p.y + 4, this.girth * 0.55,
        -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
      this.spawnRing.strokePath();

      /*
       * Stop here, the way a drop or a throw does.
       *
       * Everything below this decides which walking or idling animation a unit
       * on the board should be showing, and it runs on the same frame -- so a
       * dig chosen up there was overwritten by Idle before it drew even once.
       * The animation looked missing and the resolve looked broken; neither
       * was. A unit that has not arrived has no business being animated as
       * though it had.
       */
      if (mode === "tunnel") {
        this.shadow.setPosition(p.x, p.y + 4);
        this.bar?.setPosition(p.x, p.y - this.girth);
        return;
      }
    } else if (this.spawnRing) {
      this.spawnRing.destroy();
      this.spawnRing = undefined;
      this.sprite.setAlpha(1);
    }
    // The mound has to shrink back to a shadow and the sprite come back from
    // hidden, or a tunneller surfaces invisible. Only the scale is put back
    // here: alpha is rewritten from `u.flying` every frame further down.
    if (u.spawning <= 0 && u.card.delivery === "tunnel" && this.shadow.alpha === 0) {
      // Surfaced: the shadow it travelled without comes back.
      this.sprite.setAlpha(1);
      this.shadow.setScale(1);
    }
    if (u.spawning <= 0 && this.arriving) {
      // Undo what the arrival did: the shadow was scaled up to telegraph and
      // the sprite lifted above everything so it read as being in the air.
      this.arriving = false;
      this.sprite.setDepth(0);
      this.shadow.setScale(1);
      this.current = "";
    }
    if (u.spawning > 0 && (u.card.delivery === "drop" || u.card.delivery === "throw")) {
      this.arriving = true;
    }

    // Fliers sit above their shadow so they read as off the ground. Scaled to
    // the board, so the gap stays proportional rather than shrinking away.
    const lift = u.flying ? 14 * ARENA_SCALE : 0;
    this.sprite.setPosition(p.x, p.y - lift).setDepth(p.y);
    this.shadow.setPosition(p.x, p.y + 4).setAlpha(u.flying ? 0.18 : 0.3);

    // A cast overrides the walk/attack pose while it plays. Held on a timer
    // rather than driven by the simulation, because how long an animation runs
    // is a rendering question -- core says "it cast", not "for 0.4 seconds".
    if (this.castFor > 0) this.castFor -= 1;
    const action = this.castFor > 0 ? "Cast" : u.action;
    const key = sprites.resolve(u.card.sheet, action, viewFacing(u.facing));
    if (key && this.swung) {
      // Resolved fresh rather than reusing `current`, so a swing that arrives
      // a frame before the action flips still shows the attack and not the walk.
      this.swung = false;
      this.current = key;
      this.sprite.play(key);
    } else if (key && key !== this.current) {
      this.current = key;
      this.sprite.play(key, true);
    }

    const frac = Math.max(0, u.hp / u.maxHP);
    // Clear of the creature's own head, whatever size that head is.
    const barY = p.y - this.lift - 8 - lift;
    this.bar.setPosition(p.x - this.barW / 2, barY).setScale(frac, 1);
    this.barBg.setPosition(p.x, barY);
    // Hidden at full health: twenty untouched units each wearing a full green
    // bar is noise that hides the one actually hurt.
    this.bar.setVisible(frac < 1);
    this.barBg.setVisible(frac < 1);

    const total = this.chips.length * 7.5;
    this.chips.forEach((c, i) => c.setPosition(p.x - total / 2 + i * 7.5 + 3, barY - 6));

    // Status pips, on the row above the type chips so the two never collide.
    while (this.statusPips.length < u.statuses.length) {
      const pip = this.scene.add.circle(0, 0, 3, 0xffffff).setDepth(12);
      (this.sprite.parentContainer ?? this.scene.children).add(pip);
      this.statusPips.push(pip);
    }
    this.statusPips.forEach((pip, i) => {
      const st = u.statuses[i];
      if (!st) { pip.setVisible(false); return; }
      const w = u.statuses.length * 9;
      pip.setVisible(true)
        .setFillStyle(STATUS_COLOUR[st.kind] ?? 0xffffff)
        .setPosition(p.x - w / 2 + i * 9 + 4, barY - 14);
    });
    // Above the chips, which are above the bar, so the label never sits on the
    // creature's own art however tall that creature is.
    this.name?.setPosition(p.x, barY - 11);
  }

  /** The moment it comes alive. */
  ready() {
    this.sprite.setAlpha(1);
    this.spawnRing?.destroy();
    this.spawnRing = undefined;
    this.scene.tweens.add({
      targets: this.sprite,
      scaleX: this.sprite.scaleX * 1.25, scaleY: this.sprite.scaleY * 1.25,
      duration: 110, yoyo: true,
    });
  }

  flash() {
    this.sprite.setTintFill(0xffffff);
    this.scene.time.delayedCall(60, () => this.sprite.clearTint());
  }

  /** Tear down at once, leaving no death animation. Used when a Mega replaces the view. */
  replace() {
    this.spawnRing?.destroy();
    this.name?.destroy();
    for (const p of this.statusPips) p.destroy();
    this.barBg.destroy();
    this.bar.destroy();
    for (const c of this.chips) c.destroy();
    this.sprite.destroy();
    this.shadow.destroy();
  }

  die() {
    this.spawnRing?.destroy();
    this.name?.destroy();
    for (const p of this.statusPips) p.destroy();
    this.barBg.destroy();
    this.bar.destroy();
    for (const c of this.chips) c.destroy();
    this.scene.tweens.add({
      targets: [this.sprite, this.shadow], alpha: 0, scaleX: 0.2, scaleY: 0.2,
      duration: 260,
      onComplete: () => { this.sprite.destroy(); this.shadow.destroy(); },
    });
  }
}

/** A tower: real stonework, a team banner, and health off the roofline. */
class TowerView {
  private body: Phaser.GameObjects.Image | Phaser.GameObjects.Rectangle;
  private bar: Phaser.GameObjects.Rectangle;
  private barBg: Phaser.GameObjects.Rectangle;
  private crown?: Phaser.GameObjects.Text;
  /** Public so a test can ask where this seat believes the tower stands. */
  ring: Phaser.GameObjects.Ellipse;
  private banner: Phaser.GameObjects.Rectangle;
  /** The creature sitting on the mount, if this tower carries one. */
  private rider?: Phaser.GameObjects.Sprite;
  /** Where the mount ended up after the art was slid inside the board. */
  private mountY = 0;
  private riderSpecies?: string;
  /** Built once, the frame the tower falls. */
  private ruined = false;
  private riderFacing = 0;

  constructor(private scene: Phaser.Scene, t: Tower, troopId?: string) {
    const p = toScreen(t.x, t.y);
    const w = config.towerSize[t.kind] * ARENA_SCALE;
    const colour = t.side === viewingFrom() ? C.player : C.enemy;
    const art = arena.TOWER_ART[t.kind];
    let baseY = p.y + w * 0.42;

    // Ground shadow and a team ring, the same language the units use.
    this.ring = scene.add.ellipse(p.x, baseY, w * 1.24, w * 0.52, 0x000000, 0.28).setDepth(4);
    this.ring.setStrokeStyle(2, colour, 0.75);

    let top: number;
    const key = `tower-${art?.sheet}-${t.side === viewingFrom() ? "player" : "enemy"}`;
    if (art && scene.textures.exists(key)) {
      const z = w / art.w;
      const [, my] = art.mount;

      // Anchored by its *mount*, and by nothing else.
      //
      // Anchoring the base put the whole sprite above the tower's position, and
      // these towers are tall: the king's art is 116px of spire on an 85-unit
      // footprint, so it drew 183 design pixels straight up. Hanging it from the
      // mount puts the seat exactly where the tower logically is, and lets the
      // staircase fall below.
      //
      // A king does not fit inside the board that way -- it sits 52 units from
      // its own back edge and needs 61, so their spire wants 11px above the
      // board and our staircase wants 48px below it. An earlier version slid the
      // building inward until it fit, which is the one thing that must not
      // happen: the hitbox cannot slide with it, so the drawn tower stopped
      // being where the tower *is*. Measured, that was 9 arena units on their
      // king and 41 on ours, and a creature that stopped against the king's real
      // face was drawn standing on top of the art.
      //
      // So the art stays honest and the overflow is dealt with as overflow.
      // Downward it is cropped at the board edge, because what hangs below the
      // mount is staircase and a tower cut off by its own baseline reads as a
      // tower standing at the edge. Upward it is simply allowed: the strip above
      // the board is HUD background, the spire is at depth 5, and every HUD
      // element is drawn over it.
      const boardBottom = ARENA_Y + config.arenaHeight * ARENA_SCALE;
      top = p.y - my * z;

      this.body = scene.add
        .image(p.x, top, key)
        .setOrigin(0.5, 0).setScale(z).setDepth(5);

      baseY = p.y + (art.h - my) * z;
      if (baseY > boardBottom) {
        // Crop is in texture pixels, measured from the top of the frame.
        this.body.setCrop(0, 0, art.w, (boardBottom - top) / z);
        baseY = boardBottom;
      }
      this.ring.setPosition(p.x, baseY);
      this.mountY = p.y;

      // The creature on the mount.
      //
      // The art has a bare weapon plate in the middle -- the pack ships
      // ballistae to drop into it -- so a creature sits in a socket that was
      // designed for exactly this. It is drawn at the sprite's own scale
      // rather than the board's: it is sitting on a roof, not standing on the
      // ground, and matching the walking size makes it look like it is about
      // to fall off the front.
      const species = t.kind === "side"
        ? towerTroops.troopById(troopId).species
        : towerTroops.KING_SPECIES;
      if (scene.textures.exists(`pm-${species}`)) {
        const [sx, sy] = art.seat;
        // A PMD frame is not centred on its creature: the body sits high in the
        // cell, with `feetOffset` giving how far the feet fall below the cell's
        // middle. Centring the *frame* on the mount therefore hung the creature
        // above the plate -- between 6 and 12 source pixels depending on the
        // species, and a player saw it as sitting off-centre and behind. Drop
        // the sprite by the difference so the body lands in the seat.
        const seat = sprites.SHEETS[species];
        const sink = seat
          ? (seat.bodyHeight / 2 - seat.feetOffset) * SPRITE_SCALE * 0.85
          : 0;
        // Drawn at the board's creature scale, not the tower art's.
        //
        // Scaling it by the tower (z * 0.8) made a Crobat 30 pixels wide on a
        // 76 pixel tower -- small enough that the first person to see it asked
        // whether it was a Zubat. It is the same creature the player deploys,
        // so it has to be the size they recognise; 0.85 of board scale reads as
        // "up there" without shrinking it into an ornament.
        this.rider = scene.add
          // Placed off the seat, not the mount. `mountY` is the row the art
          // hangs from, which is the bottom rim of the plate rather than its
          // middle, so seating there sank every creature onto the ledge below.
          .sprite(p.x + (sx - art.w / 2) * z,
                  this.mountY + (sy - my) * z + sink, `pm-${species}`)
          .setScale(SPRITE_SCALE * 0.85).setDepth(6);
        // Yours look up the board, theirs look down: a tower creature faces
        // the half it is defending against.
        this.riderSpecies = species;
        // Canonical facing, turned once for this seat's view.
        this.riderFacing = viewFacing(t.side === config.PLAYER ? 4 : 0);
        const idle = sprites.resolve(species, "Idle", this.riderFacing);
        if (idle) this.rider.play(idle, true);
      }
    } else {
      this.body = scene.add.rectangle(p.x, p.y, w, w, C.panelLit).setDepth(5);
      this.body.setStrokeStyle(3, colour);
      top = p.y - w / 2;
    }

    // A team pip beside the roofline. The banner on the art already says whose
    // this is; this keeps the older read working at a glance from across the
    // board, where 8 banner pixels do not carry.
    this.banner = scene.add
      .rectangle(p.x + w * 0.42, top + 10, w * 0.16, w * 0.16, colour)
      .setOrigin(0, 0.5).setDepth(7);

    if (t.kind === "king") {
      this.crown = scene.add
        .text(p.x, top - 14, "♔", style(22, C.gold, "bold"))
        .setOrigin(0.5).setDepth(6);
    }

    // Health sits just off the roofline. Any higher and it detaches from the
    // tower it belongs to, which is exactly what a floating bar must not do.
    const bw = w + 4;
    this.barBg = scene.add.rectangle(p.x, top - 8, bw, 5, 0x000000, 0.6).setDepth(6);
    this.bar = scene.add
      .rectangle(p.x - bw / 2, top - 8, bw, 5, colour).setOrigin(0, 0.5).setDepth(7);
  }

  /** The rider's firing animation. */
  fire() {
    if (!this.rider || !this.riderSpecies) return;
    const shoot = sprites.resolve(this.riderSpecies, "Shoot", this.riderFacing);
    const idle = sprites.resolve(this.riderSpecies, "Idle", this.riderFacing);
    if (!shoot || shoot === idle) return;
    this.rider.play(shoot, true);
    this.rider.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => {
      if (idle) this.rider?.play(idle, true);
    });
  }

  sync(t: Tower) {
    const ratio = Math.max(0, t.hp / t.maxHP);
    this.bar.setScale(ratio, 1);
    // A sleeping king is drawn muted, because "can that shoot me yet" is the
    // question the whole middle of the board hangs on.
    if (!t.active && !t.dead) {
      this.body.setAlpha(0.62);
      this.crown?.setAlpha(0.35);
      this.ring.setAlpha(0.12);
    }
    // A reloading tower's creature dims, so the dry window -- the whole cost of
    // the volley archetype -- is something you can see rather than infer.
    if (this.rider) this.rider.setAlpha(t.dead ? 0.2 : t.reloading > 0 ? 0.45 : 1);
    if (this.body instanceof Phaser.GameObjects.Image) {
      const dim = 0.55 + 0.45 * ratio;
      const v = Math.round(255 * dim);
      const g = Math.round(255 * dim * (0.6 + 0.4 * ratio));
      this.body.setTint(Phaser.Display.Color.GetColor(v, g, g));
    }
    if (t.dead && !this.ruined) {
      this.ruined = true;
      // A ruin, not a darker tower.
      //
      // First it was drawn at quarter alpha, which reads as a transparent copy
      // hanging in the air. Then opaque and tinted, which is still tower-shaped
      // -- a player pointed at Clash Royale, where a broken tower is a pile of
      // stone on a sunken slab with no tower silhouette left at all. The
      // silhouette is the thing that has to change: from across the board you
      // read shape long before you read colour.
      //
      // So the building is cut down to its base and flattened, and rubble is
      // scattered over it. Everything that said "this tower works" -- banner,
      // crown, health, the creature manning it -- is gone.
      this.banner.setVisible(false);
      this.bar.setVisible(false);
      this.barBg.setVisible(false);
      this.crown?.setVisible(false);
      this.rider?.setVisible(false);
      this.ring.setAlpha(0.22);

      const w = config.towerSize[t.kind] * ARENA_SCALE;
      this.body.setVisible(false);

      // Drawn art, not shapes. It was a Phaser graphics call -- smooth
      // ellipses and flat rectangles in #3f3a35/#8b8680, a warm brown-grey
      // that appears nowhere in the tower's cool #68717a stone and carries
      // none of the #1f1833 outline every other piece of art here has. Next
      // to 24px hand-drawn tiles it read as a rock dropped on the ground
      // rather than as this building fallen down.
      //
      // Placed on the ring, not on `toScreen(t.x, t.y)`. A tower is anchored by
      // its MOUNT -- the seat the creature occupies -- which sits well up the
      // building, so the logical position is nowhere near the ground. Drawing
      // the wreck there left it hanging at seat height, above where the tower
      // had been standing. The ring is the tower's own ground shadow and has
      // always known where the base is.
      const ruin = this.scene.add.image(this.ring.x, this.ring.y, "tower-ruin")
        .setOrigin(0.5, 0.5).setDepth(4);
      ruin.setDisplaySize(w * 1.15, w * 1.15 * (ruin.height / ruin.width));
    }
  }

  wake() {
    this.body.setAlpha(1);
    this.crown?.setAlpha(1);
    this.ring.setAlpha(1);
    // Relative, not absolute. The art is drawn at whatever scale fits its
    // footprint -- 1.573 for a king -- so a literal 1.12 was not a 12% pulse,
    // it was a jump down to a third of the size and back.
    this.scene.tweens.add({
      targets: [this.body, this.banner], scaleX: "*=1.12", scaleY: "*=1.12",
      duration: 160, yoyo: true,
    });
  }

  flash() {
    if (this.body instanceof Phaser.GameObjects.Image) {
      const body = this.body;
      body.setTintFill(0xffffff);
      this.scene.time.delayedCall(60, () => body.clearTint());
    }
  }
}
