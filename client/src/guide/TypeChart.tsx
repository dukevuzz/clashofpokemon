/**
 * The type chart, asked one question at a time.
 *
 * A full 18x18 grid is the traditional way to present this and it is close to
 * unreadable on a phone -- 324 cells, of which a player wants exactly one row.
 * So: pick an attacking type, get its row as three plain lists. The grid is
 * complete; this is legible, and completeness nobody can read is not a feature.
 *
 * Read straight from the same chart the simulation uses, so it cannot describe
 * a matchup the game does not honour.
 */

import { useState } from "react";
import { TYPE_COLORS, TYPE_SHORT } from "../core/species";
import typeChart from "../data/typeChart.json";

interface Row { strong?: string[]; weak?: string[]; immune?: string[] }

const CHART = typeChart.chart as unknown as Record<string, Row>;
const TYPES = Object.keys(CHART).sort();

const rgb = (c?: number[]) =>
  c ? `rgb(${c.map((v) => Math.round(v * 255)).join(",")})` : "#9aa0b0";

export function TypeChart() {
  const [attacker, setAttacker] = useState(TYPES[0]);
  const row = CHART[attacker] ?? {};

  const lists: Array<[string, string[], string]> = [
    ["Double damage against", row.strong ?? [], "g-eff-good"],
    ["Half damage against", row.weak ?? [], "g-eff-bad"],
    ["No effect against", row.immune ?? [], "g-eff-none"],
  ];

  return (
    <div className="g-chart">
      <div className="g-chart-pick" role="group" aria-label="Attacking type">
        {TYPES.map((t) => (
          <button
            key={t}
            className={t === attacker ? "g-type g-type-on" : "g-type"}
            style={{ background: rgb(TYPE_COLORS[t]) }}
            aria-pressed={t === attacker}
            onClick={() => setAttacker(t)}
          >
            {TYPE_SHORT[t] ?? t}
          </button>
        ))}
      </div>

      <div className="g-chart-rows">
        {lists.map(([label, types, cls]) => (
          <div key={label} className={`g-eff ${cls}`}>
            <span className="g-eff-label">{label}</span>
            <span className="g-eff-types">
              {types.length === 0
                ? <i className="g-dim">nothing</i>
                : types.map((t) => (
                    <span key={t} className="g-type" style={{ background: rgb(TYPE_COLORS[t]) }}>
                      {TYPE_SHORT[t] ?? t}
                    </span>
                  ))}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
