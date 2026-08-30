/**
 * The deck builder: six slots, a filterable roster, and Eevee's fork.
 *
 * Built as a web page rather than drawn on a canvas: a canvas has no scrollbox
 * and no layout, so every scroll mask, wheel handler and hand-computed chip
 * width has to be written by hand. The browser has both, and renders text at
 * native resolution rather than through the canvas rescale.
 *
 * The rules did not move: `core/deckEdit` still decides what a tap does and
 * what a reorder does, and `deckStore` still owns what survives a reload. This
 * file is the picture.
 *
 * One thing did not come across: the detail panel's animated attack preview.
 * It was a Phaser sprite playing the card's own attack pose with its ability
 * firing over it, and there is no DOM equivalent that is not a second sprite
 * engine. The panel shows the portrait and says what the ability does instead.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent, RefObject } from "react";
import * as cards from "../core/cards";
import type { Card } from "../core/cards";
import { config } from "../core/config";
import { ROLES, RARITY_RANK } from "../core/tiers";
import { TYPE_SHORT, TYPE_COLORS } from "../core/species";
import * as evolution from "../core/evolution";
import * as deckEdit from "../core/deckEdit";
import * as mega from "../core/mega";
import { rarityColor, hex } from "./theme";
import * as portraits from "./portraits";
import { Showcase } from "../guide/Showcase";
import { skillOf } from "./skillText";
import { loadDeck, saveDeck, loadBranch, saveBranch, starterDeck } from "./deckStore";
import { useSwipe } from "./useSwipe";

type Sort = "cost" | "name" | "rarity";
type Filter =
  | { kind: "all" }
  | { kind: "role"; value: string }
  | { kind: "type"; value: string }
  /** Cards that reach a Mega. Slot one wants one of them. */
  | { kind: "mega" };

/**
 * Travel that turns a press on a slot into a drag, in CSS pixels.
 *
 * Chosen for a thumb rather than a mouse, and inherited from the scene's
 * SCROLL_SLOP: below this a press is a choice, above it the player is moving
 * the card. Large enough that the wobble in holding a phone is not mistaken
 * for a drag, small enough that a deliberate one is never refused.
 */
const DRAG_SLOP = 8;

/** How long a shouted message stays up before the count comes back. */
const SAY_MS = 1800;

const sameFilter = (a: Filter, b: Filter) =>
  a.kind === b.kind && ("value" in a ? a.value : "") === ("value" in b ? b.value : "");

const rgbCss = (rgb?: number[]) =>
  rgb ? `rgb(${rgb.map((v) => Math.round(v * 255)).join(",")})` : "#999";

/** Every type present on the roster, so the bar never offers an empty filter. */
function rosterTypes(): string[] {
  const seen = new Set<string>();
  for (const c of cards.ALL) for (const t of c.types) seen.add(t);
  return [...seen].sort();
}

export interface DeckProps {
  back(): void;
  /** Start the match. Only reached with a full deck. */
  play(): void;
}

export function DeckScreen({ back, play }: DeckProps) {
  // Padded to a fixed length on the way in, so slot indices are stable from
  // the first render and an empty slot is a slot rather than a missing one.
  const [deck, setDeck] = useState<deckEdit.DeckSlots>(() => deckEdit.toSlots(loadDeck()));
  const [branch, setBranch] = useState<string | undefined>(loadBranch);
  const [filter, setFilter] = useState<Filter>({ kind: "all" });
  const [sort, setSort] = useState<Sort>("cost");
  /** The card the panel is describing, which is not the same as one in the deck. */
  const [inspect, setInspect] = useState<Card | undefined>(() => deckEdit.picked(deckEdit.toSlots(loadDeck()))[0]);
  /** Which slot was last tapped, so the second tap on it empties it. */
  const [armed, setArmed] = useState<number>();
  /** Something the screen is shouting, in place of the card count. */
  const [say, setSay] = useState<string>();

  const chosen = deckEdit.picked(deck);
  const full = chosen.length === config.deckSize;
  const avg = chosen.length
    ? chosen.reduce((a, c) => a + c.elixir, 0) / chosen.length
    : 0;

  // A shout puts itself away, so the header does not keep shouting at somebody
  // who has already read it and moved on.
  useEffect(() => {
    if (!say) return;
    const t = window.setTimeout(() => setSay(undefined), SAY_MS);
    return () => window.clearTimeout(t);
  }, [say]);

  /**
   * Every change to the deck is written straight through.
   *
   * The scene saved only on the way out, which meant a player who reloaded
   * mid-edit lost the edit and one who was closed by the OS lost all of it.
   * There is no cost to writing six ids.
   */
  const commit = (next: deckEdit.DeckSlots) => {
    setDeck(next);
    saveDeck(deckEdit.picked(next));
  };

  const visible = useMemo(() => {
    const list = cards.ALL.filter((c) => {
      if (filter.kind === "role") return c.role === filter.value;
      if (filter.kind === "type") return c.types.includes(filter.value);
      if (filter.kind === "mega") return mega.canEverMega(c);
      return true;
    });
    return [...list].sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "rarity") {
        const ra = RARITY_RANK[a.rarity] ?? 1, rb = RARITY_RANK[b.rarity] ?? 1;
        if (ra !== rb) return rb - ra;
        return a.elixir - b.elixir;
      }
      if (a.elixir !== b.elixir) return a.elixir - b.elixir;
      return a.name.localeCompare(b.name);
    });
  }, [filter, sort]);

  const grid = useRef<HTMLDivElement>(null);

  // A new list is a new list: the scroll position from the old one means
  // nothing against it.
  useEffect(() => {
    if (grid.current) grid.current.scrollTop = 0;
  }, [filter, sort]);

  const reorder = useSlotDrag(deck, (from, to) => commit(deckEdit.moveSlot(deck, from, to)));

  const tapCard = (card: Card) => {
    setInspect(card);
    const result = deckEdit.tapCard(deck, card);
    if (result.did === "full") {
      // A full deck used to swallow the tap in silence, which is
      // indistinguishable from the card being unselectable. Say so, and point
      // at the slots that are in the way.
      setSay("deck is full — tap a card above to remove one");
      return;
    }
    setArmed(undefined);
    commit(result.deck);
  };

  const tapSlot = (i: number) => {
    const held = deck[i];
    if (!held) return;
    // The first tap looks, the second removes. Removing takes the deck below
    // six on purpose: you cannot swap a card without a free slot.
    if (armed !== i) {
      setArmed(i);
      setInspect(held);
      return;
    }
    setArmed(undefined);
    // Emptied in place rather than spliced out. Splicing compacted the row, so
    // clearing slots left to right deleted every other card.
    commit(deckEdit.clearSlot(deck, i));
  };

  const leave = () => { saveDeck(chosen); back(); };
  const start = () => {
    if (!full) {
      // Only a full deck starts a match: a short one quietly changes the cycle
      // length, and therefore how fast anything evolves. Said rather than
      // refused -- a dead button is indistinguishable from a broken one.
      const short = config.deckSize - chosen.length;
      setSay(`pick ${short} more card${short === 1 ? "" : "s"} to play`);
      return;
    }
    saveDeck(chosen);
    play();
  };

  const swipe = useSwipe(undefined, leave);
  const branches = evolution.branchesFor("eevee");

  return (
    <div className="lr-screen lr-deckscreen" {...swipe}>
      <header>
        <h1>DECK</h1>
        <span className={say ? "lr-sub lr-shout" : "lr-sub"}>
          {say ?? `${chosen.length} / ${config.deckSize} cards`}
        </span>
        <span className="lr-spacer" />
        <span className="lr-deckavg">{avg.toFixed(1)} avg</span>
        <button className="lr-link" onClick={leave}>‹ back</button>
      </header>

      {/*
        The six slots, pinned above the roster.

        They do not scroll with the grid: the whole job of this screen is
        comparing what you are looking at against what you already have, and a
        deck you have to scroll back up to see cannot be compared to anything.
      */}
      <div className={say ? "lr-deckslots lr-shake" : "lr-deckslots"} ref={reorder.strip}>
        {Array.from({ length: config.deckSize }, (_, i) => {
          const card = deck[i];
          const isMega = i === 0;
          const lit = isMega && mega.canEverMega(card);
          return (
            <button
              key={i}
              className={[
                "lr-slot",
                "lr-deckslot",
                isMega ? (lit ? "lr-mega" : "lr-mega-off") : "",
                armed === i ? "lr-slot-armed" : "",
                reorder.dragging === i ? "lr-slot-lifted" : "",
              ].filter(Boolean).join(" ")}
              style={reorder.styleFor(i)}
              aria-label={card ? `slot ${i + 1}: ${card.name}` : `slot ${i + 1}: empty`}
              onPointerDown={(e) => reorder.down(e, i)}
              onPointerMove={reorder.move}
              onPointerUp={(e) => reorder.up(e, () => tapSlot(i))}
              onPointerCancel={reorder.cancel}
            >
              {card ? (
                <>
                  <span className="lr-cost-pip">{card.elixir}</span>
                  <span className="lr-face" style={portraits.styleFor(card.sheet, 44)} />
                  <b className="lr-slot-title">{card.name}</b>
                  <span className="lr-slot-name">{card.role}</span>
                </>
              ) : (
                <>
                  <span className="lr-face lr-face-empty" />
                  <b className="lr-slot-title">empty</b>
                  <span className="lr-slot-name" />
                </>
              )}
              {/* The same stone the battle button uses, so the slot's purpose
                  is obvious without a rule needing to be read anywhere. */}
              {isMega && <i className={lit ? "lr-stone" : "lr-stone lr-stone-off"} />}
            </button>
          );
        })}
      </div>

      <div className="lr-deckbody" ref={grid}>
        <div className="lr-filters">
          <Chips
            label="ROLE"
            items={ROLES.filter((r) => cards.ALL.some((c) => c.role === r))
              .map((r) => ({ key: r, label: r, filter: { kind: "role", value: r } as Filter }))}
            active={filter}
            pick={setFilter}
          />
          <Chips
            label="TYPE"
            items={rosterTypes().map((t) => ({
              key: t,
              label: TYPE_SHORT[t] ?? t,
              filter: { kind: "type", value: t } as Filter,
              tint: rgbCss(TYPE_COLORS[t]),
            }))}
            active={filter}
            pick={setFilter}
          />
          <Chips
            label="MEGA"
            items={[{ key: "mega", label: "can Mega", filter: { kind: "mega" } as Filter }]}
            active={filter}
            pick={setFilter}
          />

          {/* Committing Eevee's branch before the match, or leaving it open. */}
          {branches && (
            <div className="lr-chiprow">
              <span className="lr-chiplabel">EEVEE EVOLVES INTO</span>
              <div className="lr-chips">
                {[undefined, ...branches].map((id) => (
                  <button
                    key={id ?? "later"}
                    className="lr-chip"
                    aria-pressed={id === branch}
                    onClick={() => { setBranch(id); saveBranch(id); }}
                  >
                    {id ? id.charAt(0).toUpperCase() + id.slice(1) : "decide later"}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="lr-chiprow lr-sortrow">
            <span className="lr-chiplabel">{visible.length} cards</span>
            {/* Cycled rather than a menu: three options do not deserve one. */}
            <button
              className="lr-chip"
              onClick={() =>
                setSort(sort === "cost" ? "name" : sort === "name" ? "rarity" : "cost")}
            >
              sort: {sort}
            </button>
          </div>
        </div>

        <div className="lr-cardgrid">
          {visible.map((card) => {
            const inDeck = deck.includes(card);
            return (
              <button
                key={card.id}
                className={inDeck ? "lr-tile lr-tile-in" : "lr-tile"}
                aria-pressed={inDeck}
                aria-current={inspect === card ? "true" : undefined}
                style={{ "--rarity": hex(rarityColor(card.rarity)) } as CSSProperties}
                onClick={() => tapCard(card)}
              >
                <span className="lr-cost-pip">{card.elixir}</span>
                <span className="lr-face" style={portraits.styleFor(card.sheet, 44)} />
                <b className="lr-slot-title">{card.name}</b>
                <span className="lr-slot-name">{card.role}</span>
                {inDeck && <em className="lr-tick">✓</em>}
              </button>
            );
          })}
        </div>
      </div>

      <div className="lr-detail">
        {inspect
          ? <Detail card={inspect} inDeck={deck.includes(inspect)} full={full} />
          : <div className="lr-sub">Pick a card to see what it does.</div>}
      </div>

      <footer className="lr-deckbar">
        <button className="lr-btn" onClick={leave}>Back</button>
        <button
          className="lr-btn"
          onClick={() => { setArmed(undefined); commit(deckEdit.toSlots(starterDeck())); }}
        >
          Reset
        </button>
        <button className="lr-btn lr-btn-go" onClick={start}>Play</button>
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------- filters

interface ChipItem {
  key: string;
  label: string;
  filter: Filter;
  tint?: string;
}

function Chips(
  { label, items, active, pick }:
  { label: string; items: ChipItem[]; active: Filter; pick(f: Filter): void },
) {
  return (
    <div className="lr-chiprow">
      <span className="lr-chiplabel">{label}</span>
      <div className="lr-chips">
        {items.map((it) => {
          const on = sameFilter(active, it.filter);
          return (
            <button
              key={it.key}
              className={it.filter.kind === "mega" ? "lr-chip lr-chip-mega" : "lr-chip"}
              aria-pressed={on}
              // Tapping the active chip clears it, so there is always a way
              // back to the whole roster without hunting for an "All" button.
              onClick={() => pick(on ? { kind: "all" } : it.filter)}
              style={it.tint ? { "--tint": it.tint } as CSSProperties : undefined}
            >
              {it.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------- detail

function Detail({ card, inDeck, full }: { card: Card; inDeck: boolean; full: boolean }) {
  const sk = skillOf(card);
  const how =
    card.delivery === "tunnel" ? "Tunnels — surfaces anywhere on the board."
    : card.delivery === "throw" ? "Thrown — lands anywhere on the board."
    : card.delivery === "drop" ? "Dropped — falls into your own half, and hurts what it lands on."
    : !card.targets.includes("troop") ? "Walks past troops and goes for towers."
    : card.flying ? "Flies — crosses the river anywhere."
    : "";

  return (
    <div className="lr-detailrow">
      {/*
        The attack preview the Phaser scene had, restored.
 
        It was the one thing lost in the port, and it turned out not to need
        Phaser at all -- the guide has been drawing the same thing on a plain
        canvas the whole time, and says so in its own comments. Borrowing that
        component costs nothing here: `main.ts` already fetches the frame
        tables at boot, so the data this needs is in the browser before the
        deck screen exists.
      */}
      <Showcase card={card} />
      <div className="lr-detailtext">
        <h2>{card.name}</h2>
        <div className="lr-sub">
          {card.role} · {card.elixir} elixir · {card.hp} hp · {card.damage} dmg
          {card.count > 1 ? ` · x${card.count}` : ""}
        </div>
        <div className="lr-skill">
          <b>{sk.name}</b> — {sk.summary}
          <br />
          <small>
            Casts every {sk.every} attacks, about {sk.seconds.toFixed(1)}s.
            Lands in {sk.deployDelay.toFixed(2)}s.
          </small>
        </div>
        {how && <p className="lr-how">{how}</p>}
      </div>
      {/* What a tap on this card in the grid will do. Without it the rule is
          invisible, and an invisible rule reads as the tap having failed. */}
      <span className={inDeck || !full ? "lr-hintok" : "lr-hintno"}>
        {inDeck ? "tap to remove" : full ? "deck is full" : "tap to add"}
      </span>
    </div>
  );
}

// -------------------------------------------------------------- reordering

interface SlotDrag {
  strip: RefObject<HTMLDivElement | null>;
  /** The slot currently under the finger, or undefined when nothing is moving. */
  dragging?: number;
  styleFor(i: number): CSSProperties | undefined;
  down(e: ReactPointerEvent, i: number): void;
  move(e: ReactPointerEvent): void;
  up(e: ReactPointerEvent, tap: () => void): void;
  cancel(): void;
}

/**
 * Drag a slot along the row to reorder it.
 *
 * Pointer events with capture rather than HTML5 drag-and-drop, for one reason
 * that decides it: `dragstart` never fires from a touchscreen. This game is
 * played on phones, and a reorder that only works with a mouse is not a
 * reorder. Capture also means the gesture survives the finger leaving the
 * button it started on, which is the normal case here -- you are dragging the
 * card somewhere else by definition.
 *
 * `touch-action: none` on the slots is the other half, in `ui.css`: without it
 * the browser claims the gesture as a scroll before the second pointermove
 * arrives.
 *
 * The row is measured live rather than assumed, because the slots are a
 * flexible grid and their width depends on the viewport.
 */
function useSlotDrag(
  deck: deckEdit.DeckSlots,
  commit: (from: number, to: number) => void,
): SlotDrag {
  const strip = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ from: number; dx: number; to: number }>();
  /** Where the press landed, and whether it has travelled far enough to count. */
  const press = useRef<{ i: number; x: number; moved: boolean }>(undefined);

  /** Which slot the given page x sits over, by centre distance. */
  const slotUnder = (x: number): number => {
    const row = strip.current;
    if (!row) return -1;
    const boxes = Array.from(row.children) as HTMLElement[];
    let best = -1, near = Infinity;
    for (let i = 0; i < boxes.length; i++) {
      const r = boxes[i].getBoundingClientRect();
      const d = Math.abs((r.left + r.right) / 2 - x);
      if (d < near) { near = d; best = i; }
    }
    return best;
  };

  const finish = () => { press.current = undefined; setDrag(undefined); };

  return {
    strip,
    dragging: drag?.from,

    /**
     * Slid aside so the gap shows where the card would land -- the same
     * preview the scene drew by moving containers, expressed as a transform
     * so the browser does the animating.
     */
    styleFor(i) {
      if (!drag) return undefined;
      if (i === drag.from) return { transform: `translateX(${drag.dx}px)`, zIndex: 5 };
      const row = strip.current;
      if (!row || drag.to === drag.from) return undefined;
      // Everything between the card's old and new home shifts one place.
      const shifts = (drag.to > drag.from && i > drag.from && i <= drag.to) ? -1
        : (drag.to < drag.from && i >= drag.to && i < drag.from) ? 1
        : 0;
      if (!shifts) return undefined;
      const boxes = Array.from(row.children) as HTMLElement[];
      const step = boxes.length > 1
        ? boxes[1].getBoundingClientRect().left - boxes[0].getBoundingClientRect().left
        : 0;
      return { transform: `translateX(${shifts * step}px)` };
    },

    down(e, i) {
      // The slots sit inside a screen that reads horizontal swipes as
      // navigation. A press that is about to become a drag is not one.
      e.stopPropagation();
      if (!deck[i]) return;
      press.current = { i, x: e.clientX, moved: false };
      // Capture is an optimisation, not the mechanism: a pointer that has
      // already been released refuses it, and a throw here would take the
      // press down with it.
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // The gesture still works, it just stops tracking off the button.
      }
    },

    move(e) {
      const p = press.current;
      if (!p) return;
      const dx = e.clientX - p.x;
      if (!p.moved && Math.abs(dx) < DRAG_SLOP) return;
      p.moved = true;
      setDrag({ from: p.i, dx, to: slotUnder(e.clientX) });
    },

    up(e, tap) {
      e.stopPropagation();
      const p = press.current;
      const moved = p?.moved;
      const from = p?.i ?? -1;
      const to = drag?.to ?? -1;
      finish();
      // A drag ends with a pointerup too; only a press that stayed put is a tap.
      if (!moved) { tap(); return; }
      if (to >= 0 && to !== from) commit(from, to);
    },

    cancel: finish,
  };
}
