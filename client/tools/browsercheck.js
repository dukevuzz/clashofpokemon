/**
 * Screen-level audit, run from the browser console against a live build.
 *
 *   copy this file's contents into devtools, or let the agent inject it
 *
 * selfcheck.ts covers the rules. This covers everything the rules cannot see:
 * whether a screen actually drew the thing it is supposed to draw, whether
 * objects accumulate across scene changes, and whether playing three matches in
 * a row still works. Every bug the author has reported so far was in this
 * category -- a blank drag ghost, a missing detail panel, a branch picker that
 * silently rendered nothing -- so asserting on the *presence of features* is
 * the point, not a nicety.
 *
 * The tab is usually throttled (hidden tabs get zero animation frames), so the
 * game loop is stepped by hand rather than waited on.
 */
(async () => {
  const g = window.lr;
  const out = [];
  let failures = 0;

  const ok = (cond, label, detail = "") => {
    out.push(`${cond ? "pass" : "FAIL"}  ${label}${detail ? `  -- ${detail}` : ""}`);
    if (!cond) failures++;
  };

  let clock = performance.now();
  const step = (n = 30) => {
    for (let i = 0; i < n; i++) {
      clock += 16.7;
      g.loop.step(clock);
    }
  };
  const settle = async (key, tries = 80) => {
    for (let i = 0; i < tries; i++) {
      if (g.scene.getScene(key).scene.isActive()) return true;
      step(20);
      await new Promise((r) => setTimeout(r, 60));
    }
    return false;
  };
  const goto = async (from, to) => {
    g.scene.getScene(from).scene.start(to);
    return settle(to);
  };

  // ------------------------------------------------------------------ boot
  ok(await settle("Menu"), "menu reaches running");
  const menu = g.scene.getScene("Menu");

  const texts = (scene) =>
    scene.children.list
      .filter((o) => o.type === "Text")
      .map((o) => o.text)
      .join(" | ");

  const menuText = texts(menu);
  ok(menuText.includes("LANE ROYALE"), "menu shows a title");
  ok(/average cost/.test(menuText), "menu shows average cost");
  ok(/W\s+·/.test(menuText) || /no matches/.test(menuText), "menu shows a record");
  ok(/show opponent elixir/.test(menuText), "menu shows the elixir toggle");
  ok(
    menu.children.list.filter((o) => o.type === "Sprite").length >= 4,
    "menu deck strip shows card art",
    `${menu.children.list.filter((o) => o.type === "Sprite").length} sprites`,
  );
  ok(
    menu.children.list.filter((o) => o.input).length >= 3,
    "menu has Play, Deck and Pokedex",
  );

  // ------------------------------------------------------------------ deck
  ok(await goto("Menu", "Deck"), "deck builder opens");
  const deck = g.scene.getScene("Deck");
  ok(deck.deck.length === 6, "deck builder loads a full deck", `${deck.deck.length}`);
  ok(deck.chips.length > 10, "deck builder has role and type filters",
     `${deck.chips.length} chips`);
  ok(deck.branchChips.length >= 4, "deck builder offers eevee branches",
     `${deck.branchChips.length}`);
  ok(deck.visible().length === 22, "deck builder lists the whole roster unfiltered",
     `${deck.visible().length}`);

  // A filter must not hide a card you already picked, or you cannot remove it.
  const typeChip = deck.chips.find((c) => c.filter.kind === "type");
  deck.filter = typeChip.filter;
  deck.refresh();
  ok(deck.deck.every((c) => deck.visible().includes(c)),
     "a filter never hides a card already in the deck");
  deck.filter = { kind: "all" };
  deck.refresh();

  // Sorting must actually reorder.
  deck.sort = "name"; deck.refresh();
  const byName = deck.visible().map((c) => c.name);
  deck.sort = "cost"; deck.refresh();
  const byCost = deck.visible().map((c) => c.name);
  ok(JSON.stringify(byName) !== JSON.stringify(byCost), "sort changes the order");
  ok(byCost.length === 22, "sorting keeps every card");

  // A partial edit must survive a round trip, not reset to the starter deck.
  const kept = deck.deck.slice(0, 4).map((c) => c.id);
  localStorage.setItem("clashofpokemon.deck", JSON.stringify(kept));
  ok(await goto("Deck", "Menu"), "menu reopens");
  ok(await goto("Menu", "Deck"), "deck builder reopens");
  const after = g.scene.getScene("Deck").deck.map((c) => c.id);
  ok(kept.every((id) => after.includes(id)),
     "a partial deck edit survives, topped up rather than discarded",
     `${after.join(",")}`);

  // ------------------------------------------------------------------- dex
  ok(await goto("Deck", "Dex"), "pokedex opens");
  const dex = g.scene.getScene("Dex");
  ok(dex.all.length > 1000, "pokedex knows every species", `${dex.all.length}`);
  dex.query = "gastly";
  dex.refresh();
  step(4);
  ok(dex.shown.length === 1, "pokedex search narrows", `${dex.shown.length}`);
  ok(dex.selected && dex.selected.id === "gastly", "pokedex selects a match");

  const detailText = dex.detail.list.filter((o) => o.type === "Text").map((o) => o.text).join(" | ");
  ok(/Gastly/.test(detailText), "detail panel names the species");
  ok(/hp \d+/.test(detailText), "detail panel shows stats");
  ok(/casts every/.test(detailText), "detail panel shows cast rate");
  ok(/NIGHTMARE/.test(detailText), "detail panel shows the ability");
  ok(/\d+ \/ \d+ \/ \d+/.test(detailText), "detail panel shows per-stage figures");
  ok(/>/.test(detailText), "detail panel shows the evolution line");

  // A species with no art must not blank the panel.
  dex.query = "ditto"; dex.refresh(); step(2);
  ok(dex.detail.list.length > 3, "detail panel survives a species with no sprite");
  dex.query = ""; dex.refresh();

  // ---------------------------------------------------------------- battle
  const objectCounts = [];
  for (let match = 1; match <= 3; match++) {
    ok(await goto(match === 1 ? "Dex" : "Menu", "Battle"), `battle ${match} opens`);
    const b = g.scene.getScene("Battle");

    if (match === 1) {
      ok(b.hand.length === 4, "hand has four slots", `${b.hand.length}`);
      ok(b.towerViews.size === 6, "six towers exist", `${b.towerViews.size}`);
      ok(b.children.list.some((o) => o.type === "RenderTexture"),
         "the ground is drawn from tiles");
      const towerBody = [...b.towerViews.values()][0].body;
      ok(towerBody.type === "Image", "towers use real art", towerBody.type);

      // The drag ghost must show the creature, not a labelled box.
      const s = b.hand[0];
      b.input.emit("pointerdown", { x: s.x + 59, y: s.y + 75 });
      b.input.emit("pointermove", { x: 300, y: 640 });
      step(2);
      const parts = b.dragging.ghost.list.map((o) => o.type);
      ok(parts.includes("Sprite"), "drag ghost shows the creature", parts.join(","));
      b.input.emit("pointerup", { x: 300, y: 640 });
      step(2);
      ok(b.match.units.length > 0, "a dragged card deploys");
      ok(b.views.size === b.match.units.length, "every unit has a sprite");
    }

    // The scene must survive its own update loop. A field declared with `!`
    // and never assigned type-checks fine and crashes on frame one.
    ok(Boolean(b.deployLine), "deploy area graphics exist");
    ok(Boolean(b.rings) && Boolean(b.dropMarker), "overlay graphics exist");

    // Play it out, answering any evolution choice.
    let guard = 0;
    while (!b.match.over && guard++ < 14000) {
      clock += 16.7;
      g.loop.step(clock);
      if (b.choiceUI) {
        ok(b.choiceUI.list.length > 2, "evolution choice renders options");
        b.match.takeChoice(0);
        b.choiceUI.destroy(true);
        b.choiceUI = undefined;
      }
    }
    ok(b.match.over !== undefined, `battle ${match} finishes`, b.match.over);
    ok(b.match.projectiles.length === 0 || b.match.projectiles.length < 50,
       `battle ${match} leaves no cloud of unresolved shots`,
       `${b.match.projectiles.length}`);
    ok(b.fx.shots.size === b.match.projectiles.length,
       `battle ${match} draws exactly the live shots`,
       `${b.fx.shots.size} sprites / ${b.match.projectiles.length} shots`);
    ok(b.views.size === b.match.units.length,
       `battle ${match} leaks no unit sprites`,
       `${b.views.size} views / ${b.match.units.length} units`);
    objectCounts.push(b.children.list.length);

    step(4);
    b.input.emit("pointerdown", { x: 300, y: 500 });
    await settle("Menu");
  }

  // Objects must not climb match over match, or a long session dies slowly.
  const growth = objectCounts[2] - objectCounts[0];
  ok(Math.abs(growth) < 60, "display objects do not grow across matches",
     objectCounts.join(" -> "));

  // The record must have counted all three.
  const rec = JSON.parse(localStorage.getItem("clashofpokemon.record") || "{}");
  ok((rec.wins ?? 0) + (rec.losses ?? 0) + (rec.draws ?? 0) >= 3,
     "every finished match is recorded", JSON.stringify(rec));

  out.push("");
  out.push(`${out.filter((l) => l.startsWith("pass")).length} passed, ${failures} FAILED`);
  return out.join("\n");
})();
