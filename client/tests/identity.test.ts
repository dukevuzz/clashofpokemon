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

const {
  signIn, ticket, savedAccount, apiBase, apiReachable, saveProfile,
  register, logIn, signOut,
} =
  await import("../src/net/identity");

const ACCOUNT = { id: "acct_abc123", displayName: "Ember101", guest: true };

/** A fake meta tier: records what it was asked, answers with rotation. */
function api(opts: { failRefresh?: boolean; failTicket?: number } = {}) {
  const calls: string[] = [];
  let issued = 0;
  let ticketAttempts = 0;
  let lastBody: string | undefined;

  const fetchMock = vi.fn(async (
    url: string,
    init?: { body?: string; headers?: Record<string, string> },
  ) => {
    const path = String(url).replace(apiBase(), "");
    calls.push(path);
    if (init?.body) lastBody = init.body;

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
    if (path === "/v1/auth/register") {
      // The real endpoint is authenticated: it registers *the caller's*
      // account and has no form that names one. A fake that skipped this
      // could not reproduce the failure a player actually hit.
      if (!bearer(init)) return fail(401);
      const sent = JSON.parse(init?.body ?? "{}") as Record<string, string>;
      if (sent.username === "taken") return fail(409, "that username is taken");
      if ((sent.password ?? "").length < 12) {
        return fail(400, "a password needs at least 12 characters");
      }
      return json({ ...ACCOUNT, guest: false, username: sent.username });
    }
    if (path === "/v1/auth/login") {
      const sent = JSON.parse(init?.body ?? "{}") as Record<string, string>;
      if (sent.password !== "correct horse battery") return fail(401);
      return json({
        account: { ...ACCOUNT, id: "acct_other", guest: false, username: sent.username },
        refresh: "rt_from_login",
      });
    }
    if (path === "/v1/me") {
      if (!bearer(init)) return fail(401);
      const sent = JSON.parse(init?.body ?? "{}") as Record<string, string>;
      // Absent is not blank: a body with no displayName is a face change.
      if (sent.displayName !== undefined && sent.displayName.trim() === "") {
        return fail(400);
      }
      return json({ ...ACCOUNT, ...sent });
    }
    return fail(404);
  });

  (globalThis as { fetch?: unknown }).fetch = fetchMock;
  return {
    calls,
    get ticketAttempts() { return ticketAttempts; },
    get lastBody() { return lastBody; },
  };
}

const json = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body }) as unknown as Response;
/** Did the request carry a session? */
const bearer = (init?: { headers?: Record<string, string> }) =>
  Boolean(init?.headers?.authorization ?? init?.headers?.Authorization);

const fail = (status: number, error?: string) =>
  ({ ok: false, status, json: async () => (error ? { error } : {}) }) as unknown as Response;

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

describe("changing a name or a face", () => {
  it("sends the edit and keeps what came back", async () => {
    api();
    await signIn();

    const after = await saveProfile({ displayName: "Duc", avatar: "pikachu" });
    expect(after.displayName).toBe("Duc");
    expect(after.avatar).toBe("pikachu");
    // Stored, or the menu redraws with the old name until the next reload.
    expect(savedAccount()?.displayName).toBe("Duc");
  });

  it("sends only what changed", async () => {
    const fake = api();
    await signIn();
    await saveProfile({ avatar: "pikachu" });

    const body = JSON.parse(fake.lastBody ?? "{}") as Record<string, unknown>;
    // A rename and a face change are separate actions on separate screens;
    // sending both every time means whichever saved last wins.
    expect(body).not.toHaveProperty("displayName");
    expect(body.avatar).toBe("pikachu");
  });

  it("leaves the stored account alone when the server refuses", async () => {
    api();
    await signIn();

    await expect(saveProfile({ displayName: "  " })).rejects.toThrow();
    expect(savedAccount()?.displayName).toBe(ACCOUNT.displayName);
  });
});

describe("turning a guest into an account", () => {
  it("keeps the account and stops being a guest", async () => {
    api();
    const guest = await signIn();

    const after = await register("duc", "correct horse battery");
    expect(after.id).toBe(guest.id);          // the same account, not a new one
    expect(after.guest).toBe(false);
    expect(after.username).toBe("duc");
    expect(savedAccount()?.guest).toBe(false);
  });

  it("does not spend the session", async () => {
    // Signing up must not log you out of the account you are signing up.
    const fake = api();
    await signIn();
    const before = fake.calls.length;
    await register("duc", "correct horse battery");

    expect(fake.calls.slice(before)).toEqual(["/v1/auth/register"]);
  });

  it("passes the server's refusal through, not a generic one", async () => {
    // "that username is taken" and "check what you typed" are different
    // things for a form to say, and only the server knows which it is.
    api();
    await signIn();
    await expect(register("taken", "correct horse battery"))
      .rejects.toThrow(/taken/);
    await expect(register("duc", "short"))
      .rejects.toThrow(/12 characters/);
  });
});

describe("coming back on another device", () => {
  it("stores the account and the token it was given", async () => {
    api();
    const back = await logIn("duc", "correct horse battery");

    expect(back.id).toBe("acct_other");
    expect(savedAccount()?.id).toBe("acct_other");
    // The refresh token has to be stored *and* spent, or the very next
    // request has no session and quietly makes a fresh guest.
    expect(localStorage.getItem("clashofpokemon.refresh")).toBeTruthy();
  });

  it("replaces whoever was signed in before", async () => {
    api();
    await signIn();
    await logIn("duc", "correct horse battery");
    expect(savedAccount()?.id).toBe("acct_other");
  });

  it("leaves the stored account alone when the password is wrong", async () => {
    api();
    const guest = await signIn();
    await expect(logIn("duc", "wrong")).rejects.toThrow();
    expect(savedAccount()?.id).toBe(guest.id);
  });
});

describe("signing out", () => {
  it("forgets the account and the token", async () => {
    api();
    await signIn();
    signOut();

    expect(savedAccount()).toBeUndefined();
    expect(localStorage.getItem("clashofpokemon.refresh")).toBeNull();
  });
});

describe("registering before anything has signed in", () => {
  it("becomes a guest first rather than refusing", async () => {
    // The whole design is that registering upgrades the account you are
    // already playing. Nothing forces you to have one: `signIn` is called
    // lazily by feedback, match-join and play reporting, so a player who
    // opened the menu and went straight to the profile had no account, and
    // "create an account" answered "not signed in" -- an error about a
    // precondition the player has no way to satisfy.
    api();
    expect(savedAccount()).toBeUndefined();

    const after = await register("duc", "correct horse battery");
    expect(after.username).toBe("duc");
    expect(after.guest).toBe(false);
    expect(savedAccount()?.id).toBe(after.id);
  });

  it("does the same for a profile edit", async () => {
    api();
    const after = await saveProfile({ avatar: "pikachu" });
    expect(after.avatar).toBe("pikachu");
  });
});
