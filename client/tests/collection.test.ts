import { describe, it, expect, beforeEach } from "vitest";

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(k: string) { return this.map.get(k) ?? null; }
  setItem(k: string, v: string) { this.map.set(k, String(v)); }
  removeItem(k: string) { this.map.delete(k); }
  clear() { this.map.clear(); }
}
const store = new MemoryStorage();
(globalThis as { localStorage?: MemoryStorage }).localStorage = store;

const collection = await import("../src/ui/collection");
const cards = await import("../src/core/cards");
const packs = await import("../src/core/packs");

beforeEach(() => store.clear());

describe("what you own", () => {
  it("starts empty, with nothing to spend", () => {
    expect(collection.owned().size).toBe(0);
    expect(collection.coins()).toBe(0);
    expect(collection.packsHeld()).toBe(0);
  });

  it("keeps what a pack gave, and pays shards for what it repeated", () => {
    const pack = [cards.byId("pikachu")!, cards.byId("squirtle")!];
    collection.grantPack();
    const first = collection.openPack(() => 0.5, pack);
    expect(first?.fresh).toHaveLength(2);
    expect(collection.owned().size).toBe(2);
    expect(collection.coins()).toBe(0);

    collection.grantPack();
    const again = collection.openPack(() => 0.5, pack);
    expect(again?.duplicates).toHaveLength(2);
    // Duplicates pay shards for the creature they repeated, not coins. Coins
    // come from matches now, so a repeat has to move you toward a specific
    // face rather than toward any chest.
    expect(collection.shardsFor("pikachu")).toBeGreaterThan(0);
    expect(collection.shardsFor("squirtle")).toBeGreaterThan(0);
    expect(collection.coins()).toBe(0);
    expect(collection.owned().size).toBe(2);
  });

  it("spends shards on a face, and refuses when it cannot afford one", () => {
    const pikachu = cards.byId("pikachu")!;
    // Two repeats of the same card: enough shards for the cheapest face.
    collection.grantPack();
    collection.openPack(() => 0.5, [pikachu]);
    for (let i = 0; i < 3; i++) {
      collection.grantPack();
      collection.openPack(() => 0.5, [pikachu]);
    }
    const purse = collection.shardsFor("pikachu");
    expect(purse).toBeGreaterThan(0);

    // Face 1 is a 100-shard emotion; face 19 is a 200 one.
    const cheap = packs.faceCost(1, false);
    const before = collection.variantsOwned().size;
    const bought = collection.buyFace("pikachu", 1, false);
    expect(bought).toBe(purse >= cheap);
    if (bought) {
      expect(collection.shardsFor("pikachu")).toBe(purse - cheap);
      expect(collection.variantsOwned().size).toBe(before + 1);
      // A second attempt must not spend again.
      expect(collection.buyFace("pikachu", 1, false)).toBe(false);
    }
  });

  it("cannot open a pack it does not have", () => {
    // The count is the permission. Without this the button is a cheat.
    expect(collection.packsHeld()).toBe(0);
    expect(collection.openPack()).toBeUndefined();
    expect(collection.owned().size).toBe(0);
  });

  it("spends a pack exactly once", () => {
    collection.grantPack();
    collection.openPack();
    expect(collection.packsHeld()).toBe(0);
  });

  it("buys a pack with coins, and refuses without enough", () => {
    collection.addCoins(collection.PACK_PRICE - 1);
    expect(collection.buyPack()).toBe(false);
    expect(collection.packsHeld()).toBe(0);

    collection.addCoins(1);
    expect(collection.buyPack()).toBe(true);
    expect(collection.packsHeld()).toBe(1);
    expect(collection.coins()).toBe(0);
  });

  it("survives a storage that cannot be read", () => {
    store.setItem("clashofpokemon.collection", "]]not json[[");
    expect(collection.owned().size).toBe(0);
    expect(collection.coins()).toBe(0);
  });

  it("counts progress against the whole roster", () => {
    collection.grantPack();
    collection.openPack(() => 0.5, [cards.byId("pikachu")!]);
    const p = collection.progress();
    expect(p.have).toBe(1);
    expect(p.total).toBe(cards.ALL.length);
  });
});

describe("shiny cards", () => {
  it("starts with none", () => {
    expect(collection.isShiny("pikachu")).toBe(false);
    expect(collection.shinyOwned().size).toBe(0);
  });

  it("loads an existing save with no shiny field at all", () => {
    // A player who saved before this feature existed has a `Stored` blob
    // with no `shiny` key in it. Reading that blob must not throw, and it
    // must not silently invent shininess nobody rolled for.
    store.setItem("clashofpokemon.collection", JSON.stringify({
      owned: ["pikachu"], coins: 10, packs: 0, since: 2,
    }));
    expect(collection.owned().has("pikachu")).toBe(true);
    expect(collection.isShiny("pikachu")).toBe(false);
    expect(collection.shinyOwned().size).toBe(0);
  });

  it("ignores a corrupted shiny field rather than failing the whole load", () => {
    store.setItem("clashofpokemon.collection", JSON.stringify({
      owned: ["pikachu"], coins: 0, packs: 0, since: 0, shiny: "not-an-array",
    }));
    expect(collection.owned().has("pikachu")).toBe(true);
    expect(collection.shinyOwned().size).toBe(0);
  });

  it("records a shiny pull as owned in both the plain sense and the shiny sense", () => {
    const shinyPikachu = { ...cards.byId("pikachu")!, shiny: true };
    collection.grantPack();
    const result = collection.openPack(() => 0.5, [shinyPikachu]);
    expect(result?.fresh).toHaveLength(1);
    expect(collection.owned().has("pikachu")).toBe(true);
    expect(collection.isShiny("pikachu")).toBe(true);
    expect(collection.shinyOwned().has("pikachu")).toBe(true);
  });

  it("treats a shiny pull as new even when the plain version is already owned", () => {
    // The bug this guards: settling by card id alone would call a shiny
    // pikachu a duplicate of a plain one already owned, and pay coins for it
    // instead of adding it to the collection.
    collection.grantPack();
    collection.openPack(() => 0.5, [cards.byId("pikachu")!]);
    expect(collection.isShiny("pikachu")).toBe(false);

    collection.grantPack();
    const shinyPikachu = { ...cards.byId("pikachu")!, shiny: true };
    const result = collection.openPack(() => 0.5, [shinyPikachu]);
    expect(result?.fresh.map((c) => c.id)).toEqual(["pikachu"]);
    expect(result?.duplicates).toHaveLength(0);
    expect(collection.isShiny("pikachu")).toBe(true);
  });

  it("pays coins, not a fresh copy, for a shiny pulled a second time", () => {
    const shinyPikachu = { ...cards.byId("pikachu")!, shiny: true };
    collection.grantPack();
    collection.openPack(() => 0.5, [shinyPikachu]);

    collection.grantPack();
    const again = collection.openPack(() => 0.5, [shinyPikachu]);
    expect(again?.duplicates).toHaveLength(1);
    expect(again?.coins).toBeGreaterThan(0);
  });
});

describe("earning from playing", () => {
  it("pays coins for a match, most for a win", () => {
    collection.reward("win");
    const afterWin = collection.coins();
    expect(afterWin).toBe(collection.COINS_PER.win);

    collection.reward("loss");
    collection.reward("draw");
    expect(collection.coins()).toBe(
      collection.COINS_PER.win + collection.COINS_PER.loss + collection.COINS_PER.draw);
  });

  it("pays something for losing", () => {
    // A losing session that earns nothing is where people stop. It has to be
    // less than a win and more than zero.
    expect(collection.COINS_PER.loss).toBeGreaterThan(0);
    expect(collection.COINS_PER.loss).toBeLessThan(collection.COINS_PER.win);
    expect(collection.COINS_PER.draw).toBeGreaterThan(collection.COINS_PER.loss);
    expect(collection.COINS_PER.draw).toBeLessThan(collection.COINS_PER.win);
  });

  it("hands over a pack every few matches, win or lose", () => {
    // The second source: a pack you are given for turning up, so progress
    // does not depend entirely on the coin balance.
    for (let i = 1; i < collection.MATCHES_PER_PACK; i++) {
      collection.reward("loss");
      expect(collection.packsHeld(), `after ${i}`).toBe(0);
    }
    collection.reward("loss");
    expect(collection.packsHeld()).toBe(1);
  });

  it("keeps counting after a free pack, rather than restarting from luck", () => {
    for (let i = 0; i < collection.MATCHES_PER_PACK * 2; i++) collection.reward("win");
    expect(collection.packsHeld()).toBe(2);
  });

  it("says what a match was worth, so the screen can show it", () => {
    const got = collection.reward("win");
    expect(got.coins).toBe(collection.COINS_PER.win);
    expect(got.pack).toBe(false);
    expect(got.toNextPack).toBe(collection.MATCHES_PER_PACK - 1);
  });

  it("is affordable: a pack should be a handful of matches, not a grind", () => {
    // The number that decides whether any of this is worth doing. Winning
    // every match, a pack should arrive in single-figure matches.
    const matches = Math.ceil(collection.PACK_PRICE / collection.COINS_PER.win);
    expect(matches).toBeLessThanOrEqual(6);
    expect(matches).toBeGreaterThanOrEqual(3);
  });
});
