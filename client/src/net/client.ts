/** The other end of the wire. */

import { Match, config, type Side, type Unit } from "../core";
import * as cards from "../core/cards";
import { spawn as spawnUnit } from "../core/deploy";
import { decodeSnap } from "./binary";
import {
  ACTIONS, bitsToStatus,
  type ClientMessage, type ServerMessage, type WireEvent,
} from "./protocol";

export interface NetHandlers {
  /** Plain status text, for anything that is not an event. */
  onNote?(text: string): void;
  /** A private room is open and waiting; this is its code. */
  onInvite?(code: string): void;
  /** Seat dealt. Everything visual keys off this. */
  onSeat(seat: Side, matchId: string): void;
  /** Both loaded; the match is live. */
  onStart(info: { them: { name: string; deck: string[] }; seed: number }): void;
  /** A batch of events, already turned back into core shapes. */
  onEvents(events: WireEvent[]): void;
  onOver(result: string, youWon: boolean): void;
  onReject(seq: number, code: string): void;
  onPeer(state: "connected" | "disconnected"): void;
  onError(message: string): void;
}

/** Comfortably inside the server's two-minute idle timeout. */
const HEARTBEAT_MS = 25_000;

export class NetMatch {
  /** The board, as the server last described it. */
  readonly match = new Match({ playerDeck: [], enemyDeck: [] });
  seat: Side = config.PLAYER;
  them: Side = config.ENEMY;
  matchId = "";
  /** Their display name, learned in the handshake. */
  opponent = "";
  /** Server tick of the newest snapshot applied. Late ones are dropped. */
  private lastTick = -1;
  private ws?: WebSocket;
  private seq = 0;
  private byId = new Map<number, Unit>();
  /** Round trip, in milliseconds. Measured, not assumed. */
  latency = 0;
  started = false;

  /** Where events and status text go once a scene exists to receive them. */
  private pendingEvents: WireEvent[] = [];
  private eventSink?: (events: WireEvent[]) => void;

  /** Where events go once a scene exists to receive them. */
  set onEvents(sink: ((events: WireEvent[]) => void) | undefined) {
    this.eventSink = sink;
    if (sink && this.pendingEvents.length) {
      const held = this.pendingEvents;
      this.pendingEvents = [];
      sink(held);
    }
  }
  get onEvents() { return this.eventSink; }

  onNote?: (text: string) => void;

  /**
   * The server's verdict, once a scene exists to show it.
   *
   * Set by the battle. Before this existed the only `onOver` was the empty one
   * the menu passes in, so the result message arrived on the socket and went
   * nowhere -- the board simply stopped at 0:00.
   */
  onOver?: (result: string, youWon: boolean) => void;

  /** The server gave a reason and closed us. Nothing else should speak after. */
  private refused = false;

  /** Say something periodically, so a socket that is merely waiting is not mistaken for one that has gone away. */
  private heartbeat?: ReturnType<typeof setInterval>;

  constructor(private url: string, private on: NetHandlers) {}

  connect(
    ticket: string, deck: string[], troop: string, branch?: string,
    invite?: { create: true } | { code: string },
  ) {
    const ws = new WebSocket(this.url);
    this.ws = ws;
    // Binary frames are packed snapshots; text frames are everything else.
    // The frame type carries the format, so neither end has to sniff or wrap.
    ws.binaryType = "arraybuffer";
    // The invite rides on `auth` because it is part of the same intent: a
    // player does not connect and then decide who to play against.
    ws.onopen = () => {
      this.send({ t: "auth", ticket, deck, troop, branch, invite });
      this.heartbeat = setInterval(() => this.ping(), HEARTBEAT_MS);
    };
    ws.onmessage = (ev) => {
      if (ev.data instanceof ArrayBuffer) {
        this.receive({ t: "snap", ...decodeSnap(new Uint8Array(ev.data)) });
        return;
      }
      this.receive(JSON.parse(String(ev.data)) as ServerMessage);
    };
    ws.onerror = () => { if (!this.refused) this.on.onError("connection failed"); };
    ws.onclose = () => {
      // Not `onPeer`: that means *the opponent* left, and this is our own
      // socket closing. Saying "opponent disconnected" here was wrong twice --
      // wrong subject, and it overwrote the reason the server had just given,
      // so a refused second tab reported the one thing that had not happened.
      this.stopHeartbeat();
      if (this.refused) return;
      this.on.onNote?.("disconnected");
    };
  }

  close() {
    this.stopHeartbeat();
    this.ws?.close();
  }

  private stopHeartbeat() {
    if (this.heartbeat !== undefined) clearInterval(this.heartbeat);
    this.heartbeat = undefined;
  }

  private send(m: ClientMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  /** Tell the server the art is ready. Nothing starts until both seats do. */
  ready() { this.send({ t: "loaded" }); }

  /** Play a card. */
  deploy(slot: number, x: number, y: number, form?: string): number {
    const seq = ++this.seq;
    this.send({ t: "deploy", seq, slot, x, y, form });
    return seq;
  }

  choose(choiceId: string, cardId: string): number {
    const seq = ++this.seq;
    this.send({ t: "choose", seq, choiceId, cardId });
    return seq;
  }

  leave() { this.send({ t: "leave" }); }

  ping() { this.send({ t: "ping", c: Date.now() }); }

  private receive(m: ServerMessage) {
    switch (m.t) {
      case "hello":
        this.seat = m.seat;
        this.them = m.seat === config.PLAYER ? config.ENEMY : config.PLAYER;
        this.matchId = m.matchId;
        this.opponent = m.them.name;

        // Both decks are public; only hands are hidden. They arrive here, in
        // the handshake, because the scene's `preload` decides which sprite
        // sheets to fetch by walking these -- and the server will not start the
        // match until that load reports finished. Learning the decks any later
        // is a deadlock, and it looks like creatures drawn as black squares.
        this.match.deck[this.seat] = deckOf(m.me.deck);
        this.match.deck[this.them] = deckOf(m.them.deck);
        this.match.troop[this.seat] = m.me.troop;
        this.match.troop[this.them] = m.them.troop;

        // The opponent's elixir is never sent, so the local Match's starting
        // value must not be left standing: five is a plausible number, and a
        // plausible wrong number is exactly the kind of thing that gets drawn
        // by accident and believed. Zero is visibly not an answer.
        this.match.elixir[this.them] = 0;

        this.on.onSeat(m.seat, m.matchId);
        return;

      case "invite":
        this.on.onInvite?.(m.code);
        return;

      case "start":
        this.started = true;
        this.on.onStart({ them: { name: this.opponent, deck: [] }, seed: m.seed });
        return;

      case "snap":
        if (m.tick <= this.lastTick) return;   // out of order; the newer one wins
        this.lastTick = m.tick;
        this.applySnap(m);
        return;

      case "ev":
        if (this.eventSink) this.eventSink(m.e);
        else this.pendingEvents.push(...m.e);
        return;

      case "over":
        // Both: the scene shows it, and the caller that opened the socket
        // still gets told. Only one of the two was ever wired up.
        this.onOver?.(m.result, m.youWon);
        this.on.onOver(m.result, m.youWon);
        return;

      case "reject":
        this.on.onReject(m.seq, m.code);
        return;

      case "peer":
        this.on.onPeer(m.state);
        return;

      case "pong":
        this.latency = Date.now() - m.c;
        return;

      case "error":
        // The server has told us why, and is about to hang up. Remember that,
        // so the close does not talk over the explanation.
        this.refused = true;
        this.on.onError(m.message);
        return;
    }
  }

  /** Write the server's board into the Match. */
  private applySnap(m: Extract<ServerMessage, { t: "snap" }>) {
    this.match.time = m.left;
    this.match.elixir[this.seat] = m.me.e;

    const seen = new Set<number>();
    for (const [id, x, y, hp, shield, act, facing, spawning, bits] of m.u) {
      seen.add(id);
      const u = this.byId.get(id);
      if (!u) continue;                        // its spawn event has not arrived
      u.x = x; u.y = y; u.hp = hp; u.shield = shield;
      u.action = ACTIONS[act] ?? "Idle";
      u.facing = facing;
      u.spawning = spawning;
      // Statuses are pips on screen, so only the kinds matter here. Seconds are
      // the server's business.
      // `left` is a countdown the server owns; the client only needs to know
      // a status is present, because all it does with one is draw a pip.
      u.statuses = bitsToStatus(bits).map(
        (kind) => ({ kind, left: 1 } as Unit["statuses"][number]),
      );
    }
    // Anything the server no longer lists is gone, whether it died or walked
    // off. Trusting the snapshot rather than tracking removals means there is
    // no way for the two to disagree.
    for (const id of [...this.byId.keys()]) {
      if (!seen.has(id)) this.byId.delete(id);
    }
    this.match.units = this.match.units.filter((u) => seen.has(u.id));

    for (const [id, hp, active, waking, ammo] of m.w) {
      const t = this.match.towers.find((x) => x.id === id);
      if (!t) continue;
      t.hp = hp;
      t.active = active === 1;
      t.waking = waking;
      t.ammo = ammo;
      t.dead = hp <= 0;
    }

    // Projectiles are rebuilt each snapshot: they are short-lived, there are
    // few of them, and they carry no identity worth preserving.
    this.match.projectiles = m.p.map(([x, y]) => ({
      x, y, target: this.match.towers[0], tx: x, ty: y,
      amount: 0, mult: 1, source: this.match.towers[0], speed: 0,
    }));

    for (let i = 0; i < m.me.hand.length; i++) {
      const id = m.me.hand[i];
      this.match.hand[this.seat][i] = id ? cardOf(id) : undefined as never;
    }
  }

  /** Turn a wire event back into the shape the renderer already handles. */
  rehydrate(e: WireEvent): import("../core").MatchEvent | undefined {
    const unit = (id: number) => this.byId.get(id);
    const thing = (id: number) =>
      this.byId.get(id) ?? this.match.towers.find((t) => t.id === id);

    switch (e.e) {
      case "spawn": {
        const card = cardOf(e.card);
        if (!card) return undefined;
        // Built by the same function the rules use, then corrected to the
        // server's id and position. Anything else would mean a second opinion
        // about what a unit is made of.
        const u = spawnUnit(this.match, card, e.side, e.x, e.y);
        this.match.units.pop();
        u.id = e.id;
        u.lane = e.lane as 0 | 1;
        u.arriveTime = e.arrive;
        u.spawning = e.arrive;
        this.match.units.push(u);
        this.byId.set(e.id, u);
        return { type: "spawn", unit: u };
      }
      case "ready": {
        const u = unit(e.id);
        return u ? { type: "ready", unit: u } : undefined;
      }
      case "hit": {
        const target = thing(e.id), source = thing(e.from);
        if (!target || !source) return undefined;
        return { type: "hit", target, amount: e.amount, mult: e.mult, source };
      }
      case "cast": {
        const u = unit(e.id), at = thing(e.at);
        if (!u || !at) return undefined;
        return { type: "cast", unit: u, target: at, skill: e.skill };
      }
      case "status": {
        const u = unit(e.id);
        return u
          ? { type: "status", unit: u, kind: e.kind as never, seconds: e.seconds }
          : undefined;
      }
      case "shot": {
        const from = thing(e.from), to = thing(e.to);
        if (!from || !to) return undefined;
        return { type: "shot", from, to, amount: e.amount, mult: e.mult };
      }
      case "death": {
        const t = thing(e.id);
        if (!t) return undefined;
        t.dead = true;
        return { type: "death", thing: t };
      }
      case "towerDown": {
        const t = this.match.towers.find((x) => x.id === e.id);
        return t ? { type: "towerDown", tower: t } : undefined;
      }
      case "kingWakes": {
        const t = this.match.towers.find((x) => x.id === e.id);
        return t ? { type: "kingWakes", tower: t } : undefined;
      }
      case "evolve": {
        const from = cardOf(e.from), to = cardOf(e.to);
        if (!from || !to) return undefined;
        return { type: "evolve", side: e.side, from, to };
      }
      case "choice": {
        const from = cardOf(e.from);
        const options = e.options.map(cardOf).filter(Boolean) as cards.Card[];
        if (!from || !options.length) return undefined;
        return { type: "choice", side: e.side, id: e.id, from, options };
      }
      case "over":
        return { type: "over", result: e.result };
    }
  }
}

const cardOf = (id: string) => cards.byId(id) ?? cards.build(id);
const deckOf = (ids: string[]) => ids.map(cardOf).filter(Boolean) as cards.Card[];
