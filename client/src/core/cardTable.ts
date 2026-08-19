/** Every card that can ever appear, in an order both ends agree on. */

import { ALL, byId, build, type Card } from "./cards";
import * as evolution from "./evolution";

/** Every reachable card id, sorted. Index into this is what the wire sends. */
export const CARD_TABLE: readonly string[] = (() => {
  const seen = new Set<string>();
  for (const c of ALL) {
    seen.add(c.id);
    for (const f of evolution.chainOf(c.id) ?? [c.id]) seen.add(f);
    for (const f of c.forms) seen.add(f);
  }
  // Sorted, so the order is a property of the *set* rather than of the order
  // the roster happens to be written in. Reordering roster.ts must not silently
  // renumber the wire.
  return [...seen].sort();
})();

const INDEX = new Map(CARD_TABLE.map((id, i) => [id, i]));

/** Reserved: "no card here". An empty hand slot, or no next card. */
export const NO_CARD = 0xffff;

export function cardIndex(id: string | undefined): number {
  if (!id) return NO_CARD;
  const i = INDEX.get(id);
  if (i === undefined) {
    throw new Error(`card "${id}" is not in the wire table -- regenerate it`);
  }
  return i;
}

export function cardAt(index: number): Card | undefined {
  if (index === NO_CARD) return undefined;
  const id = CARD_TABLE[index];
  if (!id) return undefined;
  return byId(id) ?? build(id);
}

/** A short fingerprint of the table. */
export const contentHash: string = (() => {
  // FNV-1a. Not cryptographic -- this detects drift, it does not defend
  // against anybody, and a 32-bit hash over 262 sorted ids is ample for that.
  let h = 0x811c9dc5;
  for (const id of CARD_TABLE) {
    for (let i = 0; i < id.length; i++) {
      h ^= id.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    h ^= 0x2c;
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
})();
