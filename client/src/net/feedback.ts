/**
 * Sending a bug report or an idea.
 *
 * Signing in happens here rather than being demanded of the caller. A player
 * who has just watched something go wrong should type two sentences and press
 * a button; being told to make an account first is how a report becomes a
 * shrug. Everyone already has one anyway -- a guest is an account -- so this
 * costs them nothing and gives the report somewhere to hang.
 */

import { apiBase, signIn, authorized } from "./identity";

export type Kind = "bug" | "suggestion";

export interface Sent {
  id: number;
}

/** What the client knew when the report was written. */
export interface Context {
  [key: string]: string | number | boolean | undefined;
}

export class TooMuch extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super("too many reports");
  }
}

/**
 * The server answered, but does not have this.
 *
 * Which happens for exactly one honest reason: the client is newer than the
 * API. That is normal for a moment during a deploy and permanent if a deploy
 * is rolled back, and in both cases "could not send that (404)" tells the
 * player nothing they can use.
 */
export class NotYetAvailable extends Error {
  constructor() {
    super("reporting is not available yet");
  }
}

/**
 * The server could not be reached at all.
 *
 * Its own class because it is the one failure that is not the player's problem
 * and not ours either -- they are offline, or we are down -- and the form has
 * to say so plainly. A fetch that cannot connect throws a bare TypeError whose
 * message is "Failed to fetch", and showing that to somebody trying to report
 * a bug is its own small insult.
 */
export class Unreachable extends Error {
  constructor() {
    super("could not reach the server");
  }
}

/**
 * What we attach to every report without asking.
 *
 * Deliberately small and deliberately not personal: the build, the size of the
 * screen and whether it is a touch device. That is enough to reproduce most of
 * what gets reported, and none of it identifies anybody beyond the account the
 * report is already attached to.
 */
export function environment(extra: Context = {}): Context {
  return {
    build: __BUILD__,
    screen: `${window.innerWidth}x${window.innerHeight}`,
    touch: navigator.maxTouchPoints > 0,
    language: navigator.language,
    ...extra,
  };
}

export async function send(
  kind: Kind, message: string, context: Context = {},
): Promise<Sent> {
  let res: Response;
  try {
    await signIn();
    res = await authorized(`${apiBase()}/v1/feedback`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind, message, context: environment(context) }),
    });
  } catch {
    // Anything that stopped us getting an answer at all: no network, no
    // server, DNS gone. Signing in counts, because it is the first thing to
    // touch the network and the first thing to fail when there isn't any.
    throw new Unreachable();
  }

  if (!res.ok) {
    // The API writes refusals as sentences meant for the player. Use them
    // rather than replacing them with a status code.
    const body = await res.json().catch(() => undefined);

    if (res.status === 429) {
      /*
       * The body first, the header second.
       *
       * Retry-After is the standard place for this and it is *not* readable
       * across origins unless the server exposes it -- which it now does, but
       * one misconfigured deployment is all it takes for the header to go
       * silently missing and the wait to be wrong rather than absent. The body
       * travels the same path as the message beside it.
       */
      const wait = Number(body?.retryAfterSeconds ?? res.headers.get("Retry-After") ?? 0);
      throw new TooMuch(Number.isFinite(wait) && wait > 0 ? wait : 3600);
    }
    if (res.status === 404) throw new NotYetAvailable();
    throw new Error(body?.error ?? `could not send that (${res.status})`);
  }
  return res.json() as Promise<Sent>;
}
