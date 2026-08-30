/**
 * The menu, in React.
 *
 * Everything here was Phaser text and rectangles at hand-computed coordinates,
 * and it was blurry for a structural reason no amount of font tuning fixes:
 * anything drawn into the canvas is rasterised at the design size and then
 * rescaled with the whole canvas to fit the window. At 620x1080 shown at
 * 483x840 that is a 0.78x resample of every glyph.
 *
 * The board still has to be canvas -- it moves, it layers sprites, it runs at
 * 30 steps a second. A menu is a document. This is the split pokemonAutoChess
 * made from the start: Phaser draws the game, React and CSS draw everything
 * around it.
 *
 * The screen is built around one question -- start a match -- with everything
 * else behind the profile bar or a tab. It used to be a single scroll of
 * fourteen things ending in three paragraphs of licence text, with the player
 * appearing nowhere on it at all.
 */

import { useState } from "react";
import * as cards from "../core/cards";
import * as portraits from "./portraits";
import { Icon } from "./icons";
import { config } from "../core/config";
import * as mega from "../core/mega";
import * as profileStore from "./profile";
import * as collection from "./collection";
import { useSwipe } from "./useSwipe";
import { ProfileScreen } from "./Profile";
import { PacksScreen } from "./Packs";
import { DexScreen } from "./Dex";
import { DeckScreen } from "./Deck";
import { loadDeck, deckIsFull, loadTroop, saveTroop } from "./deckStore";
import * as towerTroops from "../core/towerTroops";
import { ARENA_NAMES, IN_ROTATION } from "./arena";

export interface MenuProps {
  /** Hand control back to Phaser for a scene that genuinely needs it. */
  go(scene: "Battle"): void;
  /** Queue for a real opponent. Absent until a game server is reachable. */
  online?(): void;
  /** Open a private room and get a code to read to somebody. */
  host?(): void;
  /** Join the room somebody read a code out from. */
  join?(code: string): void;
  /** The code for a room this player opened, once the server has named it. */
  inviteCode?: string;
  /**
   * What the connection is doing, in words.
   *
   * A prop rather than a Phaser text on the canvas: this menu is a DOM overlay
   * *over* the canvas, so anything the scene draws underneath is invisible.
   * The first version put "finding an opponent..." behind the menu, and
   * pressing the button looked like it did nothing at all.
   */
  status?: string;
  /** A match this account is already in, left behind by a refresh. */
  rejoin?(): void;
  /**
   * A picture of one of the arenas, once the scene has rendered one.
   *
   * Rendered rather than shipped as art, so it cannot fall behind the tiles.
   * Absent for the first frame or two, and the panel simply has no picture
   * until it arrives -- no spinner, no reserved grey box that flashes.
   */
  arena?: { theme: string; src: string };
}

/** What BATTLE does when pressed. Remembered, so the drawer is rarely opened. */
type Mode = "bot" | "online" | "friend";
const MODE_KEY = "clashofpokemon.mode";

export function Menu(props: MenuProps) {
  const [screen, setScreen] = useState<"menu" | "profile" | "packs" | "dex" | "deck">("menu");
  if (screen === "profile") return <ProfileScreen back={() => setScreen("menu")} />;
  if (screen === "packs") return <PacksScreen back={() => setScreen("menu")} />;
  if (screen === "dex") return <DexScreen back={() => setScreen("menu")} />;
  if (screen === "deck") {
    return (
      <DeckScreen back={() => setScreen("menu")} play={() => props.go("Battle")} />
    );
  }
  return (
    <Home
      {...props}
      openProfile={() => setScreen("profile")}
      openPacks={() => setScreen("packs")}
      openDex={() => setScreen("dex")}
      openDeck={() => setScreen("deck")}
    />
  );
}

function Home({
  go, online, status, rejoin, host, join, inviteCode, arena,
  openProfile, openPacks, openDex, openDeck,
}: MenuProps & {
  openProfile(): void; openPacks(): void; openDex(): void; openDeck(): void;
}) {
  const [code, setCode] = useState("");
  const [drawer, setDrawer] = useState(false);
  const [mode, setMode] = useState<Mode>(rememberedMode());
  const [troop, setTroop] = useState(loadTroop());
  const [pickingTroop, setPickingTroop] = useState(false);

  const me = profileStore.current();
  const deck = loadDeck();
  const full = deckIsFull(deck);
  const avg = deck.reduce((a, c) => a + c.elixir, 0) / Math.max(1, deck.length);
  const face = profileStore.faceOf(me, deck);
  const troopName = towerTroops.TROOPS.find((t) => t.id === troop)?.name ?? troop;

  // A mode the server cannot serve is shown and disabled rather than removed.
  // ONLINE used to hide itself when nothing answered and REJOIN appeared only
  // after an abandoned match, so the menu physically changed shape underneath
  // whoever was reading it.
  const available: Record<Mode, boolean> = {
    bot: full,
    online: full && online !== undefined && !status,
    friend: full && host !== undefined,
  };

  const choose = (next: Mode) => {
    setMode(next);
    setDrawer(false);
    try {
      localStorage.setItem(MODE_KEY, next);
    } catch {
      // Private browsing refuses writes; the choice just does not persist.
    }
  };

  const start = () => {
    if (!available[mode]) return;
    if (mode === "bot") go("Battle");
    else if (mode === "online") online?.();
    else host?.();
  };

  // The tab bar reads packs / deck / battle / dex, and BATTLE is where you
  // start. Swiping moves to whichever neighbour the finger points at, so the
  // row behaves like the row it looks like.
  const swipe = useSwipe(openDex, openDeck);

  return (
    <div className="lr-menu" {...swipe}>
      {/*
        The profile bar: a handle, not a dashboard.

        Face, name, chevron. The record and the account state are one tap away
        -- everything on this screen that is not "start a match" competes with
        the thing the screen is for. The red dot is the single exception, and
        it is a dot rather than a sentence because it costs no height.
      */}
      <button className="lr-whoami" onClick={openProfile}>
        <span className="lr-whoami-face">
          <span
            className="lr-face"
            style={portraits.styleFor(sheetOf(face), 34, face !== undefined && collection.isShiny(face))}
          />
          {profileStore.atRisk(me) && <i className="lr-dot" title="not saved anywhere" />}
        </span>
        <span className="lr-whoami-name">{me.name}</span>
        <span className="lr-chev">›</span>
      </button>

      {/*
        Your standing.

        This is the slot Clash Royale gives its arena render, and it is kept at
        that size because trophies and ranking are coming and will live here.
        What it must not do is claim an arena: `pickTheme()` deals the map from
        the match id, so "your arena" is a map you have no claim to.

        Unranked stays unranked until ranked play exists. No placeholder trophy
        count -- a home screen that advertises is one where the real numbers
        stop being believed.
      */}
      <section className="lr-standing">
        {/*
          The arena, as a picture of the actual board.

          This is the slot Clash Royale gives its arena, and it does the same
          job here: it is the one thing on the screen with any size to it, and
          without it a portrait layout on a desktop is a strip of panels in an
          empty box.

          Captioned as one of four, never as yours -- `pickTheme` deals a map
          from the match id, so no arena belongs to anybody.
        */}
        {arena && (
          <figure className="lr-arena">
            <img src={arena.src} alt="" />
            <figcaption>
              {arenaName(arena.theme)} · one of {ARENAS} arenas, dealt each match
            </figcaption>
          </figure>
        )}
        <div className="lr-crest" aria-hidden="true">🏆</div>
        <p className="lr-rank">UNRANKED</p>
        {me.bestStreak > 1 && (
          <p className="lr-streak">best streak {me.bestStreak}</p>
        )}
        <div className="lr-stats">
          <span><b>{me.wins}</b>won</span>
          <span><b>{me.losses}</b>lost</span>
          <span>
            <b>{me.winRate === undefined ? "—" : `${me.winRate}%`}</b>
            {me.played === 0 ? "no matches yet" : "win rate"}
          </span>
        </div>
      </section>

      <div className="lr-deck-strip">
        {deck.map((c, i) => (
          <button
            key={c.id}
            // Slot one is the Mega slot, marked here as well as in the deck
            // editor: this row is where a player looks before pressing play,
            // and a deck whose Mega slot holds a card that cannot Mega is
            // worth noticing before the match rather than during it.
            className={
              i === 0
                ? `lr-slot lr-mega${mega.canEverMega(c) ? "" : " lr-mega-off"}`
                : "lr-slot"
            }
            onClick={openDeck}
            title={
              i === 0
                ? `${c.name} — ${c.elixir} elixir · Mega slot${mega.canEverMega(c) ? "" : " (this card cannot Mega)"}`
                : `${c.name} — ${c.elixir} elixir`
            }
          >
            <span className="lr-cost-pip">{c.elixir}</span>
            <span className="lr-face" style={portraits.styleFor(c.sheet, 40, collection.isShiny(c.id))} />
          </button>
        ))}
      </div>
      {/*
        The tower creature, chosen here.

        It had a whole panel on the old menu and this line replaced it -- which
        quietly removed the only way to change it, because the deck editor
        never grew a picker to move it to. A line that opens four options costs
        one row and keeps the choice reachable.
      */}
      <p className="lr-deckmeta">
        <button
          className="lr-link"
          aria-expanded={pickingTroop}
          onClick={() => setPickingTroop(!pickingTroop)}
        >
          tower: {troopName} {pickingTroop ? "▴" : "▾"}
        </button>
        <span>{avg.toFixed(1)} avg elixir</span>
      </p>

      {pickingTroop && (
        <div className="lr-troop-pick">
          {towerTroops.TROOPS.map((t) => (
            <button
              key={t.id}
              className="lr-troop-opt"
              aria-pressed={t.id === troop}
              onClick={() => {
                setTroop(t.id);
                saveTroop(t.id);
                setPickingTroop(false);
              }}
            >
              <span className="lr-face" style={portraits.styleFor(t.species, 34)} />
              <span className="lr-troop-text">
                <b>{t.name}</b>
                <small>{t.blurb}</small>
              </span>
            </button>
          ))}
        </div>
      )}

      {/*
        BATTLE, with the modes in a drawer on its shoulder.

        Five buttons at equal weight is five decisions before a match and the
        answer is nearly always the same one, so the last choice is remembered
        and the arrow opens the rest.
      */}
      <div className="lr-battlebar">
        <button className="lr-play" disabled={!available[mode]} onClick={start}>
          {status ? "SEARCHING…" : "BATTLE"}
          <small>{status ?? describe(mode, deck.length, full)}</small>
        </button>
        <button
          className="lr-drawer"
          aria-expanded={drawer}
          title="choose a mode"
          onClick={() => setDrawer(!drawer)}
        >
          ▾
        </button>
      </div>

      {drawer && (
        <div className="lr-modes">
          {(["bot", "online", "friend"] as Mode[]).map((m) => (
            <button
              key={m}
              className="lr-mode"
              aria-pressed={m === mode}
              disabled={!available[m]}
              onClick={() => choose(m)}
            >
              {label(m)}
              <small>{why(m, available[m], status)}</small>
            </button>
          ))}
          {rejoin && (
            <button className="lr-mode lr-mode-rejoin" onClick={rejoin}>
              REJOIN <small>you left one running</small>
            </button>
          )}
        </div>
      )}

      {/*
        Playing somebody you chose.

        A code rather than a friends list: it works over Discord, over a phone
        and across a room, and nobody has to have added anybody first.
      */}
      {mode === "friend" && host && join && (
        <section className="lr-invite">
          {inviteCode ? (
            <p className="lr-invite-code">
              <b>{inviteCode}</b>
              <small>read this to your friend</small>
            </p>
          ) : (
            <div className="lr-invite-row">
              <input
                className="lr-search"
                placeholder="enter a code to join"
                value={code}
                maxLength={5}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && code.length === 5) join(code);
                }}
              />
              <button
                className="lr-btn"
                disabled={code.length !== 5 || !full}
                onClick={() => join(code)}
              >
                JOIN
              </button>
            </div>
          )}
        </section>
      )}

      {/*
        The tabs take the scroll.

        Five: packs, deck, battle, dex, guide. There is no settings tab --
        the profile is the settings screen and the bar already reaches it.
        PACKS is drawn and disabled -- it needs a collection the
        server keeps and accounts that survive a cleared browser, so it is a
        placeholder rather than a promise.
      */}
      <nav className="lr-tabs">
        <button className="lr-tab" onClick={openPacks}>
          <Icon name="packs" />
          <span>packs</span>
        </button>
        <button className="lr-tab" onClick={openDeck}>
          <Icon name="deck" /><span>deck</span>
        </button>
        <button className="lr-tab lr-tab-on" aria-current="page">
          <Icon name="battle" /><span>battle</span>
        </button>
        {/*
          The Pokedex. It was left unreachable when the old menu's DECK/DEX
          row became this tab bar -- the scene was still registered and still
          worked, and nothing in the game navigated to it.
        */}
        <button className="lr-tab" onClick={openDex}>
          <Icon name="dex" /><span>dex</span>
        </button>
        <a className="lr-tab" href="./guide.html" target="_blank" rel="noopener">
          <Icon name="guide" /><span>guide</span>
        </a>
      </nav>

      <p className="lr-hint">
        {cards.ALL.length} creatures · drag a card onto your half, or tap the
        card then tap the board.
      </p>

      {/*
        Said plainly, on the first screen, rather than buried in a menu. This
        is a fan project built on somebody else's characters -- the honest
        thing is to say so where everybody sees it. The full credits, which
        nobody reads twice, moved to the guide.
      */}
      <p className="lr-legal">
        Pokémon © 1995–2026 Nintendo / Creatures Inc. / GAME FREAK inc. A
        non-commercial fan project, not affiliated with or endorsed by them.
        Sprites by{" "}
        <a href="https://sprites.pmdcollab.org/" target="_blank" rel="noopener">
          PMD Sprite Collab
        </a>{" "}
        under CC BY-NC 4.0. Full credits are in your profile.
      </p>
    </div>
  );
}

function rememberedMode(): Mode {
  try {
    const saved = localStorage.getItem(MODE_KEY);
    if (saved === "bot" || saved === "online" || saved === "friend") return saved;
  } catch {
    // Unreadable store: the default is the one that always works.
  }
  return "bot";
}

const label = (m: Mode) =>
  m === "bot" ? "VS A BOT" : m === "online" ? "ONLINE" : "FRIEND";

function why(m: Mode, ok: boolean, status?: string): string {
  if (ok) {
    return m === "bot"
      ? "3 minutes, offline"
      : m === "online"
        ? "find a real opponent"
        : "host or enter a code";
  }
  if (m === "online") return status ? "already searching" : "no server answering";
  if (m === "friend") return "no server answering";
  return "your deck is not ready";
}

function describe(mode: Mode, size: number, full: boolean): string {
  if (!full) return `deck needs ${config.deckSize} cards — you have ${size}`;
  return mode === "bot"
    ? "vs a bot — 3 minutes"
    : mode === "online"
      ? "vs a real opponent"
      : "vs a friend";
}

/** A card id is not always its sheet name, so resolve it rather than assume. */
function sheetOf(id: string | undefined): string {
  return (id ? cards.byId(id)?.sheet : undefined) ?? "pikachu";
}

const ARENAS = IN_ROTATION.length;
const arenaName = (theme: string) => ARENA_NAMES[theme] ?? theme;
