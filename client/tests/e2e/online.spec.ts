/**
 * Two browsers, one match.
 *
 * The protocol is already covered headlessly by the server's own selftest --
 * seats, the loading gate, refusals, disconnect, reconnect. What that cannot
 * reach is the half this file exists for: does a real Phaser client, with a
 * real asset load and a real camera, draw the match the server is running.
 *
 * Two independent browser contexts, because two tabs sharing one context share
 * local storage, and the account id lives there -- both tabs would be the same
 * guest, the second `auth` would be read as a reconnect, and the test would sit
 * forever waiting for an opponent who is itself.
 *
 * Needs the game server up:  cd ../server && npm start
 */

import { test, expect, type Page, type Browser } from "@playwright/test";

const SERVER = process.env.GAME_SERVER ?? "http://localhost:4400";

/** Skip rather than fail when the server is not running -- it is a separate process. */
async function serverUp(): Promise<boolean> {
  try {
    const res = await fetch(`${SERVER}/status`);
    return res.ok;
  } catch {
    return false;
  }
}

/** A browser with its own storage, so it is a different person. */
async function player(browser: Browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/");
  await page.waitForFunction(
    () => (window as any).lr?.scene.getScene("Menu")?.sys.settings.status === 5,
  );
  return { context, page };
}

/** Queue for a match from the menu, exactly as the button does. */
async function queue(page: Page) {
  await page.getByRole("button", { name: /PLAY ONLINE/ }).click();
}

/** Wait for the battle scene, then for the server to have started the match. */
async function inMatch(page: Page) {
  await page.waitForFunction(() => {
    const b = (window as any).lr?.scene.getScene("Battle");
    return b?.sys.settings.status === 5 && b.net;
  }, undefined, { timeout: 90_000 });
  await page.waitForFunction(() => {
    const b = (window as any).lr.scene.getScene("Battle");
    return b.net.started === true;
  }, undefined, { timeout: 90_000 });
}

const state = (page: Page) =>
  page.evaluate(() => {
    const b = (window as any).lr.scene.getScene("Battle");
    return {
      seat: b.me,
      them: b.them,
      matchId: b.net.matchId,
      left: b.match.time,
      elixir: b.match.elixir[b.me],
      units: b.match.units.map((u: any) => ({ id: u.id, side: u.side, card: u.card.id })),
      towers: b.match.towers.map((t: any) => ({ id: t.id, hp: t.hp })),
      hand: b.match.hand[b.me].map((c: any) => c?.id ?? null),
      views: b.views.size,
    };
  });

test("two browsers play the same match", async ({ browser }) => {
  test.skip(!(await serverUp()), `no game server at ${SERVER}`);
  test.setTimeout(180_000);

  const one = await player(browser);
  const two = await player(browser);

  // Both queue; the server pairs the next two.
  await queue(one.page);
  await queue(two.page);
  await inMatch(one.page);
  await inMatch(two.page);

  const a = await state(one.page);
  const b = await state(two.page);

  // Same match, different seats.
  expect(a.matchId).toBe(b.matchId);
  expect(a.seat).not.toBe(b.seat);
  expect(a.seat).toBe(b.them);

  // Each sees six towers and four cards, and the hands are their own.
  expect(a.towers).toHaveLength(6);
  expect(a.hand.filter(Boolean)).toHaveLength(4);
  expect(b.hand.filter(Boolean)).toHaveLength(4);

  // The clock is the server's, and it is running for both.
  await one.page.waitForTimeout(4000);
  const a2 = await state(one.page);
  const b2 = await state(two.page);
  expect(a2.left).toBeLessThan(a.left);
  expect(Math.abs(a2.left - b2.left)).toBeLessThan(1.5);
  expect(a2.elixir).toBeGreaterThan(1);

  // Player one plays a card into their own half. Nothing is predicted
  // locally, so a creature appearing at all means the server allowed it and
  // said so.
  const played = await one.page.evaluate(() => {
    const b = (window as any).lr.scene.getScene("Battle");
    const at = b.match.nearestDeploy(b.me, 144, 300, 144, false, false);
    b.net.deploy(0, at.x, at.y);
    return { slot0: b.match.hand[b.me][0]?.id };
  });

  await one.page.waitForFunction(
    () => (window as any).lr.scene.getScene("Battle").match.units.length > 0,
    undefined, { timeout: 15_000 },
  );
  // And the *other* browser sees it, which is the whole point.
  await two.page.waitForFunction(
    () => (window as any).lr.scene.getScene("Battle").match.units.length > 0,
    undefined, { timeout: 15_000 },
  );

  const a3 = await state(one.page);
  const b3 = await state(two.page);

  // The same creature, with the same id, on both boards.
  expect(a3.units.length).toBeGreaterThan(0);
  expect(b3.units.map((u) => u.id).sort()).toEqual(a3.units.map((u) => u.id).sort());
  expect(a3.units[0].card).toBe(played.slot0);
  // It belongs to the player who played it, on both screens. No relabelling.
  expect(a3.units[0].side).toBe(a.seat);
  expect(b3.units.find((u) => u.id === a3.units[0].id)!.side).toBe(a.seat);

  // Both renderers actually built a sprite for it.
  expect(a3.views).toBeGreaterThan(0);
  expect(b3.views).toBeGreaterThan(0);

  // The hand refilled from the deck: slot 0 is a different card now.
  expect(a3.hand[0]).not.toBe(played.slot0);

  await one.context.close();
  await two.context.close();
});

test("the opponent's hand is never sent", async ({ browser }) => {
  test.skip(!(await serverUp()), `no game server at ${SERVER}`);
  test.setTimeout(180_000);

  // The only fog in this game. Everything else on the board is public, which is
  // what lets one serialised board go to both players -- so the one hidden
  // thing is worth asserting rather than assuming.
  const one = await player(browser);
  const two = await player(browser);
  await queue(one.page);
  await queue(two.page);
  await inMatch(one.page);
  await inMatch(two.page);

  const seen = await one.page.evaluate(() => {
    const b = (window as any).lr.scene.getScene("Battle");
    return {
      mine: b.match.hand[b.me].filter(Boolean).length,
      theirs: b.match.hand[b.them].filter(Boolean).length,
      theirElixir: b.match.elixir[b.them],
    };
  });

  expect(seen.mine).toBe(4);
  // Nothing ever writes the opponent's hand or elixir on this client.
  expect(seen.theirs).toBe(0);
  expect(seen.theirElixir).toBe(0);

  await one.context.close();
  await two.context.close();
});

/**
 * A second tab is refused, and says so.
 *
 * Every tab of a browser profile shares local storage, and the guest account id
 * lives there -- so a second tab is the same person, not a second player. It is
 * also the first thing anybody does when trying the game on one machine, which
 * makes "nothing happens" the worst possible answer.
 *
 * The first tab must be the one that survives: letting a newcomer take over
 * would let a stray tab knock somebody out of a live match, and the person
 * actually playing would go quiet with no idea why.
 */
test("a second tab in the same profile is turned away", async ({ browser }) => {
  test.skip(!(await serverUp()), `no game server at ${SERVER}`);
  test.setTimeout(120_000);

  // One context, two pages: the same profile, exactly like two tabs.
  const context = await browser.newContext();
  const first = await context.newPage();
  const second = await context.newPage();
  for (const p of [first, second]) {
    await p.goto("/");
    await p.waitForFunction(
      () => (window as any).lr?.scene.getScene("Menu")?.sys.settings.status === 5,
    );
  }

  await first.getByRole("button", { name: /PLAY ONLINE/ }).click();
  await first.waitForTimeout(1200);
  await second.getByRole("button", { name: /PLAY ONLINE/ }).click();

  // The refusal is shown on screen, not just logged to a socket. Read from the
  // DOM: the menu is a document overlay *over* the canvas, and a status drawn
  // underneath by Phaser would be invisible -- which is exactly the bug that
  // made PLAY ONLINE look like it did nothing.
  await expect(second.locator("body")).toContainText(/another tab/i, { timeout: 15_000 });

  // And the first tab is untouched: still queueing, still its own session.
  await expect(first.locator("body")).not.toContainText(/another tab/i);

  await context.close();
});

/**
 * Refresh mid-match, come back, and the board is alive.
 *
 * Reported as "I click play online, it goes back to the game, but I don't see
 * pokemon spawned and running attacking any more". The cause was an ordering
 * race and not a rendering one: rejoining sends every unit on the board as a
 * spawn immediately after the handshake, while the battle scene is still
 * loading its art -- so the events describing the whole board arrived before
 * anything was listening and were dropped on the floor.
 *
 * The fix holds events until a scene claims them. This asserts the symptom the
 * player actually described: units present, and *moving*.
 */
test("a refresh mid-match rejoins a board that is still alive", async ({ browser }) => {
  test.skip(!(await serverUp()), `no game server at ${SERVER}`);
  test.setTimeout(180_000);

  const one = await player(browser);
  const two = await player(browser);
  await queue(one.page);
  await queue(two.page);
  await inMatch(one.page);
  await inMatch(two.page);

  // Get creatures onto the board from both sides.
  await one.page.waitForTimeout(7000);
  for (const p of [one.page, two.page]) {
    await p.evaluate(() => {
      const b = (window as any).lr.scene.getScene("Battle");
      const at = b.match.nearestDeploy(b.me, 120, 300, 120, false, false);
      b.net.deploy(0, at.x, at.y);
    });
  }
  await one.page.waitForFunction(
    () => (window as any).lr.scene.getScene("Battle").match.units.length >= 2,
    undefined, { timeout: 20_000 },
  );

  // F5. The match keeps running on the server -- it stops for nobody.
  await one.page.reload();
  await one.page.waitForFunction(
    () => (window as any).lr?.scene.getScene("Menu")?.sys.settings.status === 5,
  );

  // The menu must offer the way back rather than stranding the player.
  const rejoin = one.page.getByRole("button", { name: /REJOIN MATCH/ });
  await expect(rejoin).toBeVisible({ timeout: 20_000 });
  await rejoin.click();
  await inMatch(one.page);

  // The board came back populated...
  await one.page.waitForFunction(
    () => (window as any).lr.scene.getScene("Battle").match.units.length > 0,
    undefined, { timeout: 20_000 },
  );

  // ...and it is *live*: units move, and the renderer built sprites for them.
  const moved = await one.page.evaluate(async () => {
    const b = (window as any).lr.scene.getScene("Battle");
    const at = () => b.match.units.map((u: any) => `${u.id}:${u.x.toFixed(1)},${u.y.toFixed(1)}`);
    const before = at();
    const t0 = b.match.time;
    await new Promise((r) => setTimeout(r, 2500));
    return {
      before, after: at(), views: b.views.size,
      clockMoved: t0 - b.match.time,
      units: b.match.units.length,
    };
  });

  expect(moved.units).toBeGreaterThan(0);
  expect(moved.views).toBeGreaterThan(0);          // sprites really exist
  expect(moved.clockMoved).toBeGreaterThan(1.5);   // the clock is running
  expect(moved.after).not.toEqual(moved.before);   // and things are moving

  await one.context.close();
  await two.context.close();
});

/**
 * One browser is one guest, and stays that guest.
 *
 * The property a player actually cares about: come back tomorrow, be the same
 * person, without ever having made an account. It rests on one thing -- the
 * token lives in localStorage, which survives a reload, a tab close and a
 * browser restart -- and it is worth asserting because it is the thing that
 * quietly breaks when identity code gets refactored.
 *
 * Also asserted: nothing is created until it is needed. A visitor who never
 * plays online never becomes an account.
 */
test("one browser is one guest, across reloads", async ({ browser }) => {
  test.skip(!(await serverUp()), `no game server at ${SERVER}`);
  test.setTimeout(120_000);

  const context = await browser.newContext();
  const page = await context.newPage();
  const stored = () => page.evaluate(() =>
    localStorage.getItem("clashofpokemon.account"));

  await page.goto("/");
  await page.waitForFunction(
    () => (window as any).lr?.scene.getScene("Menu")?.sys.settings.status === 5);

  // Nothing yet: visiting is not signing up.
  expect(await stored()).toBeNull();

  // Queueing is what makes you somebody.
  await page.getByRole("button", { name: /PLAY ONLINE/ }).click();
  await expect.poll(stored, { timeout: 20_000 }).not.toBeNull();
  const first = JSON.parse((await stored())!) as { id: string; name: string };
  expect(first.id).toMatch(/^acct_/);

  // Reload: same person.
  await page.reload();
  await page.waitForFunction(
    () => (window as any).lr?.scene.getScene("Menu")?.sys.settings.status === 5);
  const afterReload = JSON.parse((await stored())!) as { id: string };
  expect(afterReload.id).toBe(first.id);

  // A brand new tab in the same profile: still the same person, because the
  // token belongs to the browser rather than to the page.
  const second = await context.newPage();
  await second.goto("/");
  await second.waitForFunction(
    () => (window as any).lr?.scene.getScene("Menu")?.sys.settings.status === 5);
  const fromOtherTab = await second.evaluate(() =>
    localStorage.getItem("clashofpokemon.account"));
  expect((JSON.parse(fromOtherTab!) as { id: string }).id).toBe(first.id);

  // And a different browser profile is a different person.
  const other = await browser.newContext();
  const otherPage = await other.newPage();
  await otherPage.goto("/");
  await otherPage.waitForFunction(
    () => (window as any).lr?.scene.getScene("Menu")?.sys.settings.status === 5);
  expect(await otherPage.evaluate(() =>
    localStorage.getItem("clashofpokemon.account"))).toBeNull();

  await other.close();
  await context.close();
});

/**
 * A branch offer is put to one player, not announced to both.
 *
 * Reported from a live match: player one played Eevee and *both* screens showed
 * "Choose an evolution". Two faults in one -- the opponent got a dialog for a
 * card they do not own, and they learned an evolution was happening, which is a
 * tell they had not earned.
 *
 * Driven by injecting the event rather than by playing Eevee for two minutes of
 * real elixir: what is being tested is who the renderer shows an offer to, and
 * that is answered the moment the event arrives.
 */
test("an evolution choice is shown only to the player it belongs to", async ({ browser }) => {
  test.skip(!(await serverUp()), `no game server at ${SERVER}`);
  test.setTimeout(180_000);

  const one = await player(browser);
  const two = await player(browser);
  await queue(one.page);
  await queue(two.page);
  await inMatch(one.page);
  await inMatch(two.page);

  const seatOne = await one.page.evaluate(() =>
    (window as any).lr.scene.getScene("Battle").me);

  // The same event the server would broadcast, delivered to both clients.
  for (const p of [one.page, two.page]) {
    await p.evaluate((owner) => {
      const b = (window as any).lr.scene.getScene("Battle");
      b.net.onEvents([{
        e: "choice", side: owner, id: "c1", from: "eevee",
        options: ["leafeon", "jolteon", "flareon"],
      }]);
    }, seatOne);
  }
  await one.page.waitForTimeout(600);

  const modals = async (p: typeof one.page) =>
    p.evaluate(() => document.querySelectorAll(".lr-modal").length);

  // The owner is asked...
  expect(await modals(one.page)).toBe(1);
  await expect(one.page.locator(".lr-modal")).toContainText(/choose an evolution/i);
  // ...and the opponent is told nothing at all.
  expect(await modals(two.page)).toBe(0);
  await expect(two.page.locator("body")).not.toContainText(/choose an evolution/i);

  await one.context.close();
  await two.context.close();
});

/**
 * Playing somebody you chose.
 *
 * The public queue takes the next two people, which cannot express "I want to
 * play my friend". A code can, and it needs no friends list, no invitations
 * and no presence -- it works over Discord, over a phone, and across a room.
 *
 * Two browser contexts again, because two tabs of one profile are one guest.
 */
test("two friends play through a room code", async ({ browser }) => {
  test.skip(!(await serverUp()), `no game server at ${SERVER}`);
  test.setTimeout(180_000);

  const host = await player(browser);
  const guest = await player(browser);

  await host.page.getByRole("button", { name: /^HOST$/ }).click();

  // The code is the largest thing on screen while it is up, because somebody
  // is about to read it out loud.
  const codeEl = host.page.locator(".lr-invite-code b");
  await expect(codeEl).toBeVisible({ timeout: 20_000 });
  const code = (await codeEl.textContent())!.trim();
  expect(code).toHaveLength(5);
  expect(code).toMatch(/^[A-HJ-NP-Z2-9]+$/);   // no O, I, 0 or 1

  // The friend types it in.
  await guest.page.getByPlaceholder(/enter a code/i).fill(code);
  await guest.page.getByRole("button", { name: /^JOIN$/ }).click();

  await inMatch(host.page);
  await inMatch(guest.page);

  const a = await state(host.page);
  const b = await state(guest.page);

  // Same match, opposite seats -- exactly as a public pairing produces.
  expect(a.matchId).toBe(b.matchId);
  expect(a.seat).not.toBe(b.seat);
  expect(a.towers).toHaveLength(6);

  await host.context.close();
  await guest.context.close();
});

test("a code nobody opened is refused", async ({ browser }) => {
  test.skip(!(await serverUp()), `no game server at ${SERVER}`);
  test.setTimeout(120_000);

  const lonely = await player(browser);
  await lonely.page.getByPlaceholder(/enter a code/i).fill("ZZZZZ");
  await lonely.page.getByRole("button", { name: /^JOIN$/ }).click();

  // Told, rather than left waiting for a room that does not exist.
  await expect(lonely.page.locator("body"))
    .toContainText(/no room with that code/i, { timeout: 20_000 });

  await lonely.context.close();
});

/**
 * Leaving a match hangs up.
 *
 * Diagnosed from play: "after game end, and user clicks screen to continue,
 * socket not close then play online will be blocked". Exactly right -- the
 * server refuses a second connection for one account, deliberately, so that
 * two tabs cannot share a seat. Nothing closed the socket when the battle
 * scene shut down, so a player was locked out of online play by their own
 * previous match until they reloaded the page.
 *
 * Against a real connection, because the scene's online path is driven by the
 * socket and a stub never gets as far as the code under test. What is asserted
 * is the socket itself: queueing again is a separate question, since a match
 * left running is one the server expects you to rejoin rather than replace.
 */
test("leaving a match closes its socket", async ({ browser }) => {
  test.skip(!(await serverUp()), `no game server at ${SERVER}`);
  test.setTimeout(120_000);

  const one = await player(browser);
  const two = await player(browser);
  await queue(one.page);
  await queue(two.page);
  await inMatch(one.page);
  await inMatch(two.page);

  const before = await one.page.evaluate(() => {
    const b = (window as any).lr.scene.getScene("Battle");
    return b.net?.ws?.readyState;                      // 1 = OPEN
  });
  expect(before, "connected during the match").toBe(1);

  await one.page.evaluate(() => {
    (window as any).lr.scene.getScene("Battle").scene.start("Menu");
  });
  await one.page.waitForTimeout(1000);

  const after = await one.page.evaluate(() => {
    const b = (window as any).lr.scene.getScene("Battle");
    return b.net?.ws?.readyState;                      // 2 = CLOSING, 3 = CLOSED
  });
  expect(after, "hung up on the way out").toBeGreaterThan(1);
});

/**
 * The server's verdict has to reach the player.
 *
 * Reported as three separate things -- a board frozen at 0:00, "opponent
 * disconnected" with a dead king, and "another tab" refusing the next match --
 * which all turned out to be one bug. `onOver` was set once by the menu, as an
 * empty function, and the battle never replaced it, so `{"t":"over",...}`
 * arrived on the socket and went nowhere. Without a result screen nothing left
 * the scene, so the socket was never closed, so the seat stayed held.
 *
 * Found by logging raw socket messages against production: the server had sent
 * the result every time.
 */
test("the result the server sends is the result the player sees", async ({ browser }) => {
  test.skip(!(await serverUp()), `no game server at ${SERVER}`);
  test.setTimeout(120_000);

  const one = await player(browser);
  const two = await player(browser);
  await queue(one.page);
  await queue(two.page);
  await inMatch(one.page);
  await inMatch(two.page);

  // Deliver the verdict the way the socket does, rather than waiting out a
  // three-minute clock: what is under test is the handler, not the timer.
  const shown = await one.page.evaluate(async () => {
    const b = (window as any).lr.scene.getScene("Battle");
    b.net.onOver("player", true);
    await new Promise((r) => setTimeout(r, 500));
    return {
      over: b.over,
      text: (b.children.list as any[])
        .filter((o) => typeof o.text === "string").map((o) => o.text).join(" "),
    };
  });

  expect(shown.over, "the scene knows the match ended").toBe(true);
  expect(shown.text).toMatch(/YOU WIN|YOU LOSE/);

  await one.context.close();
  await two.context.close();
});

/**
 * Every way an online match can end, ends — including "nobody won".
 *
 * Reported from play. The online client had exactly this bug for weeks: the
 * server's verdict arrived and nothing was listening, so the board stopped at
 * 0:00 with no result and no way out but a reload. That one handler is fixed;
 * these pin down the rest of the endings, including the draw, which is the one
 * with no winning side to name and therefore the easiest to get wrong.
 *
 * Both seats are checked, because the result names the winning *side* and each
 * seat has to translate it for itself -- reading it straight once told seat two
 * it had lost a match it won.
 */
test("a draw ends the match on both screens", async ({ browser }) => {
  test.skip(!(await serverUp()), `no game server at ${SERVER}`);
  test.setTimeout(120_000);

  const one = await player(browser);
  const two = await player(browser);
  await queue(one.page);
  await queue(two.page);
  await inMatch(one.page);
  await inMatch(two.page);

  // The verdict the server sends when neither side is ahead.
  for (const p of [one.page, two.page]) {
    await p.evaluate(() => (window as any).lr.scene.getScene("Battle").net.onOver("draw", false));
  }
  await one.page.waitForTimeout(600);

  for (const p of [one.page, two.page]) {
    const shown = await p.evaluate(() => {
      const b = (window as any).lr.scene.getScene("Battle");
      return { over: b.over, text: (b.children.list as any[])
        .filter((o) => typeof o.text === "string").map((o) => o.text).join(" ") };
    });
    expect(shown.over, "the scene knows it ended").toBe(true);
    expect(shown.text).toMatch(/DRAW/);
    expect(shown.text).not.toMatch(/YOU WIN|YOU LOSE/);
  }

  await one.context.close();
  await two.context.close();
});

test("one side winning is a win for them and a loss for the other", async ({ browser }) => {
  test.skip(!(await serverUp()), `no game server at ${SERVER}`);
  test.setTimeout(120_000);

  const one = await player(browser);
  const two = await player(browser);
  await queue(one.page);
  await queue(two.page);
  await inMatch(one.page);
  await inMatch(two.page);

  // The same string goes to both seats: it names the winning side, not "you".
  for (const p of [one.page, two.page]) {
    await p.evaluate(() => (window as any).lr.scene.getScene("Battle").net.onOver("player", true));
  }
  await one.page.waitForTimeout(600);

  const read = async (page: typeof one.page) => page.evaluate(() => {
    const b = (window as any).lr.scene.getScene("Battle");
    return { seat: b.me, text: (b.children.list as any[])
      .filter((o) => typeof o.text === "string").map((o) => o.text).join(" ") };
  });
  const a = await read(one.page);
  const b = await read(two.page);

  // Whoever sat in seat one won; the other lost. Never both the same.
  const winner = a.seat === 1 ? a : b;
  const loser = a.seat === 1 ? b : a;
  expect(winner.text).toMatch(/YOU WIN/);
  expect(loser.text).toMatch(/YOU LOSE/);

  await one.context.close();
  await two.context.close();
});

test("a finished online match can be left, and lets go of its socket", async ({ browser }) => {
  test.skip(!(await serverUp()), `no game server at ${SERVER}`);
  test.setTimeout(120_000);

  const one = await player(browser);
  const two = await player(browser);
  await queue(one.page);
  await queue(two.page);
  await inMatch(one.page);
  await inMatch(two.page);

  await one.page.evaluate(() =>
    (window as any).lr.scene.getScene("Battle").net.onOver("draw", false));
  await one.page.waitForTimeout(500);

  // Tap the canvas, not the window: Phaser letterboxes, so a click at a
  // made-up coordinate lands on the black bar and looks like a frozen screen.
  const canvas = (await one.page.locator("canvas").boundingBox())!;
  await one.page.mouse.click(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
  await one.page.waitForFunction(
    () => (window as any).lr?.scene.getScene("Menu")?.sys.settings.status === 5,
    undefined, { timeout: 30_000 });

  // And the socket is closed, or the next match is refused as a second tab.
  const state = await one.page.evaluate(
    () => (window as any).lr.scene.getScene("Battle").net?.ws?.readyState);
  expect(state, "hung up on the way out").toBeGreaterThan(1);

  await one.context.close();
  await two.context.close();
});
