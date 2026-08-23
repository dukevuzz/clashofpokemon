/**
 * The guide: what the game does, in the order a new player needs it.
 *
 * Written to be read once and skimmed forever, which is why the nav is a
 * permanent rail rather than a hamburger -- somebody coming back for "how much
 * health does a tower have" should be one glance from it, not one glance from
 * the button that reveals the glance.
 *
 * Every figure comes from `facts.ts`, which reads the live config. See the note
 * there for why nothing here is typed by hand.
 */

import { useEffect, useState } from "react";
import { facts, roleStats, reach } from "./facts";
import { Browser } from "./Browser";
import { TypeChart } from "./TypeChart";
import { Feedback } from "./Feedback";

const SECTIONS = [
  { id: "basics", label: "How a match works" },
  { id: "elixir", label: "Elixir" },
  { id: "towers", label: "Towers" },
  { id: "deploying", label: "Deploying" },
  { id: "combat", label: "Combat" },
  { id: "roles", label: "Roles" },
  { id: "types", label: "Types" },
  { id: "evolution", label: "Evolution" },
  { id: "mega", label: "Mega Evolution" },
  { id: "pokemon", label: "Every Pokémon" },
  { id: "feedback", label: "Bugs & ideas" },
];

/**
 * What each role is *for*. Every line here is checked against the medians in
 * `roleStats`, which are printed beside it -- the first draft of this table
 * described a game we do not have.
 */
const ROLE_NOTES: Record<string, string> = {
  fighter: "The cheap body. Least health and least damage of anything — you play it to trade elixir, not to win a fight.",
  skirmisher: "Hits from just outside melee, which is still deep inside tower range. Wants something in front of it.",
  sniper: "The longest reach you will normally field, on ordinary health. Punishes anything that stops moving.",
  artillery: "Longest range in the game and only three cards — but still nowhere near a tower's reach, so it cannot shell one safely.",
  tank: "Both the toughest and the hardest-hitting thing on the board, for the most elixir. Slow. Your push is built around it.",
  bruiser: "The slowest thing in the game, with real damage on ordinary health. Four cards.",
  runner: "Fastest on the board and surprisingly tough, with modest damage. It is meant to reach a tower, not to beat what it meets.",
};

export function Guide() {
  const [here, setHere] = useState(SECTIONS[0].id);

  /*
   * Honour the fragment we were opened with.
   *
   * The browser tries this itself on load and fails: the page is React, so at
   * the moment it looks, `#feedback` does not exist yet. Doing it after the
   * first render is the only point at which the target is really there.
   */
  useEffect(() => {
    const jump = () => {
      const id = location.hash.slice(1);
      if (!id || !SECTIONS.some((s) => s.id === id)) return;
      // "instant" on purpose: the page sets scroll-behavior: smooth for nav
      // clicks, and inheriting it here means arriving from a link animates
      // several thousand pixels over about three seconds, past everything, as
      // though the page were scrolling away from you.
      document.getElementById(id)?.scrollIntoView({ behavior: "instant" });
    };

    jump();
    // And again when the fragment changes without a reload -- somebody pasting
    // a #towers link into the bar they are already reading the guide in. The
    // browser would normally handle that itself, but the filter sync rewrites
    // the URL underneath it and the native scroll stops being reliable.
    window.addEventListener("hashchange", jump);
    return () => window.removeEventListener("hashchange", jump);
  }, []);

  /*
   * Which section the nav should mark.
   *
   * This was "whichever is most visible", and that is quietly wrong at the
   * bottom of the page: the last section is short, the page stops scrolling
   * before it can fill the viewport, and so a taller section above it wins the
   * comparison forever. Reading the feedback form with "Every Pokémon" lit is
   * the nav telling you that you are somewhere you are not.
   *
   * So: the last section that has passed the top of the screen -- which is how
   * a reader would answer the question -- and the final section outright once
   * the page has run out of scroll, because nothing below it can ever arrive.
   */
  useEffect(() => {
    let queued = false;
    const pick = () => {
      queued = false;
      const atBottom =
        window.innerHeight + window.scrollY >= document.body.scrollHeight - 2;
      if (atBottom) {
        setHere(SECTIONS[SECTIONS.length - 1].id);
        return;
      }
      let current = SECTIONS[0].id;
      for (const s of SECTIONS) {
        const el = document.getElementById(s.id);
        if (el && el.getBoundingClientRect().top <= 120) current = s.id;
      }
      setHere(current);
    };

    // Coalesced into a frame: scroll fires far more often than the nav can
    // meaningfully change, and this runs while somebody is reading.
    const onScroll = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(pick);
    };

    pick();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  return (
    <>
      <header className="g-top">
        <a className="g-back" href="./index.html">← Back to the game</a>
        <span className="g-title">Field Guide</span>
      </header>

      <div className="g-shell">
        <nav className="g-nav" aria-label="Sections">
          {SECTIONS.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className={here === s.id ? "g-nav-on" : undefined}
              aria-current={here === s.id ? "true" : undefined}
            >
              {s.label}
            </a>
          ))}
        </nav>

        <main className="g-main">
          <section id="basics">
            <h2>How a match works</h2>
            <p className="g-lede">
              Two players, two lanes, {facts.match.length} on the clock. You spend
              elixir to put Pokémon on the board; they walk forward on their own
              and fight whatever they meet. You never control them after they land.
            </p>
            <p>
              Take their king tower at any point and you win immediately.
              Otherwise the clock decides it: whoever has taken more towers
              wins.
            </p>
            <p>
              <b>Level on towers is not a draw.</b> It goes to whoever has more
              tower health left across all three, so chip damage you never
              followed up on still wins matches. Only an exact tie draws, and
              that is rare.
            </p>
            <div className="g-grid-facts">
              <Fact k={facts.match.length} v="match length" />
              <Fact k={`${facts.deck.size} cards`} v="in a deck" />
              <Fact k={`${facts.deck.hand} cards`} v="in hand at once" />
              <Fact k={`${facts.roster.total}`} v="Pokémon to choose from" />
            </div>
          </section>

          <section id="elixir">
            <h2>Elixir</h2>
            <p>
              Elixir fills on its own — one every {facts.elixir.everySeconds} seconds,
              up to {facts.elixir.max}. Everything you play costs some, and the bar
              is the only thing standing between you and playing your whole hand.
            </p>
            <p>
              <b>For the last {facts.match.doubleFrom}</b> it fills twice as fast:
              one every {facts.elixir.everyDoubled} seconds. Pushes that were
              unaffordable all match become routine, so matches are usually decided here.
            </p>
            <p className="g-dim">
              A bar spent to zero takes {facts.elixir.refillSeconds} seconds to
              come back. That window, not the cards themselves, is what an
              opponent punishes.
            </p>
          </section>

          <section id="towers">
            <h2>Towers</h2>
            <p>
              Three each: two crown towers guarding the lanes, and the king behind
              them. They shoot anything that comes into range, once a second, and
              they do not need your attention.
            </p>
            <table className="g-table">
              <thead>
                <tr><th>Tower</th><th>Health</th><th>Damage</th><th>Range</th></tr>
              </thead>
              <tbody>
                <tr>
                  <td>Crown</td>
                  <td>{facts.towers.side.hp}</td>
                  <td>{facts.towers.side.damage}</td>
                  <td>{facts.towers.side.rangeTiles} tiles</td>
                </tr>
                <tr>
                  <td>King</td>
                  <td>{facts.towers.king.hp}</td>
                  <td>{facts.towers.king.damage}</td>
                  <td>{facts.towers.king.rangeTiles} tiles</td>
                </tr>
              </tbody>
            </table>
            <p>
              <b>The king starts asleep.</b> Two things wake it: losing one of
              the crown towers in front of it, or being hit directly. Either way
              it then takes {facts.towers.king.wakeSeconds} seconds to come
              online. Poking an enemy king awake early hands them a third
              defending tower — it is a cost, not progress.
            </p>
          </section>

          <section id="deploying">
            <h2>Deploying</h2>
            <p>
              Drag a card onto the board, or tap the card and then tap where you
              want it. You may only deploy on <b>your own half</b> — until you
              destroy a crown tower, and then that lane opens up to you as far
              forward as the tower stood.
            </p>
            <p>
              Where you drop matters more than it looks. A Pokémon placed at
              the back walks up with whatever you play behind it and arrives as
              a group under your own tower's cover; one dropped at the bridge
              arrives alone, immediately, and in range of theirs.
            </p>
            <p className="g-dim">
              Some cards arrive by other means. A thrown card and a tunnelling
              one ignore the halfway line entirely and can be placed on their
              side of the board; a dropped card falls from the sky but still
              has to fall on your own half.
            </p>
          </section>

          <section id="combat">
            <h2>Combat</h2>
            <p>
              Pokémon walk toward the nearest enemy tower and attack whatever
              they meet on the way. Almost everything will fight anything —
              unlike Clash Royale, there is no air-only or ground-only
              targeting here. A very few cards ignore creatures entirely and
              walk past them to a tower.
            </p>
            <p>
              Every attack charges a Pokémon's move. Fighting earns it; walking
              down an empty lane does not — so a creature that never meets
              anything never uses its special.
            </p>
            <p>
              Everything crosses at a bridge, so the two bridges are where
              matches are won and lost. Pokémon that hover drift over the crowd
              instead of queueing in it, and can settle on top of a tower to
              hit it — but they are shot down like anything else.
            </p>
          </section>

          <section id="roles">
            <h2>Roles</h2>
            <p>
              Every card has a role, and it is the fastest way to read one you
              have never seen. The numbers are the middle card of each role, so
              they say what is typical rather than what is possible.
            </p>
            <div className="g-scroll">
              <table className="g-table">
                <thead>
                  <tr>
                    <th>Role</th><th>Cards</th><th>Cost</th><th>Health</th>
                    <th>Dmg/sec</th><th>Speed</th><th>Range</th>
                  </tr>
                </thead>
                <tbody>
                  {roleStats.map((r) => (
                    <tr key={r.role}>
                      <td className="g-role-name">{r.role}</td>
                      <td>{r.count}</td>
                      <td>{r.elixir}</td>
                      <td>{r.hp}</td>
                      <td>{r.dps}</td>
                      <td>{r.speed}</td>
                      <td>{r.melee ? "melee" : r.range}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <dl className="g-roles">
              {roleStats.map((r) => (
                <div key={r.role}>
                  <dt>{r.role}</dt>
                  <dd>{ROLE_NOTES[r.role]}</dd>
                </div>
              ))}
            </dl>
            <p className="g-dim">
              Nothing outranges a tower. The longest reach in the game is{" "}
              {reach.best}; a crown tower answers from {reach.tower}. There is
              no safe distance from which to chip one down.
            </p>
          </section>

          <section id="types">
            <h2>Types</h2>
            <p>
              Type matchups work as they do in the games: a strong matchup does
              double damage, a weak one half, and an immunity none at all.
              Against a dual-type defender both halves multiply, so a doubly
              strong hit lands four times. An attacker with two types uses
              whichever of them does better.
            </p>
            <TypeChart />
          </section>

          <section id="evolution">
            <h2>Evolution</h2>
            <p>
              Play the same card enough times in one match and it evolves —
              free, and permanent for the rest of that match. The new form
              replaces the old one in your hand <i>and</i> in your deck, so
              every later draw is the evolved one and the base form is gone for
              good.
            </p>
            <p>
              <b>An evolved card costs more.</b> It is priced as what it now is,
              not what it started as
              {facts.evolution.example && (
                <> — {facts.evolution.example.from} at {facts.evolution.example.fromCost} becomes{" "}
                {facts.evolution.example.to} at {facts.evolution.example.toCost} after{" "}
                {facts.evolution.example.plays} plays</>
              )}. Cheap cards are worth cycling because they climb fastest, not
              because they stay cheap — plan for the bill.
            </p>
            <p>
              A few Pokémon branch, and you are asked which way to go. Others,
              like Deoxys, do not evolve at all but choose a body on the way
              down: tap the card in your hand to cycle it, then drag to play.
            </p>
            <p className="g-dim">
              Every card's chain, and how many plays it needs, is on its detail
              sheet below.
            </p>
          </section>

          <section id="mega">
            <h2>Mega Evolution</h2>
            <p>
              <b>The first slot of your deck is the Mega slot.</b> It is marked
              in the deck screen and on the menu, and you set it by dragging a
              card into first place. Only that card can Mega — the other five
              never will, whatever they are.
            </p>
            <p>
              In a match, once that card has reached its <i>final</i> form and
              is standing on the board, a stone appears beside the arena and
              fills as your elixir does. At {facts.mega.cost} elixir it lights
              up. Press it and the creature transforms where it stands, for the
              rest of its life.
            </p>
            <p>
              <b>It keeps the damage it has already taken.</b> A Mega pressed on
              a creature at half health arrives at half health — the button
              rescues a push, it does not heal one
              {facts.mega.example && (
                <> — {facts.mega.example.grown} goes from {facts.mega.example.hp} health
                to {facts.mega.example.megaHp} as {facts.mega.example.mega}</>
              )}. Across every pair it is about{" "}
              <b>×{facts.mega.gain.hp.toFixed(2)} health</b> and{" "}
              <b>×{facts.mega.gain.damage.toFixed(2)} damage</b>.
            </p>
            <p>
              Three rules decide whether the stone is lit. You need the elixir.
              The card must have reached its final form. And exactly one of it
              may be on the board — <b>put two out and the stone goes dark</b>,
              because there is no way to say which one you meant. It comes back
              when you are down to one again.
            </p>
            <p>
              One Mega per side, per match. Spend it on the wrong push and that
              is the match played without it.
            </p>
            <p className="g-dim">
              {facts.mega.capable} of the {facts.mega.roster} cards can Mega.
              Filter the collection by <i>can Mega</i> in the deck screen to see
              them. Offline only for now — the button does not appear in online
              matches.
            </p>
          </section>

          <Browser />

          <Feedback />

          <footer className="g-foot">
            <p>
              <b>Pokémon © 1995–2026 Nintendo / Creatures Inc. / GAME FREAK inc.</b>{" "}
              Pokémon and Pokémon character names are trademarks of Nintendo.
              All Pokémon names, characters, artwork and related indicia are the
              copyright and trademarks of their respective owners.
            </p>
            <p>
              <b>Creature sprites are by the artists of{" "}
              <a href="https://sprites.pmdcollab.org/" target="_blank" rel="noopener">
                PMD Sprite Collab
              </a></b>, used under{" "}
              <a
                href="https://creativecommons.org/licenses/by-nc/4.0/"
                target="_blank"
                rel="noopener"
              >
                CC BY-NC 4.0
              </a>. The individual artist for each Pokémon is credited in that
              project. The sprites are used as drawn — the only change is that
              frames were repacked into texture atlases for the browser.
              Tower art is by Foozle, released CC0.
            </p>
            <p>
              <b>Clash of Pokémon is a non-commercial fan project.</b> It is not
              affiliated with, endorsed by, or associated with Nintendo, The
              Pokémon Company, Creatures Inc. or GAME FREAK inc. No money is
              made from this game and none is asked for. It will be taken down
              on request from any rights holder.
            </p>
            <a className="g-back" href="./index.html">← Back to the game</a>
          </footer>
        </main>
      </div>
    </>
  );
}

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <div className="g-fact">
      <b>{k}</b>
      <span>{v}</span>
    </div>
  );
}
