/** What crosses the wire, defined once for both ends. */

import type { Side } from "../core/config";

export const PROTOCOL_VERSION = 1;

/** Simulation rate. Not negotiable -- the balance numbers assume it. */
export const TICK_HZ = 30;
/** Snapshot rate. */
export const SNAP_HZ = 15;
export const TICKS_PER_SNAP = TICK_HZ / SNAP_HZ;

// ------------------------------------------------------------------ client

/** Every message a player can send. The whole vocabulary. */
export type ClientMessage =
  /** Always first. */
  | { t: "auth"; ticket: string; deck: string[]; troop?: string; branch?: string;
      invite?: { create: true } | { code: string } }
  /** Art is loaded; this seat is ready for the match to start. */
  | { t: "loaded" }
  /** Play a card. */
  | { t: "deploy"; seq: number; slot: number; x: number; y: number; form?: string }
  /** Answer a branch offer, naming the offer being answered. */
  | { t: "choose"; seq: number; choiceId: string; cardId: string }
  | { t: "leave" }
  | { t: "ping"; c: number };

// ------------------------------------------------------------------ server

/** A unit, as sampled. */
export type UnitSnap =
  [number, number, number, number, number, number, number, number, number];

/** A tower: `[id, hp, active, waking, ammo]`. */
export type TowerSnap = [number, number, number, number, number];

/** A shot in the air: `[x, y]`. It is drawn, and it is about to do damage. */
export type ShotSnap = [number, number];

/** Action codes, so the renderer's four states survive as one number. */
export const ACTIONS = ["Walk", "Idle", "Attack", "Shoot"] as const;
export type ActionCode = 0 | 1 | 2 | 3;

/** Status kinds as bits, in a fixed order both ends agree on. */
export const STATUS_BITS = [
  "paralysis", "flinch", "confusion", "armorBreak", "burn", "poison", "sleep",
] as const;

/** Events, with ids where the core has object references. */
export type WireEvent =
  | { e: "spawn"; id: number; card: string; side: Side; lane: number;
      x: number; y: number; arrive: number }
  | { e: "ready"; id: number }
  | { e: "hit"; id: number; amount: number; mult: number; from: number }
  | { e: "cast"; id: number; skill: string; at: number }
  | { e: "status"; id: number; kind: string; seconds: number }
  | { e: "shot"; from: number; to: number; amount: number; mult: number }
  | { e: "death"; id: number; tower: boolean }
  | { e: "towerDown"; id: number }
  | { e: "kingWakes"; id: number }
  | { e: "evolve"; side: Side; from: string; to: string }
  | { e: "choice"; side: Side; id: string; from: string; options: string[] }
  | { e: "over"; result: "player" | "enemy" | "draw" };

export type ServerMessage =
  /** Who you are, where you are sitting, and what both decks are. */
  | { t: "hello"; v: number; matchId: string; you: string; seat: Side;
      tick: number; snap: number;
      me: { deck: string[]; troop: string };
      them: { id: string; name: string; deck: string[]; troop: string } }
  /** The clock has started. Both seats are loaded and the board is live. */
  | { t: "start"; seed: number; startedAt: number }
  /** A private room is open and waiting for one more. */
  | { t: "invite"; code: string }
  | { t: "snap"; tick: number; left: number;
      u: UnitSnap[]; w: TowerSnap[]; p: ShotSnap[];
      me: { e: number; hand: (string | null)[]; next: string | null } }
  | { t: "ev"; tick: number; e: WireEvent[] }
  | { t: "over"; result: "player" | "enemy" | "draw"; youWon: boolean }
  /** An intent the rules refused. `seq` names which one. */
  | { t: "reject"; seq: number; code: RejectCode }
  | { t: "peer"; state: "connected" | "disconnected" }
  | { t: "pong"; c: number; tick: number }
  | { t: "error"; message: string };

export type RejectCode =
  | "elixir" | "slot" | "zone" | "stale" | "rate" | "over" | "notstarted";

/** The alphabet an invite code is drawn from. */
export const INVITE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const INVITE_LENGTH = 5;

/** Both ends encode a status set the same way, or statuses render as noise. */
export function statusBits(kinds: readonly string[]): number {
  let bits = 0;
  for (const k of kinds) {
    const i = STATUS_BITS.indexOf(k as (typeof STATUS_BITS)[number]);
    if (i >= 0) bits |= 1 << i;
  }
  return bits;
}

export function bitsToStatus(bits: number): string[] {
  return STATUS_BITS.filter((_, i) => bits & (1 << i));
}
