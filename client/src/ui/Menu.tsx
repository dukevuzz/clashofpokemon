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
 */

import { useState } from "react";
import * as cards from "../core/cards";
import * as towerTroops from "../core/towerTroops";
import * as portraits from "./portraits";
import { config } from "../core/config";
import * as mega from "../core/mega";
import {
  loadDeck, deckIsFull, loadRecord, loadSettings, saveSettings, loadTroop, saveTroop,
} from "./deckStore";

export interface MenuProps {
  /** Hand control back to Phaser for a scene that genuinely needs it. */
  go(scene: "Battle" | "Deck" | "Dex"): void;
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
}

export function Menu({ go, online, status, rejoin, host, join, inviteCode }: MenuProps) {
  const [code, setCode] = useState("");
  const [troop, setTroop] = useState(loadTroop());
  const [settings, setSettings] = useState(loadSettings());
  const deck = loadDeck();
  const record = loadRecord();

  const avg = deck.reduce((a, c) => a + c.elixir, 0) / Math.max(1, deck.length);
  const played = record.wins + record.losses + record.draws;

  const pickTroop = (id: string) => {
    setTroop(id);
    saveTroop(id);
  };

  const toggleElixir = () => {
    const next = { ...settings, showEnemyElixir: !settings.showEnemyElixir };
    setSettings(next);
    saveSettings(next);
  };

  return (
    <div className="lr-menu">
      <h1>CLASH OF POKÉMON</h1>
      <p className="lr-tagline">
        {cards.ALL.length} creatures · {deck.length} card decks
      </p>
      <p className="lr-record">
        {played === 0
          ? "no matches played yet"
          : `${record.wins}W · ${record.losses}L · ${record.draws}D`}
      </p>

      <section className="lr-card">
        <h2>Your deck</h2>
        <div className="lr-deck">
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
              onClick={() => go("Deck")}
              title={
                i === 0
                  ? `${c.name} — ${c.elixir} elixir · Mega slot${mega.canEverMega(c) ? "" : " (this card cannot Mega)"}`
                  : `${c.name} — ${c.elixir} elixir`
              }
            >
              <span className="lr-cost-pip">{c.elixir}</span>
              <span className="lr-face" style={portraits.styleFor(c.sheet, 48)} />
              <span className="lr-slot-name">{c.name}</span>
            </button>
          ))}
        </div>
        <p className="lr-avg">
          <b>{avg.toFixed(1)}</b> average cost
        </p>
      </section>

      <section className="lr-card">
        <h2>Tower creature</h2>
        <div className="lr-troops">
          {towerTroops.TROOPS.map((t) => {
            const dps = towerTroops.sustainedDps(t);
            return (
              <button
                key={t.id}
                className="lr-troop"
                aria-pressed={t.id === troop}
                onClick={() => pickTroop(t.id)}
              >
                <span className="lr-face" style={portraits.styleFor(t.species, 40)} />
                <span className="lr-troop-body">
                  <b>{t.name}</b>
                  <small>{t.blurb}</small>
                  <small className="lr-troop-nums">
                    {dps.toFixed(0)} dps · {t.reach} reach
                    {t.volley
                      ? ` · ${towerTroops.burstDps(t).toFixed(0)} burst`
                      : ""}
                  </small>
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/*
        A short deck cannot start a match. It used to be impossible to have one
        here -- the loader quietly refilled any gap -- which is precisely how a
        removed card came back as a different card. Now the gap is real, so this
        is where it has to be caught, and it says which rather than going dead.
      */}
      {/*
        The guide, above the play buttons rather than beside DECK and DEX.
        It was the third of three identical grey buttons down there, which read
        as a utility rather than as help, and players said they never noticed
        it. Same page, same link, given the weight of the thing it actually is.

        A link and not a scene: the guide is its own page and the new tab is
        the point -- it is read *while* playing, so a match in progress is
        still there on the way back.
      */}
      <a
        className="lr-play lr-play-guide"
        href="./guide.html"
        target="_blank"
        rel="noopener"
      >
        HOW TO PLAY
        <small>every card and every rule, in two minutes of reading</small>
      </a>

      <button
        className="lr-play"
        disabled={!deckIsFull(deck)}
        onClick={() => deckIsFull(deck) && go("Battle")}
      >
        PLAY OFFLINE
        <small>
          {deckIsFull(deck)
            ? `against a bot — 3 minutes, ${deck.length} cards`
            : `deck needs ${config.deckSize} cards — you have ${deck.length}`}
        </small>
      </button>

      {rejoin && (
        <button className="lr-play lr-play-rejoin" onClick={rejoin}>
          REJOIN MATCH
          <small>you left one running</small>
        </button>
      )}

      {online && (
        <button
          className="lr-play lr-play-online"
          disabled={!deckIsFull(deck) || Boolean(status)}
          onClick={() => deckIsFull(deck) && online()}
        >
          {status ? "SEARCHING…" : "PLAY ONLINE"}
          <small>{status ?? "find a real opponent"}</small>
        </button>
      )}

      {/*
        Playing somebody you chose.

        A code rather than a friends list: it works over Discord, over a phone
        and across a room, and nobody has to have added anybody first. The
        friends list can come later and this will still be the fastest way to
        start a game with the person sitting next to you.
      */}
      {host && join && (
        <section className="lr-invite">
          {inviteCode ? (
            <p className="lr-invite-code">
              <b>{inviteCode}</b>
              <small>read this to your friend</small>
            </p>
          ) : (
            <div className="lr-invite-row">
              <button
                className="lr-btn"
                disabled={!deckIsFull(deck) || Boolean(status)}
                onClick={() => deckIsFull(deck) && host()}
              >
                HOST
              </button>
              <input
                className="lr-search"
                placeholder="or enter a code"
                value={code}
                maxLength={5}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && code.length === 5) join(code);
                }}
              />
              <button
                className="lr-btn"
                disabled={code.length !== 5 || !deckIsFull(deck)}
                onClick={() => join(code)}
              >
                JOIN
              </button>
            </div>
          )}
        </section>
      )}

      <div className="lr-menu-row">
        <button className="lr-btn" onClick={() => go("Deck")}>DECK</button>
        <button className="lr-btn" onClick={() => go("Dex")}>DEX</button>
      </div>

      <div className="lr-menu-row">
        <a className="lr-link" href="./guide.html#feedback" target="_blank" rel="noopener">
          report a bug or suggest something
        </a>
      </div>

      <button className="lr-link" onClick={toggleElixir}>
        show opponent elixir: {settings.showEnemyElixir ? "on" : "off"}
      </button>
      <p className="lr-hint">
        Drag a card onto your half, or tap the card then tap the board.
      </p>

      {/*
        Said plainly, on the first screen, rather than buried in a menu. This
        is a fan project built on somebody else's characters -- the honest
        thing is to say so where everybody sees it, not where it is technically
        findable.
      */}
      <p className="lr-legal">
        Pokémon © 1995–2026 Nintendo / Creatures Inc. / GAME FREAK inc.
        Pokémon and Pokémon character names are trademarks of Nintendo.
      </p>
      <p className="lr-legal">
        A non-commercial fan project, not affiliated with, endorsed by or
        associated with Nintendo, The Pokémon Company, Creatures Inc. or GAME
        FREAK inc. No money is made from this game and none is asked for.
      </p>
      {/*
        The sprite licence asks for credit, and a credit buried in a file in
        the repository is not one. CC BY-NC also asks that changes be noted:
        the frames were repacked into atlases, nothing was redrawn.
      */}
      <p className="lr-legal">
        Creature sprites by{" "}
        <a href="https://sprites.pmdcollab.org/" target="_blank" rel="noopener">
          PMD Sprite Collab
        </a>
        , used under{" "}
        <a
          href="https://creativecommons.org/licenses/by-nc/4.0/"
          target="_blank"
          rel="noopener"
        >
          CC BY-NC 4.0
        </a>{" "}
        and repacked into atlases. Towers by Foozle (CC0).
      </p>
    </div>
  );
}
