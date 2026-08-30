/**
 * Who the player is, as the menu needs to draw it.
 *
 * Three sources have to be reconciled into one thing: the account the API
 * knows about (a name, whether it is a guest), the record kept on this device,
 * and the face the player picked. The menu had none of it -- `savedAccount()`
 * has existed since online play shipped and no screen ever called it.
 *
 * The awkward case is that all three can be absent. A first-time player with
 * no network has no account, no record and no face, and the home screen still
 * has to say something true.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

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

const profile = await import("../src/ui/profile");
const deckStore = await import("../src/ui/deckStore");

beforeEach(() => {
  store.clear();
  vi.unstubAllGlobals();
});

/** Pretend the API told us who we are. */
function signedInAs(account: Record<string, unknown>) {
  store.setItem("clashofpokemon.account", JSON.stringify(account));
}

describe("the profile the menu draws", () => {
  it("says something true before there is anything to say", () => {
    // No account, no record, no face. This is a first launch offline, and it
    // is the state the old menu handled by showing nothing at all.
    const me = profile.current();
    expect(me.name).toBeTruthy();
    expect(me.guest).toBe(true);
    expect(me.saved).toBe(false);
    expect(me.played).toBe(0);
  });

  it("prefers the name the server gave us", () => {
    signedInAs({ id: "acct_1", displayName: "Ember101", guest: true });
    expect(profile.current().name).toBe("Ember101");
    expect(profile.current().saved).toBe(true);
  });

  it("carries the username once there is one", () => {
    signedInAs({ id: "acct_1", displayName: "Duc", guest: false, username: "duc" });
    expect(profile.current().username).toBe("duc");
    // A guest has none, and the screen keys "sign out" off exactly that.
    store.clear();
    expect(profile.current().username).toBeUndefined();
  });

  it("knows a registered account from a guest", () => {
    signedInAs({ id: "acct_1", displayName: "Duc", guest: false });
    const me = profile.current();
    expect(me.guest).toBe(false);
    // The red dot on the portrait is exactly this, and nothing else.
    expect(profile.atRisk(me)).toBe(false);
  });

  it("warns while an account exists only on this device", () => {
    signedInAs({ id: "acct_1", displayName: "Ember101", guest: true });
    expect(profile.atRisk(profile.current())).toBe(true);
  });
});

describe("the record", () => {
  it("counts what was played", () => {
    deckStore.recordResult("player");
    deckStore.recordResult("player");
    deckStore.recordResult("enemy");
    deckStore.recordResult("draw");

    const me = profile.current();
    expect(me.wins).toBe(2);
    expect(me.losses).toBe(1);
    expect(me.draws).toBe(1);
    expect(me.played).toBe(4);
  });

  it("reports a win rate as a whole percent", () => {
    deckStore.recordResult("player");
    deckStore.recordResult("enemy");
    expect(profile.current().winRate).toBe(50);
  });

  it("has no win rate before a first match rather than a nonsense one", () => {
    // wins / played is 0/0. Left unguarded this reaches the screen as NaN%.
    expect(profile.current().winRate).toBeUndefined();
  });

  it("counts a draw as played but not as won", () => {
    deckStore.recordResult("draw");
    expect(profile.current().winRate).toBe(0);
    expect(profile.current().played).toBe(1);
  });

  it("remembers the best run of wins, not just the current one", () => {
    for (const r of ["player", "player", "player", "enemy", "player"] as const) {
      deckStore.recordResult(r);
    }
    expect(profile.current().bestStreak).toBe(3);
  });

  it("a draw ends a streak, because it is not a win", () => {
    for (const r of ["player", "player", "draw", "player"] as const) {
      deckStore.recordResult(r);
    }
    expect(profile.current().bestStreak).toBe(2);
  });

  it("survives a record written before streaks existed", () => {
    // Every player on the live build has one of these.
    store.setItem("clashofpokemon.record", JSON.stringify({ wins: 9, losses: 3, draws: 0 }));
    const me = profile.current();
    expect(me.wins).toBe(9);
    expect(me.bestStreak).toBe(0);
  });
});

describe("the face", () => {
  it("falls back to the deck's Mega slot when nothing was chosen", () => {
    // A face nobody picked should still mean something: slot one is the card
    // the player deliberately put there.
    const deck = deckStore.loadDeck();
    expect(profile.faceOf(profile.current(), deck)).toBe(deck[0]?.id);
  });

  it("prefers the face that was chosen", () => {
    profile.chooseFace("pikachu");
    expect(profile.faceOf(profile.current(), deckStore.loadDeck())).toBe("pikachu");
  });

  it("can be taken off again", () => {
    profile.chooseFace("pikachu");
    profile.chooseFace(undefined);
    const deck = deckStore.loadDeck();
    expect(profile.faceOf(profile.current(), deck)).toBe(deck[0]?.id);
  });

  it("refuses a creature that is not on the roster", () => {
    // The API refuses it too. Catching it here means the picker cannot offer
    // something the save will bounce.
    expect(() => profile.chooseFace("not-a-creature")).toThrow();
  });

  it("refuses a creature that is real but cannot be chosen", () => {
    // Gengar exists and fights; it is reached by evolving, never picked. The
    // API validates against the same list, so allowing it here would produce
    // a face that saves locally and is bounced by the server.
    expect(() => profile.chooseFace("gengar")).toThrow();
  });

  it("offers every card a deck may hold, and nothing else", () => {
    const faces = profile.faces();
    expect(faces.length).toBeGreaterThan(100);
    expect(faces.some((c) => c.id === "pikachu")).toBe(true);
    // Gengar is reached by evolving, never chosen -- so it is not a face.
    expect(faces.some((c) => c.id === "gengar")).toBe(false);
  });
});

describe("leaving a device", () => {
  it("forgets the record and the face", () => {
    // The record lives on the device, not on the account -- offline matches
    // are never reported anywhere. So signing out left the previous player's
    // wins and win rate on screen for whoever picked the device up next.
    signedInAs({ id: "acct_1", displayName: "Duc", guest: false, username: "duc" });
    deckStore.recordResult("player");
    deckStore.recordResult("player");
    profile.chooseFace("pikachu");
    expect(profile.current().wins).toBe(2);

    profile.forgetLocalPlayer();

    expect(profile.current().wins).toBe(0);
    expect(profile.current().winRate).toBeUndefined();
    expect(profile.chosenFace()).toBeUndefined();
  });

  it("keeps everything when a guest registers", () => {
    // The one case that must NOT clear. Registering binds a username and a
    // password to the account already being played, so its record is the
    // whole reason for doing it that way -- a guest with two hundred matches
    // signs up and still has two hundred matches.
    deckStore.recordResult("player");
    deckStore.recordResult("player");
    profile.chooseFace("pikachu");

    profile.afterAuth("register");

    expect(profile.current().wins).toBe(2);
    expect(profile.chosenFace()).toBe("pikachu");
  });

  it("takes on the record the account arrived with, when signing in", () => {
    // The point of the whole change: a player with a history on one device
    // sees it on the next. Their own record replaces whatever the device was
    // carrying -- it is not added to it.
    deckStore.recordResult("enemy");        // somebody else's loss, on this device
    signedInAs({ id: "acct_1", displayName: "Duc", guest: false,
                 username: "duc", wins: 40, losses: 12, draws: 1 });

    profile.afterAuth("login");

    const me = profile.current();
    expect([me.wins, me.losses, me.draws]).toEqual([40, 12, 1]);
    expect(me.winRate).toBe(75);   // 40 of 53
  });

  it("wears the account's face once the device has forgotten its own", () => {
    signedInAs({ id: "acct_1", displayName: "Duc", guest: false,
                 username: "duc", avatar: "gastly" });
    profile.afterAuth("login");
    expect(profile.chosenFace()).toBeUndefined();
    expect(profile.faceOf(profile.current(), deckStore.loadDeck())).toBe("gastly");
  });

  it("clears when signing in as somebody else, or signing out", () => {
    for (const kind of ["login", "signout"] as const) {
      deckStore.recordResult("player");
      profile.chooseFace("pikachu");
      profile.afterAuth(kind);
      expect(profile.current().wins, kind).toBe(0);
      expect(profile.chosenFace(), kind).toBeUndefined();
    }
  });

  it("forgets the collection too", async () => {
    // Cards, coins and packs are progress, and progress belongs to whoever
    // earned it. Leaving them behind hands the next person on this device a
    // collection they did not open a single pack for.
    const collection = await import("../src/ui/collection");
    collection.grantPack();
    collection.addCoins(200);
    collection.openPack(() => 0.5, [(await import("../src/core/cards")).byId("pikachu")!]);
    expect(collection.owned().size).toBe(1);

    profile.forgetLocalPlayer();

    expect(collection.owned().size).toBe(0);
    expect(collection.coins()).toBe(0);
    expect(collection.packsHeld()).toBe(0);
  });

  it("leaves the deck alone", () => {
    // A deck is a thing you built, not a thing you won. Wiping it would make
    // signing out feel like a punishment.
    const before = deckStore.loadDeck().map((c) => c.id);
    profile.forgetLocalPlayer();
    expect(deckStore.loadDeck().map((c) => c.id)).toEqual(before);
  });
});
