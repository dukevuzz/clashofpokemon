/** Getting into an online match, from a cold browser. */

import type { Side } from "../core/config";
import { NetMatch } from "./client";
import { apiReachable, savedAccount, signIn, ticket } from "./identity";
import type { WireEvent } from "./protocol";


/** Where the game server is. Same host in production, a port away in dev. */
export function serverBase(): string {
  const env = (import.meta as { env?: Record<string, string> }).env;
  if (env?.VITE_GAME_SERVER) return env.VITE_GAME_SERVER;
  const { protocol, hostname } = window.location;
  return `${protocol}//${hostname}:4400`;
}

export const socketURL = (base: string) =>
  base.replace(/^http/, "ws");


/** Is there a game server to play on? */
export async function serverReachable(timeoutMs = 1500): Promise<boolean> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const res = await fetch(`${serverBase()}/status`, { signal: abort.signal });
    // Online needs *both* tiers: a game server to play on, and the meta tier
    // to prove who you are. Offering the button when only one answers is
    // offering a button that fails halfway through.
    return res.ok && await apiReachable(timeoutMs);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** A match this account is already sitting in, if any. */
export async function matchInProgress(): Promise<{ left: number } | null> {
  const account = savedAccount();
  if (!account) return null;
  try {
    const res = await fetch(
      `${serverBase()}/me/match?account=${encodeURIComponent(account.id)}`);
    if (!res.ok) return null;
    return (await res.json() as { match: null | { left: number } }).match;
  } catch {
    return null;
  }
}

export interface QueueHandlers {
  onSeat(seat: Side, net: NetMatch): void;
  /** A private room is open; this is the code to read to a friend. */
  onInvite?(code: string): void;
  onStart(them: string): void;
  onEvents(events: WireEvent[]): void;
  onOver(result: string, youWon: boolean): void;
  onNote(text: string): void;
}

/** Find a match: the next stranger, or a friend you named. */
export async function joinQueue(
  deck: string[], troop: string, branch: string | undefined,
  on: QueueHandlers,
  invite?: { create: true } | { code: string },
): Promise<NetMatch> {
  const base = serverBase();
  // Identity first, and it is somebody else's job now: the game server issues
  // nothing and is handed a signed ticket it verifies against a public key.
  on.onNote("signing in…");
  await signIn();
  const seat = await ticket();
  on.onNote("finding an opponent…");

  return new Promise<NetMatch>((resolve, reject) => {
    let settled = false;
    const net: NetMatch = new NetMatch(socketURL(base), {
      onSeat(seat, matchId) {
        (net.onNote ?? on.onNote)(`match ${matchId} — seat ${seat}`);
        on.onSeat(seat, net);
        if (!settled) { settled = true; resolve(net); }
      },
      onStart(info) { on.onStart(info.them.name); },
      onInvite(code) { on.onInvite?.(code); },
      // NetMatch holds these itself until a scene claims them, so the queue
      // handler is only a fallback for a connection with no battle behind it.
      onEvents(events) { on.onEvents(events); },
      onOver(result, youWon) { on.onOver(result, youWon); },
      onReject(seq, code) { (net.onNote ?? on.onNote)(`refused (${code})`); void seq; },
      onPeer(state) {
        const note = net.onNote ?? on.onNote;
        note(state === "disconnected" ? "opponent disconnected" : "opponent back");
      },
      onNote(text) { (net.onNote ?? on.onNote)(text); },
      onError(message) {
        (net.onNote ?? on.onNote)(message);
        if (!settled) { settled = true; reject(new Error(message)); }
      },
    });
    net.connect(seat, deck, troop, branch, invite);
  });
}
