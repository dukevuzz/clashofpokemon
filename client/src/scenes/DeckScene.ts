/** The pre-match screen: one deck, a filterable collection, and Eevee's fork. */

import Phaser from "phaser";
import * as cards from "../core/cards";
import type { Card } from "../core/cards";
import { config } from "../core/config";
import { ROLES, RARITY_RANK } from "../core/tiers";
import { TYPE_SHORT, TYPE_COLORS } from "../core/species";
import * as evolution from "../core/evolution";
import { C, style, rarityColor, hex } from "../ui/theme";
import { DESIGN_W, DESIGN_H } from "../ui/layout";
import { button, panel, hitTopLeft } from "../ui/widgets";
import { skillOf, playPreview } from "../ui/skillCard";
import { loadDeck, saveDeck, loadBranch, saveBranch, starterDeck } from "../ui/deckStore";
import * as sprites from "../ui/sprites";
import * as portraits from "../ui/portraits";
import * as deckEdit from "../core/deckEdit";
import * as mega from "../core/mega";

/**
 * Travel that turns a tap into a scroll, in design pixels.
 *
 * Chosen for a thumb rather than a mouse: below this a press is a choice,
 * above it the player was moving the list. Small enough that a deliberate tap
 * is never refused, large enough that the wobble in holding a phone is not
 * mistaken for a drag.
 */
const SCROLL_SLOP = 10;

type Sort = "cost" | "name" | "rarity";
type Filter =
  | { kind: "all" }
  | { kind: "role"; value: string }
  | { kind: "type"; value: string }
  /** Cards that reach a Mega. 38 of 151, and slot one wants one of them. */
  | { kind: "mega" };

const TILE_W = 92;
const TILE_H = 108;
const COLS = 6;
const LIST_TOP = 468;
/** Room at the bottom for the inspect panel, above the buttons. */
const DETAIL_H = 108;
const LIST_BOTTOM = DESIGN_H - 104 - DETAIL_H;

const asColour = (rgb?: number[]): number =>
  rgb ? Phaser.Display.Color.GetColor(rgb[0] * 255, rgb[1] * 255, rgb[2] * 255) : 0x999999;

export class DeckScene extends Phaser.Scene {
  /** Six slots, some possibly empty -- not a list that closes up. */
  private deck: deckEdit.DeckSlots = [];

  private picked(): Card[] {
    return deckEdit.picked(this.deck);
  }
  private filter: Filter = { kind: "all" };
  private sort: Sort = "cost";
  private branch?: string;

  private slots: Phaser.GameObjects.Container[] = [];
  /** Slot being dragged, where it started on screen, and where it is now. */
  private dragSlot?: { index: number; home: { x: number; y: number } };
  private slotHome: { x: number; y: number }[] = [];
  /** The glow around slot one, which is the Mega slot, and the stone on it. */
  private megaAura?: Phaser.GameObjects.Graphics;
  private megaStone?: Phaser.GameObjects.Image;
  private auraPulse = 0;
  /** The live tiles, so picking a card can repaint them instead of rebuilding. */
  private tiles: Array<{
    card: Card;
    box: Phaser.GameObjects.Rectangle;
    tick: Phaser.GameObjects.Text;
  }> = [];
  private list!: Phaser.GameObjects.Container;
  private countText!: Phaser.GameObjects.Text;
  private avgText!: Phaser.GameObjects.Text;
  private sortText!: Phaser.GameObjects.Text;
  /** What the last-touched card does, so a pick is informed rather than a guess. */
  private detail!: Phaser.GameObjects.Container;
  /** Drives the preview's strike-and-settle cycle; replaced on every change. */
  private detailLoop?: Phaser.Time.TimerEvent;
  /** The sheet currently being fetched for the detail panel, if any. */
  private loadingArt?: string;
  /** The card being looked at, which is not the same as the card being picked. */
  private inspecting?: Card;
  private inspectingSlot?: number;
  private chips: Array<{
    box: Phaser.GameObjects.Rectangle;
    text: Phaser.GameObjects.Text;
    filter: Filter;
  }> = [];
  private branchChips: Array<{
    box: Phaser.GameObjects.Rectangle;
    text: Phaser.GameObjects.Text;
    id?: string;
  }> = [];

  constructor() {
    super("Deck");
  }

  /** The roster's sheets, for the animated preview panel. */
  preload() {
    // The same stone the battle button uses, so the deck screen and the match
    // are visibly talking about one thing.
    this.load.spritesheet("mega-stone", "tiles/mega-stone.png",
                          { frameWidth: 48, frameHeight: 48 });
    // Nothing. The grid is portraits, and Boot already has every one of them.
    //
    // This used to pull a full animation sheet for all of `cards.ALL`, which
    // worked at 49 cards and stopped working at 57: Phaser issues one batch of
    // `maxParallelDownloads` and then stops pumping a load it did not start
    // itself, so it completed exactly 32 of 57, left 25 files sitting in the
    // list with nothing in flight, reported no error, and the screen never
    // opened. Measured -- 32 is the cap, not a coincidence. It is the same
    // failure BootScene documents, and the same fix: do not load what this
    // screen does not draw.
    //
    // Only the detail panel animates, and only one card at a time, so its sheet
    // is fetched when it is actually asked for. `playPreview` already returns
    // undefined when a texture is missing, so the panel is correct either way
    // and simply gains the animation a moment later.
  }

  /** Fetch one creature's sheet, for the detail panel. */
  private ensureArt(card: Card) {
    const key = `pm-${card.sheet}`;
    if (this.textures.exists(key) || this.loadingArt === card.sheet) return;
    if (!sprites.hasSheet(card.sheet)) return;

    this.loadingArt = card.sheet;
    sprites.preload(this.load, [card.sheet]);
    this.load.once(Phaser.Loader.Events.COMPLETE, () => {
      this.loadingArt = undefined;
      // Redraw only if it is still the card being looked at -- taps are faster
      // than a download, and the panel must not snap back to a stale creature.
      if (this.inspecting === card || this.deck[this.inspectingSlot ?? -1] === card) {
        this.showDetail(card);
      }
    });
    this.load.start();
  }

  create() {
    // Padded to a fixed length so slot indices are stable from the first frame.
    const saved = loadDeck();
    this.deck = deckEdit.toSlots(saved);
    this.branch = loadBranch();
    this.slots = [];
    this.tiles = [];
    this.chips = [];
    this.branchChips = [];
    this.filter = { kind: "all" };
    this.sort = "cost";

    this.cameras.main.setBackgroundColor(C.bg);
    this.add.text(DESIGN_W / 2, 34, "DECK", style(26, C.text, "bold")).setOrigin(0.5);
    this.countText = this.add.text(DESIGN_W / 2, 62, "", style(13, C.dim)).setOrigin(0.5);
    this.avgText = this.add.text(DESIGN_W - 26, 34, "", style(13, C.elixir, "bold")).setOrigin(1, 0);

    this.buildSlots();
    this.buildFilters();
    this.buildBranchPicker();

    this.list = this.add.container(0, 0);
    // A geometry mask rather than a scissor rectangle: Phaser applies the
    // camera transform to it, which is the exact thing love.graphics.setScissor
    // did not do and which turned every scrolling list in the LÖVE version into
    // a black rectangle until it was special-cased.
    const shape = this.make.graphics({}, false);
    shape.fillRect(0, LIST_TOP, DESIGN_W, LIST_BOTTOM - LIST_TOP);
    this.list.setMask(shape.createGeometryMask());

    this.input.on("wheel", (_p: unknown, _o: unknown, _dx: number, dy: number) => this.scroll(dy));

    /*
     * Dragging the list is how you scroll it on a phone, and there is nowhere
     * to drag that is not a card.
     *
     * A mouse has a wheel, so on a desktop a press on a card is always a tap.
     * A finger has only the list itself, so every scroll begins by touching
     * something -- and the tile's own pointerup then added that card to the
     * deck. Reported as "touch any pokemon before drag will try to add it".
     *
     * So the distance travelled since the press is remembered here, and a tile
     * refuses a release that arrived after a scroll.
     */
    this.input.on("pointerdown", () => { this.dragged = 0; });
    this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
      if (p.isDown && p.y > LIST_TOP && p.y < LIST_BOTTOM) {
        const dy = p.y - p.prevPosition.y;
        this.dragged += Math.abs(dy);
        this.scroll(-dy);
      }
    });

    button(this, 96, DESIGN_H - 48, 148, 54, "Back", 18, C.panelLit, () => {
      this.detailLoop?.remove();
      this.detailLoop = undefined;
      saveDeck(this.picked());
      this.scene.start("Menu");
    });
    button(this, DESIGN_W / 2, DESIGN_H - 48, 148, 54, "Reset", 18, C.panel, () => {
      const fresh = starterDeck();
      this.deck = deckEdit.toSlots(fresh);
      this.refresh();
    });
    button(this, DESIGN_W - 96, DESIGN_H - 48, 148, 54, "Play", 18, C.elixir, () => {
      // Only a full deck starts a match: a short one quietly changes the cycle
      // length, and therefore how fast anything evolves.
      //
      // Saying so rather than returning. A dead button is indistinguishable
      // from a broken one, and this is the same silence that made the deck
      // loader's refill look like the fix instead of the bug.
      if (this.picked().length !== config.deckSize) {
        this.sayDeckIsShort();
        return;
      }
      this.detailLoop?.remove();
      this.detailLoop = undefined;
      saveDeck(this.picked());
      this.scene.start("Battle");
    });

    this.buildDetail();
    // Start on a card you already own, so the panel is never a blank box.
    const first = this.picked()[0];
    if (first) this.showDetail(first);
    this.rebuild();
    this.refresh();
  }

  /** What this card actually does, shown where you are choosing it. */
  private buildDetail() {
    const top = LIST_BOTTOM + 8;
    panel(this, 40, top, DESIGN_W - 80, DETAIL_H - 12, C.panelDim);
    this.detail = this.add.container(0, 0);
  }

  private showDetail(card: Card) {
    // Stopped before the sprites it drives are destroyed, not after.
    this.detailLoop?.remove();
    this.detailLoop = undefined;
    this.detail.removeAll(true);
    const top = LIST_BOTTOM + 18;
    const sk = skillOf(card);

    // The card doing the thing, not a paragraph about it.
    //
    // The creature plays its own attack pose and the ability's effect fires
    // over it on a loop, which is the same art the match uses -- so what you
    // watch here is literally what you will see on the board. Twenty of the
    // three hundred declared abilities ship an effect; the rest show the pose
    // alone rather than borrowing someone else's explosion.
    const stageX = DESIGN_W - 108;
    const stageY = top + 34;
    this.detail.add(this.add.circle(stageX, stageY, 34, C.panel).setStrokeStyle(2, C.edge));

    this.ensureArt(card);
    this.detailLoop = playPreview(this, this.detail, card, stageX, stageY, 46);

    const how =
      card.delivery === "tunnel" ? "Tunnels -- surfaces anywhere on the board."
      : card.delivery === "throw" ? "Thrown -- lands anywhere on the board."
      : card.delivery === "drop" ? "Dropped -- falls into your own half, and hurts what it lands on."
      : !card.targets.includes("troop") ? "Walks past troops and goes for towers."
      : card.flying ? "Flies -- crosses the river anywhere."
      : "";

    this.detail.add([
      this.add.text(60, top, `${card.name}`, style(15, C.text, "bold")),
      this.add.text(60 + 8 + card.name.length * 9, top + 3,
        `${card.role} · ${card.elixir} elixir · ${card.hp} hp · ${card.damage} dmg` +
        `${card.count > 1 ? ` · x${card.count}` : ""}`, style(11, C.dim)),
      this.add.text(60, top + 22, `${sk.name}: ${sk.summary}`, {
        ...style(11, C.dim), wordWrap: { width: DESIGN_W - 230 },
      }),
      this.add.text(60, top + 56,
        `Casts every ${sk.every} attacks, about ${sk.seconds.toFixed(1)}s.` +
        `  Lands in ${sk.deployDelay.toFixed(2)}s.`, style(11, C.dim)),
    ]);
    if (how) {
      this.detail.add(this.add.text(60, top + 70, how, style(11, C.gold)));
    }

    // What a second tap does. Without this the two-tap rule is invisible, and
    // an invisible rule reads as the first tap having failed.
    const inDeck = this.deck.includes(card);
    const full = this.picked().length >= config.deckSize;
    const hint = inDeck ? "tap again to remove"
      : full ? "deck is full -- remove one first"
      : "tap again to add";
    this.detail.add(
      this.add.text(DESIGN_W - 150, top + 56, hint,
                    style(11, inDeck || !full ? C.hp : C.enemy)).setOrigin(1, 0),
    );
  }

  /** Switch off input for tiles scrolled out of sight. */
  private clipInput() {
    for (const t of this.tiles) {
      const c = t.box.parentContainer;
      const y = c.y + this.list.y;
      const visible = y + TILE_H > LIST_TOP && y < LIST_BOTTOM;
      // `enabled`, not `disableInteractive()`. That method leaves `input` in
      // place and merely switches it off, so a `!c.input` test reads true for a
      // disabled object and the toggle never fires -- which is exactly how the
      // first version of this fix did nothing at all.
      if (c.input) c.input.enabled = visible;
      else if (visible) hitTopLeft(c, TILE_W, TILE_H);
    }
  }

  /**
   * How far the pointer has travelled since it went down.
   *
   * Compared against SCROLL_SLOP to tell a tap from a scroll. Distance rather
   * than a boolean, because a finger never holds perfectly still and one stray
   * pixel must not cost you the card you meant to pick.
   */
  private dragged = 0;

  private scroll(dy: number) {
    const rows = Math.ceil(this.visible().length / COLS);
    const limit = Math.max(0, rows * (TILE_H + 8) - (LIST_BOTTOM - LIST_TOP));
    this.list.y = Phaser.Math.Clamp(this.list.y - dy, -limit, 0);
    this.clipInput();
  }

  // ------------------------------------------------------------------ slots

  private buildSlots() {
    const w = 88, gap = 6;
    const total = config.deckSize * w + (config.deckSize - 1) * gap;
    const startX = (DESIGN_W - total) / 2;

    for (let i = 0; i < config.deckSize; i++) {
      const box = this.add.rectangle(w / 2, 54, w, 108, C.panel).setStrokeStyle(2, C.edge);
      const art = this.add.sprite(w / 2, 42, "__DEFAULT").setVisible(false);
      const name = this.add.text(w / 2, 82, "", style(10, C.text, "bold")).setOrigin(0.5);
      const role = this.add.text(w / 2, 95, "", style(9, C.dim)).setOrigin(0.5);
      const badge = this.add.circle(12, 12, 10, C.elixir);
      const cost = this.add.text(12, 12, "", style(12, C.text, "bold")).setOrigin(0.5);

      // Slot one is the Mega slot. It gets a glow rather than a caption: the
      // row is 88px wide and a label under it clipped into the filter bar,
      // and a border says "this slot is special" without competing with the
      // card's own name and role for the same space.
      const aura = i === 0 ? this.add.graphics() : undefined;
      if (aura) this.megaAura = aura;
      // A stone in the corner, not a caption. It is the same picture as the
      // button in a match, which is what makes the slot's purpose obvious
      // without a rule needing to be read anywhere.
      const stone = i === 0
        ? this.add.image(w - 13, 13, "mega-stone", 1).setScale(0.46).setDepth(2)
        : undefined;
      if (stone) this.megaStone = stone;

      // Appended, never prepended: refresh() reads these children by position,
      // so an extra object at the front makes `box` the wrong thing entirely.
      // The rings stroke outside the card, so drawing last costs nothing.
      const c = this.add.container(startX + i * (w + gap), 86,
                                   [box, art, name, role, badge, cost,
                                    ...(aura ? [aura] : []), ...(stone ? [stone] : [])]);
      this.slotHome.push({ x: startX + i * (w + gap), y: 86 });
      hitTopLeft(c, w, 108);
      this.input.setDraggable(c);

      c.on("dragstart", () => {
        this.dragSlot = { index: i, home: { ...this.slotHome[i] } };
        c.setDepth(50);
      });
      c.on("drag", (_p: Phaser.Input.Pointer, dx: number, dy: number) => {
        if (this.dragSlot?.index !== i) return;
        c.setPosition(dx, dy);
        this.previewDrop(dx);
      });
      c.on("dragend", () => {
        if (this.dragSlot?.index !== i) return;
        const to = this.slotUnder(c.x);
        c.setDepth(0);
        const from = this.dragSlot.index;
        this.dragSlot = undefined;
        if (to !== from && to >= 0) {
          this.deck = deckEdit.moveSlot(this.deck, from, to);
          saveDeck(this.picked());
        }
        this.layoutSlots();
        this.refresh();
      });

      c.on("pointerup", () => {
        // A drag ends with a pointerup too; only a tap should open the card.
        if (this.dragSlot) return;
        // Removing takes the deck below six on purpose -- you cannot swap a
        // card without a free slot, and refusing the removal makes that
        // impossible.
        //
        // The slot is emptied in place rather than spliced out. Splicing
        // compacted the row, so clearing slots left to right deleted every
        // other card: remove slot 1 and slot 2's card slides into it, so the
        // next tap on slot 2 hits what used to be slot 3. A player reported
        // clicking 1 through 6 and watching the wrong cards disappear, which is
        // exactly that. A slot you emptied stays empty until you fill it.
        const held = this.deck[i];
        if (!held) return;
        if (this.inspectingSlot !== i) {
          this.inspectingSlot = i;
          this.inspecting = undefined;
          this.showDetail(held);
          this.refresh();
          return;
        }
        this.inspectingSlot = undefined;
        this.deck = deckEdit.clearSlot(this.deck, i);
        this.refresh();
      });
      this.slots.push(c);
    }
  }

  /**
   * The Mega slot's glow.
   *
   * Bright and breathing when the card in it can actually Mega, a flat dim
   * outline when it cannot -- the slot stays marked either way, because the
   * slot is special whatever is sitting in it, and a player who drops a
   * Pikachu there needs to see that the glow went out rather than that the
   * marking vanished.
   */
  private drawAura(w = 88, h = 108) {
    const g = this.megaAura;
    if (!g) return;
    const can = mega.canEverMega(this.deck[0]);
    g.clear();

    if (can) {
      // A filled halo as well as rings: outline alone was quiet enough to be
      // mistaken for the card's own rarity border, which is exactly what
      // happened the first time somebody looked at it.
      const beat = 0.5 + Math.sin(this.auraPulse) * 0.5;
      g.fillStyle(C.gold, 0.10 + beat * 0.06);
      g.fillRoundedRect(-10, -10, w + 20, h + 20, 12);
      for (let i = 3; i >= 1; i--) {
        const spread = i * 3 + beat * 2;
        g.lineStyle(2, C.gold, 0.5 / i);
        g.strokeRoundedRect(-spread, -spread, w + spread * 2, h + spread * 2, 4 + spread);
      }
      g.lineStyle(2, C.gold, 0.95);
      g.strokeRoundedRect(-1, -1, w + 2, h + 2, 4);
    } else {
      g.lineStyle(2, C.edge, 0.7);
      g.strokeRoundedRect(-4, -4, w + 8, h + 8, 6);
    }
    // Frame 1 is the lit stone, frame 0 the drained one.
    this.megaStone?.setFrame(can ? 1 : 0).setAlpha(can ? 1 : 0.5);
  }

  override update() {
    if (!mega.canEverMega(this.deck[0])) return;
    this.auraPulse += 0.05;
    this.drawAura();
  }

  /** Which slot a dragged card is currently over. */
  private slotUnder(x: number): number {
    let best = -1, near = Infinity;
    for (let i = 0; i < this.slotHome.length; i++) {
      const d = Math.abs(this.slotHome[i].x - x);
      if (d < near) { near = d; best = i; }
    }
    return best;
  }

  /** Slide the other slots aside so the gap shows where the card would land. */
  private previewDrop(x: number) {
    if (!this.dragSlot) return;
    const from = this.dragSlot.index;
    const to = this.slotUnder(x);
    for (let i = 0; i < this.slots.length; i++) {
      if (i === from) continue;
      let home = this.slotHome[i];
      // Everything between the card's old and new home shifts one place.
      if (to > from && i > from && i <= to) home = this.slotHome[i - 1];
      else if (to < from && i >= to && i < from) home = this.slotHome[i + 1];
      this.slots[i].setPosition(home.x, home.y);
    }
  }

  /** Put every slot back where it belongs. */
  private layoutSlots() {
    for (let i = 0; i < this.slots.length; i++) {
      this.slots[i].setPosition(this.slotHome[i].x, this.slotHome[i].y);
    }
  }

  // ---------------------------------------------------------------- filters

  /** Every type present on the roster, so the bar never offers an empty filter. */
  private rosterTypes(): string[] {
    const seen = new Set<string>();
    for (const c of cards.ALL) for (const t of c.types) seen.add(t);
    return [...seen].sort();
  }

  private buildFilters() {
    const chip = (label: string, f: Filter, x: number, y: number, colour?: number) => {
      const w = 10 + label.length * 7.5;
      const box = this.add.rectangle(x + w / 2, y, w, 26, C.panel).setStrokeStyle(1, C.edge);
      const t = this.add.text(x + w / 2, y, label, style(11, C.dim)).setOrigin(0.5);
      box.setInteractive({ useHandCursor: true }).on("pointerup", () => {
        // Tapping the active chip clears it, so there is always a way back to
        // the whole roster without hunting for an "All" button.
        this.filter =
          JSON.stringify(this.filter) === JSON.stringify(f) ? { kind: "all" } : f;
        this.list.y = 0;
        this.rebuild();
        this.list.y = 0;
        this.refresh();
      });
      this.chips.push({ box, text: t, filter: f });
      void colour;
      return x + w + 5;
    };

    this.add.text(26, 208, "ROLE", style(10, C.dim, "bold"));
    let x = 26;
    for (const role of ROLES) {
      if (!cards.ALL.some((c) => c.role === role)) continue;
      x = chip(role, { kind: "role", value: role }, x, 232);
      if (x > DESIGN_W - 90) { x = 26; }
    }

    this.add.text(26, 258, "TYPE", style(10, C.dim, "bold"));
    x = 26;
    let row = 0;
    for (const t of this.rosterTypes()) {
      const label = TYPE_SHORT[t] ?? t;
      const w = 10 + label.length * 7.5;
      if (x + w > DESIGN_W - 26) { x = 26; row++; }
      const y = 282 + row * 30;
      const box = this.add
        .rectangle(x + w / 2, y, w, 26,
          Phaser.Display.Color.IntegerToColor(asColour(TYPE_COLORS[t])).darken(55).color)
        .setStrokeStyle(1, C.edge);
      const txt = this.add.text(x + w / 2, y, label, style(10, C.dim, "bold")).setOrigin(0.5);
      const f: Filter = { kind: "type", value: t };
      box.setInteractive({ useHandCursor: true }).on("pointerup", () => {
        this.filter = JSON.stringify(this.filter) === JSON.stringify(f) ? { kind: "all" } : f;
        this.list.y = 0;
        this.rebuild();
        this.list.y = 0;
        this.refresh();
      });
      this.chips.push({ box, text: txt, filter: f });
      x += w + 5;
    }

    // Its own labelled row, below the types. Hung off the end of the role bar
    // it read as a seventh role rather than a filter in its own right.
    this.add.text(26, 340, "MEGA", style(10, C.dim, "bold"));
    chip("can Mega", { kind: "mega" }, 26, 362);

    // Sort, cycled rather than a menu: three options do not deserve a dropdown.
    this.sortText = this.add
      .text(DESIGN_W - 26, LIST_TOP - 24, "", style(12, C.dim))
      .setOrigin(1, 0)
      .setInteractive({ useHandCursor: true });
    this.sortText.on("pointerup", () => {
      this.sort = this.sort === "cost" ? "name" : this.sort === "name" ? "rarity" : "cost";
      this.list.y = 0;
      this.rebuild();
      this.refresh();
    });
  }

  /** Commit an Eevee branch ahead of the match, or leave it to decide later. */
  private buildBranchPicker() {
    const forms = evolution.branchesFor("eevee");
    if (!forms) return;

    this.add.text(26, LIST_TOP - 74, "EEVEE EVOLVES INTO", style(10, C.dim, "bold"));
    let x = 26;
    for (const id of [undefined, ...forms] as Array<string | undefined>) {
      const label = id ? id.charAt(0).toUpperCase() + id.slice(1) : "decide later";
      const w = 10 + label.length * 6.5;
      if (x + w > DESIGN_W - 26) break;
      const box = this.add.rectangle(x + w / 2, LIST_TOP - 50, w, 24, C.panel)
        .setStrokeStyle(1, C.edge);
      const t = this.add.text(x + w / 2, LIST_TOP - 50, label, style(10, C.dim)).setOrigin(0.5);
      box.setInteractive({ useHandCursor: true }).on("pointerup", () => {
        this.branch = id;
        saveBranch(id);
        this.refreshBranch();
      });
      this.branchChips.push({ box, text: t, id });
      x += w + 5;
    }
  }

  private refreshBranch() {
    for (const c of this.branchChips) {
      const on = c.id === this.branch;
      c.box.setFillStyle(on ? C.gold : C.panel);
      c.text.setColor(on ? "#121218" : "#9a9caa");
    }
  }

  /** The filtered, sorted collection. */
  private visible(): Card[] {
    const f = this.filter;
    const list = cards.ALL.filter((c) => {
      if (f.kind === "role") return c.role === f.value;
      if (f.kind === "type") return c.types.includes(f.value);
      if (f.kind === "mega") return mega.canEverMega(c);
      return true;
    });

    return list.sort((a, b) => {
      if (this.sort === "name") return a.name.localeCompare(b.name);
      if (this.sort === "rarity") {
        const ra = RARITY_RANK[a.rarity] ?? 1, rb = RARITY_RANK[b.rarity] ?? 1;
        if (ra !== rb) return rb - ra;
        return a.elixir - b.elixir;
      }
      if (a.elixir !== b.elixir) return a.elixir - b.elixir;
      return a.name.localeCompare(b.name);
    });
  }

  /** Tell the player why nothing happened, and where to fix it. */
  /** The other direction: Play pressed with a gap still open. */
  private sayDeckIsShort() {
    const short = config.deckSize - this.picked().length;
    this.countText
      .setText(`pick ${short} more card${short === 1 ? "" : "s"} to play`)
      .setColor(hex(C.enemy));
    for (const slot of this.slots) {
      this.tweens.add({
        targets: slot, alpha: { from: 1, to: 0.45 },
        duration: 140, yoyo: true, repeat: 1,
      });
    }
    this.time.delayedCall(1800, () => this.refresh());
  }

  private sayDeckIsFull() {
    this.countText.setText("deck is full -- tap a card above to remove one")
      .setColor(hex(C.enemy));
    for (const slot of this.slots) {
      this.tweens.add({
        targets: slot, alpha: { from: 1, to: 0.45 },
        duration: 140, yoyo: true, repeat: 1,
      });
    }
    // Put the count back, so the screen does not keep shouting.
    this.time.delayedCall(1800, () => this.refresh());
  }

  // ---------------------------------------------------------------- refresh

  private refresh() {
    const chosen = this.picked();
    const full = chosen.length === config.deckSize;
    this.countText
      .setText(`${chosen.length} / ${config.deckSize} cards`)
      .setColor(full ? hex(C.dim) : hex(C.enemy));

    const avg = chosen.length
      ? chosen.reduce((a, c) => a + c.elixir, 0) / chosen.length
      : 0;
    this.avgText.setText(`${avg.toFixed(1)} avg`);
    this.sortText.setText(`sort: ${this.sort}`);

    for (let i = 0; i < this.slots.length; i++) {
      const card = this.deck[i];
      const [box, art, name, role, badge, cost] = this.slots[i].list as [
        Phaser.GameObjects.Rectangle, Phaser.GameObjects.Sprite,
        Phaser.GameObjects.Text, Phaser.GameObjects.Text,
        Phaser.GameObjects.Arc, Phaser.GameObjects.Text,
      ];
      if (card) {
        box.setStrokeStyle(2, rarityColor(card.rarity));
        // Portrait for the same reason the battle card uses one: this is a
        // grid of still images, and a held walk frame is the wrong picture.
        if (!portraits.apply(art, card.sheet, 60, 52)
            && this.textures.exists(`pm-${card.sheet}`)) {
          const sheet = sprites.SHEETS[card.sheet];
          art.setVisible(true).setTexture(`pm-${card.sheet}`, "Idle-0-0");
          art.setScale(Math.min(60 / (sheet.bodyWidth * 1.6), 52 / (sheet.bodyHeight * 1.6)));
          const idle = sprites.resolve(card.sheet, "Idle", 0);
          if (idle) art.play(idle, true);
        }
        name.setText(card.name);
        role.setText(card.role);
        cost.setText(String(card.elixir));
        badge.setVisible(true);
      } else {
        box.setStrokeStyle(2, C.edge);
        art.setVisible(false);
        name.setText("empty");
        role.setText("");
        cost.setText("");
        badge.setVisible(false);
      }
    }

    this.drawAura();

    for (const c of this.chips) {
      const on = JSON.stringify(c.filter) === JSON.stringify(this.filter);
      const isMega = c.filter.kind === "mega";
      c.text.setColor(on ? "#ffffff" : isMega ? hex(C.gold) : "#9a9caa");
      c.box.setStrokeStyle(on ? 2 : isMega ? 2 : 1, on || isMega ? C.gold : C.edge);
    }
    this.refreshBranch();
    this.repaint();
  }

  /** Update what the existing tiles look like. */
  private repaint() {
    for (const t of this.tiles) {
      const inDeck = this.deck.includes(t.card);
      const look = this.inspecting === t.card;
      t.box.setFillStyle(inDeck ? C.panelLit : C.panel);
      t.box.setStrokeStyle(look ? 3 : inDeck ? 2 : 1, look ? C.gold : rarityColor(t.card.rarity));
      t.tick.setVisible(inDeck);
    }
  }

  /** Recreate the tiles. Only the filter and the sort can change which exist. */
  private rebuild() {
    this.tiles = [];
    this.list.removeAll(true);
    const list = this.visible();
    const total = COLS * TILE_W + (COLS - 1) * 6;
    const startX = (DESIGN_W - total) / 2;

    for (let i = 0; i < list.length; i++) {
      const card = list[i];
      const x = startX + (i % COLS) * (TILE_W + 6);
      const y = LIST_TOP + 6 + Math.floor(i / COLS) * (TILE_H + 8);
      const inDeck = this.deck.includes(card);

      const box = this.add
        .rectangle(TILE_W / 2, TILE_H / 2, TILE_W, TILE_H, inDeck ? C.panelLit : C.panel)
        .setStrokeStyle(inDeck ? 2 : 1, rarityColor(card.rarity));
      const parts: Phaser.GameObjects.GameObject[] = [box];

      // Portrait first, animation sheet only if one happens to be in memory.
      //
      // The same order the slots above use, and now the only order that works:
      // this screen no longer preloads sheets, so keying the art solely on
      // `pm-<sheet>` drew a grid of nameplates with no creature on any of them.
      // Portraits are 145 species in one 249 KB atlas that Boot already holds,
      // and a grid of stills is what a portrait is for.
      const art = this.add.sprite(TILE_W / 2, TILE_H / 2 - 14, "__DEFAULT")
        .setVisible(false);
      if (!portraits.apply(art, card.sheet, 62, 54)
          && this.textures.exists(`pm-${card.sheet}`)) {
        const sheet = sprites.SHEETS[card.sheet];
        art.setVisible(true).setTexture(`pm-${card.sheet}`, "Idle-0-0");
        art.setScale(Math.min(62 / (sheet.bodyWidth * 1.6), 54 / (sheet.bodyHeight * 1.6)));
        const idle = sprites.resolve(card.sheet, "Idle", 0);
        if (idle) art.play(idle, true);
      }
      parts.push(art);
      parts.push(this.add.text(TILE_W / 2, TILE_H - 30, card.name, style(10, C.text, "bold"))
        .setOrigin(0.5));
      parts.push(this.add.text(TILE_W / 2, TILE_H - 18, card.role, style(9, C.dim))
        .setOrigin(0.5));
      parts.push(this.add.circle(12, 12, 10, C.elixir));
      parts.push(this.add.text(12, 12, String(card.elixir), style(12, C.text, "bold"))
        .setOrigin(0.5));
      parts.push(this.add.rectangle(TILE_W / 2, TILE_H - 4, TILE_W - 8, 3,
        rarityColor(card.rarity)));
      const tick = this.add
        .text(TILE_W - 12, 6, "✓", style(13, C.hp, "bold"))
        .setOrigin(0.5)
        .setVisible(inDeck);
      parts.push(tick);
      this.tiles.push({ card, box, tick });

      const c = this.add.container(x, y, parts);
      hitTopLeft(c, TILE_W, TILE_H);
      c.on("pointerup", () => {
        // A scroll is not a choice. See the pointermove handler above.
        if (this.dragged > SCROLL_SLOP) return;
        // Tapping a card in the deck removes it, so the collection is a toggle
        // and you never have to go back up to the slots to undo a mistake.
        const result = deckEdit.tapCard(this.deck, card);
        this.deck = result.deck;
        if (result.did === "full") {
          // A full deck used to swallow the tap in silence, which is
          // indistinguishable from the card being unselectable -- the same
          // player reported "I can't pick it" alongside the reflow bug. Say so,
          // and point at the slots that are in the way.
          this.sayDeckIsFull();
          return;
        }
        this.refresh();
      });
      this.list.add(c);
    }
    this.clipInput();
  }
}
