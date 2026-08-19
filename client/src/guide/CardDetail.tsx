/**
 * One card, in full.
 *
 * The grid answers "which cards are like this"; this answers "what does this
 * one actually do", which is a different question and deserves the room. The
 * two numbers players ask for and no card face has space to print -- damage per
 * second, and how long this thing needs to fell a tower by itself -- are
 * computed here rather than left as an exercise.
 */

import { useEffect } from "react";
import type { Card } from "../core/cards";
import * as cards from "../core/cards";
import { config } from "../core/config";
import { rarityColor } from "../ui/theme";
import * as evolution from "../core/evolution";
import { TYPE_SHORT, TYPE_COLORS, typeMultiplier } from "../core/species";
import * as portraits from "../ui/portraits";
import { skillOf } from "../ui/skillText";
import { Showcase } from "./Showcase";
import { dpsOf, bulkOf, soloSeconds, facts } from "./facts";

const hex = (n = 0xffffff) => `#${n.toString(16).padStart(6, "0")}`;
const rgb = (c?: number[]) =>
  c ? `rgb(${c.map((v) => Math.round(v * 255)).join(",")})` : "#9aa0b0";

/*
 * The same type colour, guaranteed to be readable on the panel behind it.
 *
 * The palette is shared with the card faces, where a type sits on a bright
 * chip and a dark colour is exactly right. As small text on `--panel` some of
 * them disappear -- Dark is a muddy brown, rgb(112,87,71), on a grey-violet
 * panel, and could not be read at all.
 *
 * Measured as a real WCAG contrast ratio rather than a guess at brightness: a
 * first attempt compared raw sRGB values, which are not luminance, and let
 * Dark through unchanged because 0.357 looked like a big enough number. Lifted
 * toward white only as far as it takes to clear the threshold, so every type
 * that was already legible is left exactly as it is elsewhere in the game.
 */
const PANEL = [0x5a / 255, 0x57 / 255, 0x68 / 255];

const luminance = (c: number[]) => {
  const [r, g, b] = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const contrast = (a: number[], b: number[]) => {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

function readable(c?: number[]): string {
  if (!c) return "#9aa0b0";
  // 3.0 is the WCAG floor for large or bold text, which these three-letter
  // labels are. Going higher washes every type toward the same pale pastel.
  let out = c;
  for (let i = 0; i < 12 && contrast(out, PANEL) < 3; i++) {
    out = out.map((v) => v + (1 - v) * 0.12);
  }
  return rgb(out);
}

/**
 * One damage band: every type combination that hits for the same multiplier,
 * with a card you could actually play as the example.
 *
 * The multiplier leads, because that is the number being looked up. Sorting
 * puts 4x above 2x -- somebody checking what beats Lugia wants the answer
 * first and the runners-up after it.
 */
function MatchList(
  { title, rows, tone, onOpen }: {
    title: string;
    rows: Array<{ types: string[]; mult: number; example: Card }>;
    tone: "bad" | "good";
    onOpen(next: Card): void;
  },
) {
  if (rows.length === 0) return null;
  return (
    <div className="g-match">
      <span className="g-match-title">{title}</span>
      <div className="g-match-rows">
        {rows.map((r) => (
          <button
            key={r.types.join("/")}
            className={tone === "bad" ? "g-match-row g-match-bad" : "g-match-row g-match-good"}
            onClick={() => onOpen(r.example)}
            title={`e.g. ${r.example.name}`}
          >
            <span className="g-match-mult">
              {r.mult === 0 ? "×0" : `×${r.mult % 1 === 0 ? r.mult : r.mult.toFixed(2)}`}
            </span>
            <span className="g-match-types">
              {r.types.map((t) => (
                <span
                  key={t}
                  className="g-match-type"
                  style={{ color: readable(TYPE_COLORS[t]) }}
                >
                  {TYPE_SHORT[t] ?? t}
                </span>
              ))}
            </span>
            <span className="g-match-eg">{r.example.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

const seconds = (n: number) => (Number.isFinite(n) ? `${Math.round(n)}s` : "never");

export function CardDetail(
  { card, onClose, onOpen }:
  { card: Card; onClose(): void; onOpen(next: Card): void },
) {
  // Escape closes it. A dialog you can only leave by hunting for the × is the
  // kind of thing that gets a guide closed altogether.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const skill = skillOf(card);
  const chain = evolution.chainOf(card.id);
  const needed = evolution.playsNeeded(card);

  /*
   * What beats this, and what it beats.
   *
   * Asked for directly -- "it would be great if we can have counter element,
   * x4 or x2 on pokemon we select, like Lugia has a section of weakness" --
   * and it is the question the type chart further down the page makes you
   * answer by hand, once per type, and then combine yourself. Lugia is
   * Water/Flying/Psychic, which is three lookups and an intersection before
   * you learn the answer is "electric, and it is not close".
   *
   * Computed with `typeMultiplier`, the same function combat calls, rather
   * than from a table written out here. A guide that keeps its own copy of a
   * rule is a guide that will eventually be wrong about it.
   */
  const matchups = cards.ALL
    .filter((o) => o.id !== card.id)
    .map((o) => ({ card: o, mult: typeMultiplier(o.sheet, card.sheet) }));

  const group = (test: (m: number) => boolean) => {
    const at = matchups.filter((m) => test(m.mult));
    // One entry per type combination, cheapest example first: eight Electric
    // cards hitting for the same 4x is one fact, not eight.
    const byTypes = new Map<string, { types: string[]; mult: number; example: Card }>();
    for (const m of at.sort((a, b) => a.card.elixir - b.card.elixir)) {
      const key = [...m.card.types].sort().join("/");
      if (!byTypes.has(key)) {
        byTypes.set(key, { types: m.card.types, mult: m.mult, example: m.card });
      }
    }
    return [...byTypes.values()]
      .sort((a, b) => b.mult - a.mult || a.example.elixir - b.example.elixir);
  };

  const weakTo = group((m) => m > 1);
  const resists = group((m) => m < 1 && m > 0);
  const immune = group((m) => m === 0);

  const stats: Array<[string, string]> = [
    ["Cost", `${card.elixir} elixir`],
    ["Health", card.count > 1 ? `${card.hp} each · ${bulkOf(card)} total` : `${card.hp}`],
    ["Damage", card.count > 1 ? `${card.damage} each` : `${card.damage}`],
    ["Damage/sec", dpsOf(card).toFixed(1)],
    ["Attack rate", `${card.attackRate.toFixed(2)}/sec`],
    ["Range", card.range <= 30 ? `melee (${Math.round(card.range)})` : `${Math.round(card.range)}`],
    ["Speed", `${Math.round(card.speed)}`],
    ["Attacks", card.targets.includes("troop") ? "troops and towers" : "towers only"],
    // Not "crosses the river": riverBypass is off, so a jumper walks to the
    // bridge like everything else and the flag currently changes nothing.
    ["Moves", card.flying ? "over troops and towers" : "on the ground"],
  ];

  /*
   * What a delivery costs the other side, which the stat table never said.
   *
   * A dropped card damages whatever it lands on -- 1.6x its damage in a 36
   * unit circle, which is a tile and a half -- and that is a real part of what
   * you are buying. Snorlax's card listed its attack and never mentioned that
   * playing it is itself an attack.
   *
   * Read from config rather than written out, so a balance change moves the
   * guide with it.
   */
  if (card.delivery === "drop") {
    const { radius, damage } = config.dropImpact;
    stats.push([
      "Landing hit",
      `${Math.round(card.damage * damage)} in ${(radius / 24).toFixed(1)} tiles`,
    ]);
  }
  if (card.delivery) {
    stats.push([
      "Arrives",
      card.delivery === "drop" ? `from the sky, after ${card.deployDelay}s`
        : card.delivery === "throw" ? `thrown, after ${card.deployDelay}s — ignores the halfway line`
        : `underground, after ${card.deployDelay}s — cannot be hit on the way`,
    ]);
  }

  return (
    <div className="g-modal" onClick={onClose} role="dialog" aria-modal="true" aria-label={card.name}>
      <article className="g-sheet" onClick={(e) => e.stopPropagation()}>
        <header className="g-sheet-top">
          <span className="g-sheet-art" style={portraits.styleFor(card.sheet, 96)} />
          <div>
            <h3>{card.name}</h3>
            <p className="g-sheet-sub">
              <span style={{ color: hex(rarityColor(card.rarity)) }}>{card.rarity}</span>
              {" · "}{card.role}
              {card.count > 1 && ` · ${card.count} bodies`}
            </p>
            <p className="g-types">
              {card.types.map((t) => (
                <span key={t} className="g-type" style={{ background: rgb(TYPE_COLORS[t]) }}>
                  {TYPE_SHORT[t] ?? t}
                </span>
              ))}
            </p>
          </div>
          <button className="g-x" onClick={onClose} aria-label="Close">×</button>
        </header>

        {/*
          The card in a lane before the numbers, because it answers the first
          question a player has and the table answers the second.
        */}
        <Showcase card={card} />

        <dl className="g-stats">
          {stats.map(([k, v]) => (
            <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
          ))}
        </dl>

        {(weakTo.length > 0 || resists.length > 0 || immune.length > 0) && (
          <section className="g-block">
            <h4>Matchups</h4>
            <p className="g-dim">
              What this takes from each attacking type, and what it shrugs off.
              One row per type combination, with the cheapest card that has it.
            </p>
            <MatchList title="Weak to" rows={weakTo} tone="bad" onOpen={onOpen} />
            <MatchList title="Resists" rows={resists} tone="good" onOpen={onOpen} />
            <MatchList title="Immune to" rows={immune} tone="good" onOpen={onOpen} />
          </section>
        )}

        <section className="g-block">
          <h4>{skill.name}</h4>
          <p>{skill.summary}</p>
          <p className="g-dim">
            Charges over {skill.every} attacks. Deploying it takes{" "}
            {card.deployDelay.toFixed(1)}s before it can move or fight.
          </p>
        </section>

        <section className="g-block">
          <h4>Alone against a tower</h4>
          <p>
            Unopposed and ignoring tower fire, this takes{" "}
            <b>{seconds(soloSeconds(card, "side"))}</b> to fell a crown tower and{" "}
            <b>{seconds(soloSeconds(card, "king"))}</b> for the king.
          </p>
          <p className="g-dim">
            A crown tower deals {facts.towers.side.damage} back every second it
            is in range, so treat these as a ceiling, not a plan.
          </p>
        </section>

        {chain.length > 1 && (
          <section className="g-block">
            <h4>Evolves</h4>
            <div className="g-chain">
              {chain.map((id, i) => {
                const step = cards.byId(id) ?? cards.build(id, card);
                return (
                  <span key={id} className="g-chain-step">
                    {i > 0 && <span className="g-arrow" aria-hidden="true">→</span>}
                    <Step
                      card={step}
                      id={id}
                      here={id === card.id}
                      onOpen={onOpen}
                    />
                  </span>
                );
              })}
            </div>
            {needed !== undefined && (
              <p className="g-dim">
                Play it {needed} times to evolve. The form it becomes replaces it
                in your deck, at the cost shown under it.
              </p>
            )}
          </section>
        )}

        {card.forms.length > 0 && (
          <section className="g-block">
            <h4>Bodies</h4>
            <p>
              Tap this card in your hand to cycle which body it deploys as. The
              cost never changes.
            </p>
            <div className="g-chain">
              {card.forms.map((id) => (
                <Step
                  key={id}
                  card={cards.byId(id) ?? cards.build(id, card)}
                  id={id}
                  here={id === card.id}
                  onOpen={onOpen}
                />
              ))}
            </div>
          </section>
        )}

        {card.copies && (
          <section className="g-block">
            <h4>Copies</h4>
            <p>
              Deploys as whatever its owner played last, for one elixir more than
              that card cost.
            </p>
          </section>
        )}
      </article>
    </div>
  );
}

/**
 * One link in a chain, and a way into it.
 *
 * These were plain images at first, which is a trap: the chain is the one
 * place a player is *already* asking "what does that one do", and the answer
 * was two scrolls and a search away. A button, so it works by keyboard and
 * announces itself, and the step you are already looking at is marked and
 * inert rather than quietly doing nothing.
 */
function Step(
  { card, id, here, onOpen }:
  { card: Card | undefined; id: string; here: boolean; onOpen(next: Card): void },
) {
  const label = card?.name ?? id;
  return (
    <button
      type="button"
      className={here ? "g-chain-one g-chain-open" : "g-chain-one"}
      disabled={here || !card}
      aria-current={here ? "true" : undefined}
      /*
       * An explicit label, because the button's own text is a cost and a name
       * ("1 Charmander") and that is not what it does. It also gives the
       * current step something to say other than repeating its neighbour.
       */
      aria-label={here ? `${label} — you are here` : `See ${label}`}
      title={here ? `${label} — you are here` : `See ${label}`}
      onClick={() => card && onOpen(card)}
    >
      <span
        className={here ? "g-chain-art g-chain-here" : "g-chain-art"}
        style={portraits.styleFor(card?.sheet ?? id, 44)}
      />
      {/* The cost of each step, because it climbs -- an evolved card is priced
          as what it became. Reading that off the chain is why it is here. */}
      <span className="g-chain-cost">{card?.elixir ?? "?"}</span>
      <span className="g-chain-name">{label}</span>
    </button>
  );
}
