/** Every state change a match makes, named. */

import type { Side } from "./config";

/** How an action has to reach the other end of a connection. */
export type Reach = "discrete" | "continuous" | "local";

export interface Action {
  /** Dotted name: `unit.spawn`, `hand.draw`, `elixir.spend`. */
  name: string;
  reach: Reach;
  /** Whose action, where the question makes sense. */
  side?: Side;
  /** Match time when it happened, so ordering survives the report. */
  at: number;
  /** Anything worth seeing in the report. Kept small; this can fire 600×/s. */
  detail?: Record<string, string | number | boolean | undefined>;
}

export type Trace = (a: Action) => void;

/** A recorder that keeps one row per distinct action rather than every occurrence. */
export interface Row {
  name: string;
  reach: Reach;
  count: number;
  first: Action;
  last: Action;
}

export function recorder(): { trace: Trace; rows(): Row[] } {
  const seen = new Map<string, Row>();
  return {
    trace(a) {
      const row = seen.get(a.name);
      if (row) { row.count++; row.last = a; return; }
      seen.set(a.name, { name: a.name, reach: a.reach, count: 1, first: a, last: a });
    },
    rows() {
      return [...seen.values()].sort((x, y) =>
        x.reach === y.reach ? x.name.localeCompare(y.name)
          : x.reach.localeCompare(y.reach));
    },
  };
}
