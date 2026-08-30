/**
 * The Pokedex: every species the game knows, searchable.
 *
 * A document, so a document is what it is built as. Phaser draws the board;
 * every screen you read rather than play is React, which is also how
 * pokemonAutoChess splits it.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { SPECIES, typesOf, TYPE_COLORS, TYPE_SHORT } from "../core/species";
import * as tiers from "../core/tiers";
import * as cards from "../core/cards";
import * as evolution from "../core/evolution";
import { towerRange } from "../core/config";
import * as sprites from "./sprites";
import * as portraits from "./portraits";
import { skillOf } from "./skillCard";
import { useSwipe } from "./useSwipe";

/**
 * How many rows to build at once.
 *
 * Paged rather than virtualised, as before: 1,149 rows is enough that building
 * them all costs a visible pause, and few enough that a scroll-triggered page
 * is simpler and less breakable than recycling nodes by index.
 */
const PAGE = 120;

interface Row {
  id: string;
  name: string;
  rarity: string;
  role: string;
  cost: number;
  types: string[];
  playable: boolean;
  tags: string[];
  haystack: string;
}

const rgbCss = (rgb?: number[]) =>
  rgb ? `rgb(${rgb.map((v) => Math.round(v * 255)).join(",")})` : "#999";

function buildRows(): Row[] {
  const out: Row[] = [];
  for (const [id, info] of Object.entries(SPECIES)) {
    const role = tiers.roleOf(id);
    const rarity = tiers.rarityOf(id);
    const types = typesOf(id);
    const flying = types.includes("FLYING");
    const runner = tiers.isRunner(role, flying);
    const t = tiers.traitsOf(id, towerRange());
    const onRoster = cards.byId(id);
    const tags: string[] = [];
    if (t.jumpsRiver) tags.push("crosses anywhere");
    if (t.flying) tags.push("air");
    if (t.outrangesTower) tags.push("outranges tower");
    if (t.trueDamage) tags.push("true dmg");
    if (onRoster?.copies) tags.push("copies last card");
    if (onRoster?.delivery) tags.push(onRoster.delivery);
    if ((onRoster?.count ?? 1) > 1) tags.push(`x${onRoster!.count} bodies`);

    out.push({
      id,
      name: id.charAt(0).toUpperCase() + id.slice(1),
      rarity, role, types, tags,
      haystack: [id, role, rarity, ...types, ...tags].join(" ").toLowerCase(),
      cost: cards.costOf(info, rarity, 1, { wincon: false, jumps: runner, flying }),
      playable: sprites.hasSheet(id),
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function DexScreen({ back }: { back(): void }) {
  // Built once: it walks every species and prices each one, which is not work
  // to repeat on a keystroke.
  const all = useMemo(buildRows, []);
  const [query, setQuery] = useState("");
  const [onlyPlayable, setOnlyPlayable] = useState(false);
  const [drawn, setDrawn] = useState(PAGE);
  const [picked, setPicked] = useState<Row>();
  const list = useRef<HTMLDivElement>(null);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter((r) =>
      (!onlyPlayable || r.playable) && (!q || r.haystack.includes(q)));
  }, [all, query, onlyPlayable]);

  // A new filter is a new list, so paging starts over and so does the scroll.
  useEffect(() => {
    setDrawn(PAGE);
    if (list.current) list.current.scrollTop = 0;
  }, [query, onlyPlayable]);

  const onScroll = () => {
    const el = list.current;
    if (!el) return;
    if (el.scrollTop + el.clientHeight > el.scrollHeight - 400) {
      setDrawn((n) => (n >= shown.length ? n : n + PAGE));
    }
  };

  const swipe = useSwipe(undefined, back);

  return (
    <div className="lr-screen lr-dex" {...swipe}>
      <header>
        <h1>POKEDEX</h1>
        <input
          className="lr-search"
          type="search"
          placeholder="search name, type, rarity, trait…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          className="lr-btn"
          aria-pressed={onlyPlayable}
          onClick={() => setOnlyPlayable((v) => !v)}
        >
          Playable only
        </button>
        <span className="lr-sub lr-dexcount">{shown.length} of {all.length}</span>
        <button className="lr-link" onClick={back}>‹ back</button>
      </header>

      <div className="lr-dexbody">
        <div className="lr-list" ref={list} onScroll={onScroll}>
          {shown.slice(0, drawn).map((r) => (
            <div
              key={r.id}
              className={r.playable ? "lr-row" : "lr-row dim"}
              role="button"
              tabIndex={0}
              aria-selected={picked?.id === r.id}
              onClick={() => setPicked(r)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setPicked(r); }}
            >
              <div className="lr-face" style={portraits.styleFor(r.id, 40)} />
              <div className="lr-id">
                <b>{r.name}</b>
                {/* The tags are the part worth reading, so they get the line
                    rather than being truncated the way the canvas table had to. */}
                <small>{[r.role, r.rarity, ...r.tags].join(" · ")}</small>
              </div>
              <div className="lr-types">
                {r.types.slice(0, 2).map((t) => (
                  <span key={t} style={{ background: rgbCss(TYPE_COLORS[t]) }}>
                    {TYPE_SHORT[t] ?? t.slice(0, 3)}
                  </span>
                ))}
              </div>
              <div className="lr-nums">
                <span className="lr-cost">{r.cost}</span>
                <small>{SPECIES[r.id].hp} hp · {SPECIES[r.id].atk} atk</small>
              </div>
            </div>
          ))}
        </div>

        <div className="lr-detail">
          {picked ? <Detail row={picked} /> : (
            <div className="lr-sub">Pick a creature to see what it does.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function Detail({ row }: { row: Row }) {
  const info = SPECIES[row.id];
  const built = cards.byId(row.id) ?? cards.build(row.id);
  const line = evolution.lineOf(row.id)
    .map((f) => (f === row.id ? f.toUpperCase() : f))
    .join("  →  ");
  const skill = built ? skillOf(built) : undefined;

  return (
    <>
      <h2>{row.name}</h2>
      <div className="lr-sub">
        {[row.role, row.rarity, row.types.join("/")].join(" · ")}
        {row.playable ? "" : " · no sprite, cannot be played"}
      </div>
      <dl>
        <dt>health</dt><dd>{info.hp}</dd>
        <dt>attack</dt><dd>{info.atk}</dd>
        <dt>defence</dt><dd>{info.def} / {info.speDef} special</dd>
        <dt>speed</dt>
        <dd>{info.speed}{built ? ` · swings every ${built.attackRate}s` : ""}</dd>
        <dt>reach</dt>
        <dd>{info.range}{built ? ` · ${built.range} units` : ""}</dd>
        <dt>would cost</dt><dd>{row.cost} elixir</dd>
        {line.includes("→") && (<><dt>line</dt><dd>{line}</dd></>)}
      </dl>
      {skill && (
        <div className="lr-skill">
          <b>{skill.name}</b> — {skill.summary}
          <br />
          <small>
            {skill.amount} damage, resisted by {skill.resist} · every{" "}
            {skill.every} attacks, about {skill.seconds.toFixed(1)}s
          </small>
        </div>
      )}
    </>
  );
}
