/**
 * Signing in, and the three things kept apart.
 *
 * The distinction is the whole reason this file exists, and it is invisible in
 * the code that uses it:
 *
 *   account   printed, logged, shown to an opponent -- NOT a credential
 *   refresh   the only proof of ownership, rotated on every use
 *   access    short-lived, in memory only, never written to disk
 *
 * Rotation is the part a refactor breaks: storing the *old* token after a
 * refresh means the next sign-in presents a spent one, the server reads that as
 * theft, and the player is logged out of an account they never lost.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

/** localStorage does not exist under Node, and this module is built on it. */
class MemoryStorage {
  private map = new Map<string, string>();
  getItem(k: string) { return this.map.get(k) ?? null; }
  setItem(k: string, v: string) { this.map.set(k, String(v)); }
  removeItem(k: string) { this.map.delete(k); }
  clear() { this.map.clear(); }
}

const store = new MemoryStorage();
(globalThis as { localStorage?: MemoryStorage }).localStorage = store;
(globalThis as { window?: unknown }).window = {
  location: { protocol: "http:", hostname: "localhost" },
};

const { signIn, ticket, savedAccount, apiBase, apiReachable } =
  await import("../src/net/identity");

const ACCOUNT = { id: "acct_abc123", displayName: "Ember101", guest: true };

/** A fake meta tier: records what it was asked, answers with rotation. */
function api(opts: { failRefresh?: boolean; failTicket?: number } = {}) {
  const calls: string[] = [];
  let issued = 0;
  let ticketAttempts = 0;

  const fetchMock = vi.fn(async (url: string, init?: { body?: string }) => {
    const path = String(url).replace(apiBase(), "");
    calls.push(path);

    if (path === "/v1/auth/guest") {
      return json({ account: ACCOUNT, refresh: "rt_first" });
    }
    if (path === "/v1/auth/refresh") {
      const sent = JSON.parse(init?.body ?? "{}") as { refresh: string };
      if (opts.failRefresh) return fail(401);
      // Rotation: the token that came in is dead, and a new one goes back.
      return json({ accountId: ACCOUNT.id, access: `at_${++issued}`,
                    refresh: `rt_after_${sent.refresh}` });
    }
    if (path === "/v1/auth/ticket") {
      ticketAttempts++;
      if (opts.failTicket && ticketAttempts <= opts.failTicket) return fail(401);
      return json({ ticket: `tkt_${ticketAttempts}`, expiresIn: 60 });
    }
    if (path === "/v1/content") return json({ version: "v1" });
    return fail(404);
  });

  (globalThis as { fetch?: unknown }).fetch = fetchMock;
  return { calls, get ticketAttempts() { return ticketAttempts; } };
}

const json = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body }) as unknown as Response;
const fail = (status: number) =>
  ({ ok: false, status, json: async () => ({}) }) as unknown as Response;

beforeEach(() => store.clear());

describe("becoming somebody", () => {
  it("creates a guest when there is nothing stored", async () => {
    const server = api();
    const account = await signIn();
    expect(account.id).toBe(ACCOUNT.id);
    expect(server.calls).toContain("/v1/auth/guest");
  });

  it("remembers the account, so a reload is the same person", async () => {
    api();
    await signIn();
    expect(savedAccount()?.id).toBe(ACCOUNT.id);
  });

  it("does not create a second guest when a token is stored", async () => {
    api();
    await signIn();
    const second = api();
    await signIn();
    expect(second.calls).not.toContain("/v1/auth/guest");
    expect(second.calls).toContain("/v1/auth/refresh");
  });

  it("stores the rotated token, not the spent one", async () => {
    // The bug this guards: keeping the old token means the next sign-in
    // presents a spent one, which the server reads as theft and answers by
    // revoking the chain -- logging out an account nobody stole.
    api();
    await signIn();
    const stored = JSON.parse(localStorage.getItem("clashofpokemon.refresh")!) as string;
    expect(stored).toBe("rt_after_rt_first");
  });

  it("starts again as a new guest when the stored token is dead", async () => {
    api();
    await signIn();
    // Revoked, expired, or the account is gone. Refusing to play would be
    // worse than becoming somebody new.
    const after = api({ failRefresh: true });
    await expect(signIn()).rejects.toThrow();
    expect(after.calls).toContain("/v1/auth/refresh");
  });

  it("never writes the access token to storage", async () => {
    api();
    await signIn();
    const everything = JSON.stringify([
      localStorage.getItem("clashofpokemon.account"),
      localStorage.getItem("clashofpokemon.refresh"),
    ]);
    expect(everything).not.toContain("at_");
  });
});

describe("getting a ticket for the socket", () => {
  it("asks for one per connection", async () => {
    const server = api();
    await signIn();
    expect(await ticket()).toBe("tkt_1");
    expect(await ticket()).toBe("tkt_2");
    expect(server.ticketAttempts).toBe(2);
  });

  it("refreshes and retries once when the session has expired", async () => {
    // An access token lives fifteen minutes. A player who left the menu open
    // should not be told to reload.
    const server = api({ failTicket: 1 });
    await signIn();
    expect(await ticket()).toBe("tkt_2");
    expect(server.calls.filter((c) => c === "/v1/auth/refresh")).toHaveLength(2);
  });

  it("gives up rather than looping when there is nothing to refresh with", async () => {
    api({ failTicket: 99 });
    await expect(ticket()).rejects.toThrow();
  });
});

describe("is the meta tier even there", () => {
  it("says yes when it answers", async () => {
    api();
    expect(await apiReachable()).toBe(true);
  });

  it("says no rather than throwing when it does not", async () => {
    (globalThis as { fetch?: unknown }).fetch = vi.fn(async () => {
      throw new Error("connection refused");
    });
    expect(await apiReachable(50)).toBe(false);
  });
});
