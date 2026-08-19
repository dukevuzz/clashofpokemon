/** The snapshot, packed. */

import { cardIndex, cardAt, NO_CARD } from "../core/cardTable";
import type { ShotSnap, TowerSnap, UnitSnap } from "./protocol";

/** Binary message kinds. Only one so far, and that is the point. */
export const KIND_SNAP = 1;

/** Positions are stored in tenths of a world unit. */
const SCALE = 10;

export interface SnapData {
  tick: number;
  left: number;
  u: UnitSnap[];
  w: TowerSnap[];
  p: ShotSnap[];
  me: { e: number; hand: (string | null)[]; next: string | null };
}

const HEADER = 16;
const UNIT = 14;
const TOWER = 7;
const SHOT = 4;

/** Bytes a snapshot will occupy, so the buffer is allocated once. */
export function sizeOf(s: SnapData): number {
  return HEADER + s.u.length * UNIT + s.w.length * TOWER
    + s.p.length * SHOT + s.me.hand.length * 2;
}

export function encodeSnap(s: SnapData): Uint8Array {
  const buf = new Uint8Array(sizeOf(s));
  const v = new DataView(buf.buffer);
  let o = 0;

  v.setUint8(o, KIND_SNAP); o += 1;
  v.setUint32(o, s.tick); o += 4;
  // Seconds left, in tenths. A match is 180s, so 1800 -- nowhere near uint16.
  v.setUint16(o, Math.max(0, Math.round(s.left * 10))); o += 2;
  // Elixir in hundredths: the bar moves continuously and a tenth would step.
  v.setUint16(o, Math.max(0, Math.round(s.me.e * 100))); o += 2;
  v.setUint16(o, s.u.length); o += 2;
  v.setUint8(o, s.w.length); o += 1;
  v.setUint8(o, s.p.length); o += 1;
  v.setUint8(o, s.me.hand.length); o += 1;
  v.setUint16(o, cardIndex(s.me.next ?? undefined)); o += 2;

  for (const [id, x, y, hp, shield, act, facing, spawning, status] of s.u) {
    // Ids come from `nextId`, which only counts up. A three-minute match makes
    // a few hundred; 65,535 would need a different game. Asserted rather than
    // trusted, because the failure mode is a unit quietly becoming another one.
    if (id > 0xffff) throw new Error(`unit id ${id} does not fit uint16`);
    v.setUint16(o, id); o += 2;
    v.setInt16(o, Math.round(x * SCALE)); o += 2;
    v.setInt16(o, Math.round(y * SCALE)); o += 2;
    v.setUint16(o, Math.max(0, Math.round(hp))); o += 2;
    v.setUint16(o, Math.max(0, Math.round(shield))); o += 2;
    v.setUint8(o, act); o += 1;
    v.setUint8(o, facing); o += 1;
    // Arrival is at most a few seconds; tenths in a byte reaches 25.5.
    v.setUint8(o, Math.min(255, Math.max(0, Math.round(spawning * 10)))); o += 1;
    v.setUint8(o, status); o += 1;
  }

  for (const [id, hp, active, waking, ammo] of s.w) {
    v.setUint16(o, id); o += 2;
    v.setUint16(o, Math.max(0, Math.round(hp))); o += 2;
    v.setUint8(o, active); o += 1;
    v.setUint8(o, Math.min(255, Math.max(0, Math.round(waking * 10)))); o += 1;
    v.setUint8(o, Math.min(255, Math.max(0, ammo))); o += 1;
  }

  for (const [x, y] of s.p) {
    v.setInt16(o, Math.round(x * SCALE)); o += 2;
    v.setInt16(o, Math.round(y * SCALE)); o += 2;
  }

  for (const id of s.me.hand) {
    v.setUint16(o, cardIndex(id ?? undefined)); o += 2;
  }

  return buf;
}

export function decodeSnap(bytes: Uint8Array): SnapData {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let o = 0;

  const kind = v.getUint8(o); o += 1;
  if (kind !== KIND_SNAP) throw new Error(`unknown binary kind ${kind}`);
  const tick = v.getUint32(o); o += 4;
  const left = v.getUint16(o) / 10; o += 2;
  const elixir = v.getUint16(o) / 100; o += 2;
  const units = v.getUint16(o); o += 2;
  const towers = v.getUint8(o); o += 1;
  const shots = v.getUint8(o); o += 1;
  const handSize = v.getUint8(o); o += 1;
  const nextIdx = v.getUint16(o); o += 2;

  const u: UnitSnap[] = [];
  for (let i = 0; i < units; i++) {
    const id = v.getUint16(o); o += 2;
    const x = v.getInt16(o) / SCALE; o += 2;
    const y = v.getInt16(o) / SCALE; o += 2;
    const hp = v.getUint16(o); o += 2;
    const shield = v.getUint16(o); o += 2;
    const act = v.getUint8(o); o += 1;
    const facing = v.getUint8(o); o += 1;
    const spawning = v.getUint8(o) / 10; o += 1;
    const status = v.getUint8(o); o += 1;
    u.push([id, x, y, hp, shield, act, facing, spawning, status]);
  }

  const w: TowerSnap[] = [];
  for (let i = 0; i < towers; i++) {
    const id = v.getUint16(o); o += 2;
    const hp = v.getUint16(o); o += 2;
    const active = v.getUint8(o); o += 1;
    const waking = v.getUint8(o) / 10; o += 1;
    const ammo = v.getUint8(o); o += 1;
    w.push([id, hp, active, waking, ammo]);
  }

  const p: ShotSnap[] = [];
  for (let i = 0; i < shots; i++) {
    const x = v.getInt16(o) / SCALE; o += 2;
    const y = v.getInt16(o) / SCALE; o += 2;
    p.push([x, y]);
  }

  const hand: (string | null)[] = [];
  for (let i = 0; i < handSize; i++) {
    const idx = v.getUint16(o); o += 2;
    hand.push(idx === NO_CARD ? null : (cardAt(idx)?.id ?? null));
  }

  return {
    tick, left, u, w, p,
    me: { e: elixir, hand, next: nextIdx === NO_CARD ? null : (cardAt(nextIdx)?.id ?? null) },
  };
}
