/**
 * The roster, filtered.
 *
 * pokemonAutoChess's wiki puts one filter on screen at a time and throws the
 * previous one away, so "cheap fliers that evolve" is three separate searches
 * you hold in your head. Every facet here is live at once and they intersect,
 * because that is the actual shape of the question a player has.
 *
 * Three rules the mockup settled on and this keeps:
 *
 *   - The count is always visible. A filter set that matches nothing should say
 *     so immediately, not look like a loading bug.
 *   - Every active facet is a chip you can see and dismiss. PAC's filters go
 *     invisible once you scroll, and then the empty grid is a mystery.
 *   - The URL carries the filters, so a set of them can be read out to somebody.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import * as cards from "../core/cards";
import type { Card } from "../core/cards";
import * as tiers from "../core/tiers";
import { rarityColor } from "../ui/theme";
import * as evolution from "../core/evolution";
import { TYPE_SHORT } from "../core/species";
import * as portraits from "../ui/portraits";
import { dpsOf, bulkOf } from "./facts";
import { CardDetail } from "./CardDetail";

const ALL_TYPES = [...new Set(cards.ALL.flatMap((c) => c.types))].sort();
const COSTS = [...new Set(cards.ALL.map((c) => c.elixir))].sort((a, b) => a - b);

type SortKey = "elixir" | "hp" | "damage" | "dps" | "speed" | "name" | "rarity";

const SORTS: Array<{ key: SortKey; label: string }> = [
  { key: "elixir", label: "Cost" },
  { key: "rarity", label: "Rarity" },
  { key: "hp", label: "Health" },
  { key: "damage", label: "Damage" },
  { key: "dps", label: "Damage/sec" },
  { key: "speed", label: "Speed" },
  { key: "name", label: "Name" },
];

interface Filters {
  q: string;
  rarity: string[];
  type: string[];
  role: string[];
  cost: number[];
  /** Properties a card either has or does not. See TRAITS. */
  traits: string[];
  /** How many types a card has: 1, 2 or 3. Any of, like rarity. */
  typeCount: number[];
  sort: SortKey;
  desc: boolean;
}

const EMPTY: Filters = {
  q: "", rarity: [], type: [], role: [], cost: [], traits: [], typeCount: [],
  sort: "elixir", desc: false,
};

/**
 * The things players actually filter for that no stat column shows.
 *
 * Three candidates were cut rather than shipped, all for the same reason -- a
 * filter that does not answer a real question is worse than no filter, because
 * whatever it returns looks like an answer:
 *
 *   hits air / ground   No such thing here. `targets` is troop-or-building and
 *                       everything can hit anything.
 *   crosses river       `jumpsRiver` is inert while `config.riverBypass` is
 *                       false, which it is. Everything walks to a bridge.
 *   flies               Not the same idea as the Flying type, and not yet a
 *                       real field. Whether a Pokemon is off the ground is a
 *                       property of its design -- wings, or something that
 *                       simply hovers -- so a Ghost or a Dragon can be
 *                       airborne. Today's `flying` flag is 18 cards, 17 of
 *                       which are just the Flying type, so filtering on it
 *                       would answer a question about typing while appearing
 *                       to answer one about movement. Bring this back when the
 *                       field exists.
 */
const TRAITS: Array<{ key: string; label: string; has(c: Card): boolean }> = [
  { key: "swarm", label: "several bodies", has: (c) => c.count > 1 },
  { key: "evolves", label: "evolves", has: (c) => evolution.chainOf(c.id).length > 1 },
  { key: "buildings", label: "ignores troops", has: (c) => !c.targets.includes("troop") },
  /*
   * Two different things, and calling them one thing was wrong.
   *
   * This was a single "arrives anywhere" trait testing `Boolean(c.delivery)`,
   * which is true for a drop as well -- and a drop does *not* arrive anywhere.
   * Only thrown and tunnelling cards ignore the halfway line; Snorlax falls
   * from the sky and still has to fall on your own half. Reported as exactly
   * that: "snorlax is not arrives anywhere".
   */
  {
    key: "anywhere",
    label: "ignores the halfway line",
    has: (c) => cards.arrivesAnywhere(c.delivery),
  },
  {
    key: "delivered",
    label: "arrives by air or underground",
    has: (c) => Boolean(c.delivery),
  },
];

/** Filters survive a reload and a paste into a chat window. */
function fromUrl(): Filters {
  // A section anchor is not a filter set. "#feedback" parses as a key with no
  // value and would otherwise be read as an empty, harmless -- but the guard
  // makes the intent explicit rather than accidental.
  const raw = location.hash.slice(1);
  const p = new URLSearchParams(raw.includes("=") ? raw : "");
  const list = (k: string) => (p.get(k) ? p.get(k)!.split(",").filter(Boolean) : []);
  return {
    ...EMPTY,
    q: p.get("q") ?? "",
    rarity: list("rarity"),
    type: list("type"),
    role: list("role"),
    cost: list("cost").map(Number).filter((n) => !Number.isNaN(n)),
    traits: list("traits"),
    typeCount: list("types").map(Number).filter((n) => !Number.isNaN(n)),
    sort: (p.get("sort") as SortKey) ?? "elixir",
    desc: p.get("desc") === "1",
  };
}

function toUrl(f: Filters) {
  const p = new URLSearchParams();
  if (f.q) p.set("q", f.q);
  for (const k of ["rarity", "type", "role", "cost", "traits"] as const) {
    if (f[k].length) p.set(k, f[k].join(","));
  }
  // "types", not "typeCount": the URL is read by people, and ?types=2 says it.
  if (f.typeCount.length) p.set("types", f.typeCount.join(","));
  if (f.sort !== "elixir") p.set("sort", f.sort);
  if (f.desc) p.set("desc", "1");
  const q = p.toString();
  // replaceState, not push: filtering is not navigation, and forty entries of
  // it would bury the way back to the guide under the browser's Back button.
  history.replaceState(null, "", q ? `#${q}` : location.pathname);
}

/** Nothing chosen: the state where the URL should say nothing either. */
const isEmpty = (f: Filters): boolean =>
  !f.q && !f.rarity.length && !f.type.length && !f.role.length
  && !f.cost.length && !f.traits.length && !f.typeCount.length
  && f.sort === "elixir" && !f.desc;

/** Every type count a card in this game actually has. */
const TYPE_COUNTS = [1, 2, 3];

const toggle = <T,>(list: T[], value: T): T[] =>
  list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

export function Browser() {
  const [f, setF] = useState<Filters>(fromUrl);
  const [open, setOpen] = useState<Card | undefined>();
  /*
   * Write the filters into the URL -- but never on the way in.
   *
   * This ran on mount too, and with nothing filtered `toUrl` writes the bare
   * path, which erased whatever fragment brought the reader here. So every
   * deep link into the guide -- the menu's "report a bug", any #towers link
   * anybody shared -- silently landed at the top of the page instead, because
   * the hash was gone before the browser could scroll to it.
   */
  const written = useRef(false);
  useEffect(() => {
    if (!written.current) {
      written.current = true;
      if (isEmpty(f)) return;
    }
    toUrl(f);
  }, [f]);

  const set = <K extends keyof Filters>(k: K, v: Filters[K]) =>
    setF((prev) => ({ ...prev, [k]: v }));

  const matched = useMemo(() => {
    const q = f.q.trim().toLowerCase();
    const list = cards.ALL.filter((c) => {
      if (q && !c.name.toLowerCase().includes(q) && !c.skill.toLowerCase().includes(q)) return false;
      if (f.rarity.length && !f.rarity.includes(c.rarity)) return false;
      if (f.role.length && !f.role.includes(c.role)) return false;
      if (f.cost.length && !f.cost.includes(c.elixir)) return false;
      // Traits are "all of": asking for a flier that evolves means both.
      if (!f.traits.every((k) => TRAITS.find((t) => t.key === k)?.has(c))) return false;
      /*
       * Types are "all of", like traits.
       *
       * It was "any of", on the reasoning that nobody means "Fire and Water".
       * That was wrong twice over: 94 of 127 Pokemon here carry more than one
       * type, so the combination is the common case rather than the rare one --
       * and a player who taps Fire and then Flying is plainly narrowing, not
       * widening. Reported as "if i chose 2 type mean i want it has both".
       */
      if (!f.type.every((t) => c.types.includes(t))) return false;
      if (f.typeCount.length && !f.typeCount.includes(c.types.length)) return false;
      return true;
    });
    const rank = (c: Card) => {
      switch (f.sort) {
        case "name": return c.name;
        case "rarity": return tiers.RARITY_RANK[c.rarity] ?? 0;
        case "dps": return dpsOf(c);
        case "hp": return bulkOf(c);
        default: return c[f.sort] as number;
      }
    };
    return list.sort((a, b) => {
      const x = rank(a), y = rank(b);
      const cmp = typeof x === "string" ? x.localeCompare(y as string) : (x as number) - (y as number);
      // Ties by name, so the grid does not reshuffle itself between renders.
      return (f.desc ? -cmp : cmp) || a.name.localeCompare(b.name);
    });
  }, [f]);

  const chips = [
    ...f.rarity.map((v) => ({ label: v, drop: () => set("rarity", toggle(f.rarity, v)) })),
    ...f.type.map((v) => ({ label: v.toLowerCase(), drop: () => set("type", toggle(f.type, v)) })),
    ...f.role.map((v) => ({ label: v, drop: () => set("role", toggle(f.role, v)) })),
    ...f.cost.map((v) => ({ label: `${v} elixir`, drop: () => set("cost", toggle(f.cost, v)) })),
    ...f.typeCount.map((v) => ({
      label: v === 1 ? "single type" : v === 2 ? "dual type" : "triple type",
      drop: () => set("typeCount", toggle(f.typeCount, v)),
    })),
    ...f.traits.map((v) => ({
      label: TRAITS.find((t) => t.key === v)?.label ?? v,
      drop: () => set("traits", toggle(f.traits, v)),
    })),
    ...(f.q ? [{ label: `“${f.q}”`, drop: () => set("q", "") }] : []),
  ];

  return (
    <section className="g-browser" id="pokemon">
      <h2>Every Pokémon</h2>
      <p className="g-lede">
        All {cards.ALL.length} deployable cards. Filters combine, so you can ask
        for something as specific as “cheap fliers that evolve”.
      </p>

      <div className="g-filters">
        <input
          className="g-search"
          type="search"
          placeholder="Search a name or a move…"
          value={f.q}
          onChange={(e) => set("q", e.target.value)}
          aria-label="Search Pokémon"
        />

        <Facet name="Cost" >
          {COSTS.map((n) => (
            <Pill key={n} on={f.cost.includes(n)} onClick={() => set("cost", toggle(f.cost, n))}>
              {n}
            </Pill>
          ))}
        </Facet>

        <Facet name="Rarity">
          {tiers.RARITY_ORDER.map((r) => (
            <Pill
              key={r}
              on={f.rarity.includes(r)}
              tint={rarityColor(r)}
              onClick={() => set("rarity", toggle(f.rarity, r))}
            >
              {r}
            </Pill>
          ))}
        </Facet>

        <Facet name="Role">
          {tiers.ROLES.map((r) => (
            <Pill key={r} on={f.role.includes(r)} onClick={() => set("role", toggle(f.role, r))}>
              {r}
            </Pill>
          ))}
        </Facet>

        <Facet name="Type">
          {ALL_TYPES.map((t) => (
            <Pill key={t} on={f.type.includes(t)} onClick={() => set("type", toggle(f.type, t))}>
              {TYPE_SHORT[t] ?? t}
            </Pill>
          ))}
        </Facet>

        {/*
          How many types, which is a question the type pills cannot answer.
          Dual and triple types take more damage from more things and resist
          more things, so "show me the pure ones" and "show me the triples" are
          real questions -- and there are only ten triples to find by hand.
        */}
        <Facet name="Types">
          {TYPE_COUNTS.map((n) => (
            <Pill
              key={n}
              on={f.typeCount.includes(n)}
              onClick={() => set("typeCount", toggle(f.typeCount, n))}
            >
              {n === 1 ? "single" : n === 2 ? "dual" : "triple"}
            </Pill>
          ))}
        </Facet>

        <Facet name="Traits">
          {TRAITS.map((t) => (
            <Pill
              key={t.key}
              on={f.traits.includes(t.key)}
              onClick={() => set("traits", toggle(f.traits, t.key))}
            >
              {t.label}
            </Pill>
          ))}
        </Facet>

        <Facet name="Sort by">
          <select
            className="g-select"
            value={f.sort}
            onChange={(e) => set("sort", e.target.value as SortKey)}
            aria-label="Sort by"
          >
            {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          <Pill on={f.desc} onClick={() => set("desc", !f.desc)}>
            {f.desc ? "high to low" : "low to high"}
          </Pill>
        </Facet>
      </div>

      <div className="g-result" role="status">
        <b>{matched.length}</b> of {cards.ALL.length}
        {chips.map((c) => (
          <button key={c.label} className="g-chip" onClick={c.drop}>
            {c.label} <span aria-hidden="true">×</span>
          </button>
        ))}
        {chips.length > 0 && (
          <button className="g-clear" onClick={() => setF({ ...EMPTY, sort: f.sort, desc: f.desc })}>
            clear all
          </button>
        )}
      </div>

      {matched.length === 0 ? (
        <p className="g-empty">
          Nothing matches all of those at once. Drop a filter above.
        </p>
      ) : (
        <div className="g-grid">
          {matched.map((c) => (
            <button key={c.id} className="g-card" onClick={() => setOpen(c)}>
              <span className="g-cost">{c.elixir}</span>
              <span className="g-art" style={portraits.styleFor(c.sheet, 56)} />
              <span className="g-name">{c.name}</span>
              <span className="g-rarity" style={{ color: hex(rarityColor(c.rarity)) }}>
                {c.rarity}
              </span>
              {c.count > 1 && <span className="g-count">×{c.count}</span>}
            </button>
          ))}
        </div>
      )}

      {open && (
        <CardDetail card={open} onClose={() => setOpen(undefined)} onOpen={setOpen} />
      )}
    </section>
  );
}

const hex = (n = 0xffffff) => `#${n.toString(16).padStart(6, "0")}`;

function Facet({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <div className="g-facet">
      <span className="g-facet-name">{name}</span>
      <div className="g-facet-pills">{children}</div>
    </div>
  );
}

function Pill(
  { on, tint, onClick, children }:
  { on: boolean; tint?: number; onClick(): void; children: React.ReactNode },
) {
  return (
    <button
      className={on ? "g-pill g-pill-on" : "g-pill"}
      aria-pressed={on}
      onClick={onClick}
      style={on && tint ? { borderColor: hex(tint), color: hex(tint) } : undefined}
    >
      {children}
    </button>
  );
}
