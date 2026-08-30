/**
 * Opening a pack.
 *
 * This follows pokemonAutoChess's mechanics on purpose -- a known-good
 * starting point rather than a guess. Theirs, from their `booster.tsx`:
 *
 *   * The pack does not animate. It is a static image beside a button.
 *   * Every card arrives face down at once.
 *   * Each is clicked to turn it, and clicking again turns it back.
 *   * ONE button does two jobs: it turns over everything still face down,
 *     and once all of them are up it opens the next pack. Nobody is made to
 *     click six cards before they can carry on.
 *   * Opening is throttled, so a held button cannot spend a stack.
 *
 * Parked, not discarded, is the hybrid the research pointed at: Three sources
 * agree on the shape and two of them disagree with what a first attempt would
 * do:
 *
 *   Reveal one at a time, not all at once. Legends of Runeterra flips every
 *   card together and the complaint is precise -- you do not know where to
 *   look.
 *
 *   But do NOT make the player click all six. Hearthstone does, and each
 *   common revealed is a small disappointment; its full sequence runs about
 *   twenty seconds and that is its most-complained-about property. So the
 *   first five turn themselves over as they land, and only the last one --
 *   the guaranteed good card -- waits to be turned.
 *
 *   Tease the rarity through the back before the flip. Hearthstone and
 *   pokemonAutoChess both glow the face-down card in its rarity colour. It is
 *   the one convention every implementation shares.
 *
 * The whole thing is budgeted at six or seven seconds and can be skipped.
 */

import { useEffect, useRef, useState } from "react";
import * as cards from "../core/cards";
import type { Card } from "../core/cards";
import { RARITY_ORDER } from "../core/tiers";
import * as packs from "../core/packs";
import type { Settlement } from "../core/packs";
import * as collection from "./collection";
import { useSwipe } from "./useSwipe";
import * as portraits from "./portraits";
import * as emotions from "./emotions";
import { hex, rarityColor } from "./theme";

export interface PacksProps {
  back(): void;
}

type Phase = "closed" | "opening" | "revealing";

/**
 * How long the chest takes to open, and when the burst lands.
 *
 * Four frames over 440ms, stepped in `ui.css`. The burst fires just before the
 * lid finishes rather than after it, so the light appears to come out of the
 * chest instead of arriving once it is already open.
 *
 * The cards are dealt on `DEAL_AT`, a beat after the lid settles -- long
 * enough to read as consequence, short enough that nobody waits.
 */
const OPEN_MS = 440;                 // must match lr-chest-open in ui.css
const BURST_AT = 260;
const DEAL_AT = OPEN_MS + 180;

/** How many sparks. Taste, not performance: they are spans on one keyframe. */
const SPARKS = 18;

/** PAC throttles opening. A stack of packs should not be spendable by holding. */
const THROTTLE_MS = 1200;


export function PacksScreen({ back }: PacksProps) {
  const [held, setHeld] = useState(collection.packsHeld());
  const [coins, setCoins] = useState(collection.coins());
  const [phase, setPhase] = useState<Phase>("closed");
  const [pulled, setPulled] = useState<Card[]>([]);
  const [settled, setSettled] = useState<Settlement>();
  const [flipped, setFlipped] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  /** Which creature's faces are open, if any. */
  const [detail, setDetail] = useState<Card>();
  const [, setTick] = useState(0);
  const timers = useRef<number[]>([]);
  const stage = useRef<HTMLDivElement>(null);

  const progress = collection.progress();
  const has = collection.owned();
  const toNext = collection.toNextPack();
  // Ordered by rarity then name, so the grid reads as a collection rather
  // than as the roster's internal order.
  const roster = [...cards.ALL].sort((a, b) =>
    (RARITY_ORDER.indexOf(a.rarity as never) - RARITY_ORDER.indexOf(b.rarity as never))
    || a.name.localeCompare(b.name));

  // Every timer this screen starts has to be cancellable, or a player who
  // leaves mid-reveal gets state updates against an unmounted tree.
  const after = (ms: number, fn: () => void) => {
    timers.current.push(window.setTimeout(fn, ms));
  };
  const clearTimers = () => {
    for (const t of timers.current) window.clearTimeout(t);
    timers.current = [];
  };
  useEffect(() => clearTimers, []);

  const refresh = () => {
    setHeld(collection.packsHeld());
    setCoins(collection.coins());
    setTick((n) => n + 1);   // owned/progress are read fresh on each render
  };

  /**
   * Eighteen spans, each thrown a different way.
   *
   * Appended to the stage rather than rendered through state: they are
   * decoration with no bearing on what the pack contained, and putting them in
   * the tree would re-render the cards every frame of the burst.
   */
  const burst = () => {
    const host = stage.current;
    if (!host) return;
    const flash = host.querySelector(".lr-flash");
    if (flash instanceof HTMLElement) {
      flash.classList.remove("lr-flash-on");
      void flash.offsetWidth;              // restart the animation
      flash.classList.add("lr-flash-on");
    }
    for (let i = 0; i < SPARKS; i++) {
      const s = document.createElement("span");
      s.className = "lr-spark";
      const angle = Math.random() * Math.PI * 2;
      const dist = 70 + Math.random() * 130;
      s.style.setProperty("--dx", `${Math.cos(angle) * dist}px`);
      s.style.setProperty("--dy", `${Math.sin(angle) * dist - 20}px`);
      const size = 4 + Math.random() * 7;
      s.style.width = s.style.height = `${size}px`;
      s.style.background = Math.random() < 0.45 ? "#fff4c9" : "#ffd75e";
      s.style.animation = `lr-spark-fly ${480 + Math.random() * 380}ms cubic-bezier(.15,.7,.3,1) forwards`;
      host.appendChild(s);
      after(950, () => s.remove());
    }
  };

  const openOne = () => {
    // Guarding on "closed" would break `OPEN ANOTHER`, which calls this from
    // the reveal screen. The only state that must not re-enter is the
    // animation itself.
    if (phase === "opening") return;
    const result = collection.openPack();
    if (!result) return;

    // Clear the previous pull before animating. The chest and its burst live
    // inside `.lr-openbar`, which is not mounted while cards are on screen --
    // without this the second chest would open into a container that does not
    // exist and the burst would land nowhere.
    setPulled([]);
    setSettled(undefined);
    setFlipped(new Set());

    // The chest opens first and the cards arrive after it. Spending the pack
    // here rather than on the timer means a player who leaves mid-animation
    // still gets what they paid for.
    setPhase("opening");
    refresh();
    after(BURST_AT, burst);
    after(DEAL_AT, () => {
      // In dealt order, which `settle` carries through. Rebuilding it from
      // `fresh` and `duplicates` would push every repeat to the end and the
      // pack would stop ending on its guaranteed card.
      setPulled(result.pulled);
      setSettled(result);
      setPhase("revealing");
      setBusy(true);
      after(THROTTLE_MS, () => setBusy(false));
    });
  };

  const allUp = pulled.length > 0 && flipped.size === pulled.length;

  /**
   * The one button that does two things, taken from PAC.
   *
   * While anything is face down it turns everything over; once it is all face
   * up it opens the next pack. Same press either way, which is what stops the
   * reveal being a chore for anybody who just wants their cards.
   */
  const mainAction = () => {
    if (!allUp) return setFlipped(new Set(pulled.map((_, i) => i)));
    if (!busy && collection.packsHeld() > 0) return openOne();
    return finish();
  };

  /** Toggling, not one-way: PAC lets a card be turned back, and it costs nothing. */
  const toggle = (i: number) => setFlipped((f) => {
    const next = new Set(f);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    return next;
  });

  const finish = () => {
    clearTimers();
    setPhase("closed");
    setPulled([]);
    setSettled(undefined);
    refresh();
  };

  const buy = () => {
    if (collection.buyPack()) refresh();
  };

  // Swipe right to leave, the way every other screen on a phone does. Only
  // while the pack is closed: mid-reveal a swipe is somebody scrolling the
  // pulls, not asking to go.
  const swipe = useSwipe(undefined, phase === "closed" ? back : finish);

  return (
    <div className="lr-sheet lr-packs" {...swipe}>
      <div className="lr-sheet-bar">
        <button className="lr-link" onClick={phase === "closed" ? back : finish}>
          {phase === "closed" ? "‹ back" : "‹ done"}
        </button>
        <span>Packs</span>
      </div>

      {phase !== "revealing" && (
        <>
          <div className="lr-wallet">
            <span><b>{held}</b>packs</span>
            <span><b>{coins}</b>coins</span>
            <span><b>{progress.have}/{progress.total}</b>collected</span>
          </div>

          {/* The next free pack, as a distance rather than a rule. "Two more
              matches" is a thing to go and do; "one pack every five matches"
              is a policy. */}
          <p className="lr-packsay">
            {toNext === collection.MATCHES_PER_PACK
              ? `A free pack every ${collection.MATCHES_PER_PACK} matches.`
              : `${toNext} more ${toNext === 1 ? "match" : "matches"} for a free pack.`}
          </p>

          <div className="lr-openbar" ref={stage}>
            <span className="lr-flash" aria-hidden="true" />
            <button
              className={
                `lr-packart${held > 0 ? " lr-packart-ready" : ""}` +
                (phase === "opening" ? " lr-packart-opening" : "")
              }
              disabled={held < 1 || phase === "opening"}
              onClick={openOne}
              title={held > 0 ? "open a chest" : "no chests yet"}
            >
              {/* No inline background-position: the frames are stepped by the
                  stylesheet, and an inline value would win the cascade and
                  freeze the animation on frame 0. */}
              <i />
              {held > 1 && <em className="lr-packcount">{held}</em>}
            </button>

            <div className="lr-opensay">
              {held > 0 ? (
                <>
                  <b>{held === 1 ? "One pack waiting" : `${held} packs waiting`}</b>
                  <p>Tap it to open.</p>
                </>
              ) : (
                <>
                  <b>No packs yet</b>
                  <p>Win one by playing, or buy one for {collection.PACK_PRICE} coins.</p>
                </>
              )}
              <button
                className="lr-btn lr-btn-go"
                disabled={coins < collection.PACK_PRICE}
                onClick={buy}
              >
                BUY — {collection.PACK_PRICE} COINS
              </button>
            </div>
          </div>

          {/*
            The collection, which is the reason any of this exists.

            Without it the screen was a shop with an empty shelf: three
            counters, a greyed chest and a disabled button, all of it negative
            space. A player with no chests still has something to look at, and
            the dimmed tiles are the pull -- you can see exactly what is
            missing. Each one opens that creature's faces.
          */}
          <div className="lr-collection">
            {roster.map((card) => {
              const have = has.has(card.id);
              // Shiny is per-card, not per-species: two players can hold the
              // same card and only one of them rolled the shiny.
              const shiny = have && collection.isShiny(card.id);
              return (
                <button
                  key={card.id}
                  className={`lr-slotmini${have ? "" : " lr-slotmini-off"}`}
                  title={have ? `${card.name} -- see its faces` : "not collected"}
                  disabled={!have}
                  onClick={() => setDetail(card)}
                  style={have
                    ? { ["--rarity" as string]: hex(rarityColor(card.rarity)) }
                    : undefined}
                >
                  <span className="lr-face" style={portraits.styleFor(card.sheet, 28, shiny)} />
                </button>
              );
            })}
          </div>
        </>
      )}

      {detail && <FaceSheet card={detail} close={() => setDetail(undefined)} />}

      {phase === "revealing" && (
        <>
          <div className="lr-pulls">
            {pulled.map((card, i) => {
              const up = flipped.has(i);
              const isNew = settled?.fresh.includes(card);
              return (
                <button
                  key={`${card.id}-${i}`}
                  className={`lr-pull${up ? " lr-pull-up" : ""}`}
                  style={{
                    ["--rarity" as string]: hex(rarityColor(card.rarity)),
                    // Staggered entry, the way PAC's `distribute` fans them
                    // out from where the button was.
                    animationDelay: `${i * 70}ms`,
                  }}
                  onClick={() => toggle(i)}
                  title={up ? card.name : "turn it over"}
                >
                  {/*
                    Both faces exist at all times, back-to-back in 3D, and the
                    parent rotates. Swapping the contents on flip -- which is
                    what this did before -- cannot produce a turn, because
                    there is never a second side to turn to.
                  */}
                  <span className="lr-pull-inner">
                    <span className="lr-pull-side lr-pull-back" aria-hidden={up} />
                    <span className="lr-pull-side lr-pull-face" aria-hidden={!up}>
                      <span
                        className="lr-face"
                        style={
                          card.emotion
                            ? emotions.styleFor(card.sheet, card.emotion, card.shiny === true, 44)
                            : portraits.styleFor(card.sheet, 44, card.shiny)
                        }
                      />
                      <b>{card.name}</b>
                      {/* The face is what makes two pulls of the same creature
                          different things to own, so it is named as loudly as
                          the rarity. */}
                      <small>{card.shiny ? "shiny " : ""}{card.rarity}</small>
                      <small className="lr-pull-face-name">
                        {emotions.nameOf(card.emotion ?? emotions.NORMAL)}
                      </small>
                      {isNew
                        ? <em className="lr-new">new</em>
                        : <em>+{packs.coinsFor(card.rarity)}</em>}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          <p className="lr-packsay">
            {!allUp
              ? "Tap a card to turn it over."
              : settled
                ? `${settled.fresh.length} new${
                    settled.duplicates.length > 0
                      ? `, ${settled.duplicates.length} repeated — +${settled.coins} coins`
                      : ""
                  }`
                : ""}
          </p>

          {/*
            PAC's one button, doing both jobs. Its label has to say which job
            it is about to do, or the same control silently changes meaning
            under the player's thumb.
          */}
          <button className="lr-btn lr-btn-go" onClick={mainAction} disabled={busy && allUp}>
            {!allUp
              ? "REVEAL ALL"
              : held > 0
                ? `OPEN ANOTHER — ${held} LEFT`
                : "DONE"}
          </button>
          {allUp && held > 0 && (
            <button className="lr-link" onClick={finish}>stop here</button>
          )}
        </>
      )}

    </div>
  );
}


/**
 * One creature's faces, opened from the collection.
 *
 * This is the screen the collection existed for and did not have: a tile told
 * you that you owned a creature and nothing more, when what you actually own is
 * a set of faces -- up to twenty, doubled by shiny. Owning six of Charmander's
 * forty is a different thing from owning one, and only this view can say so.
 *
 * The sheet is fetched per creature, so opening one costs about 59 KB rather
 * than the 19.7 MB the whole set weighs.
 */
function FaceSheet({ card, close }: { card: Card; close(): void }) {
  const [, bump] = useState(0);
  const held = collection.variantsOwned();
  const purse = collection.shardsFor(card.id);
  const rows: { label: string; shiny: boolean; faces: readonly number[] }[] = [
    { label: "Normal", shiny: false, faces: emotions.available(card.sheet, false) },
    { label: "Shiny", shiny: true, faces: emotions.available(card.sheet, true) },
  ];
  const owns = (face: number, shiny: boolean) => {
    const suffix = face === emotions.NORMAL ? "" : `#e${face}`;
    return held.has(`${card.id}${suffix}${shiny ? "#shiny" : ""}`);
  };
  const total = rows.reduce((a, r) => a + r.faces.length, 0);
  const mine = rows.reduce(
    (a, r) => a + r.faces.filter((f) => owns(f, r.shiny)).length, 0);

  return (
    <div className="lr-faces-sheet" onClick={close}>
      <div className="lr-faces-box" onClick={(e) => e.stopPropagation()}>
        <p className="lr-faces-head">
          <b>{card.name}</b>
          <span>{mine} of {total} faces</span>
          {/* The purse is per creature, so it belongs in this creature's
              header rather than anywhere global. */}
          <span className="lr-shards">{purse} shards</span>
          <button className="lr-link" onClick={close}>close</button>
        </p>
        {total === 0 && <p className="lr-packsay">No extra faces for this one yet.</p>}
        {rows.map((r) => r.faces.length > 0 && (
          <div key={r.label} className="lr-faces-row">
            <span className="lr-faces-label">{r.label}</span>
            <div className="lr-faces-grid">
              {r.faces.map((face) => {
                const have = owns(face, r.shiny);
                const cost = packs.faceCost(face, r.shiny);
                const canBuy = !have && purse >= cost;
                return (
                  <button
                    key={`${r.label}-${face}`}
                    className={`lr-faceslot${have ? "" : " lr-faceslot-off"}${canBuy ? " lr-faceslot-buy" : ""}`}
                    disabled={have || !canBuy}
                    title={have
                      ? emotions.nameOf(face)
                      : `${emotions.nameOf(face)} -- ${cost} shards`}
                    onClick={() => {
                      if (collection.buyFace(card.id, face, r.shiny)) bump((n) => n + 1);
                    }}
                  >
                    <span style={emotions.styleFor(card.sheet, face, r.shiny, 40)} />
                    <em>{emotions.nameOf(face)}</em>
                    {/* An owned face needs no price; an unowned one is only
                        worth wanting if you can see what it costs. */}
                    {!have && <i className="lr-facecost">{cost}</i>}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
