/**
 * Reporting a bug, from the player's side.
 *
 * The API's own rules are tested in Java against a real database. What is
 * worth testing here is the part that would silently lose a report: whether
 * the form actually sends what the player typed, whether a refusal is shown to
 * them rather than swallowed, and whether the button can be pressed twice.
 *
 * The network is stubbed, deliberately. These tests must fail because the form
 * is wrong, never because an API container was slow.
 */

import { test, expect, type Page } from "@playwright/test";

const stub = (page: Page, handler: (route: any, request: any) => void) =>
  page.route("**/v1/feedback", handler);

/** Being signed in is not what is under test. */
async function asSomebody(page: Page) {
  await page.route("**/v1/auth/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        account: { id: "acc_1", displayName: "Tester", guest: true },
        refresh: "r1", access: "a1", ticket: "t1",
      }),
    }));
}

test.beforeEach(async ({ page }) => {
  await asSomebody(page);
  await page.goto("/guide.html#feedback");
  await expect(page.getByRole("heading", { name: "Bugs & ideas" })).toBeVisible();
});

test("sends what the player typed, with the build attached", async ({ page }) => {
  let sent: any;
  await stub(page, (route, request) => {
    sent = request.postDataJSON();
    route.fulfill({ status: 200, contentType: "application/json", body: '{"id":7}' });
  });

  await page.getByRole("button", { name: "an idea" }).click();
  await page.getByRole("textbox").fill("let me rename my deck");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.getByText("Sent. Thank you.")).toBeVisible();
  expect(sent.kind).toBe("suggestion");
  expect(sent.message).toBe("let me rename my deck");
  // Without this a report is about "the site" and cannot be tied to a build.
  expect(sent.context.build).toBeTruthy();
  expect(sent.context.screen).toMatch(/^\d+x\d+$/);
});

test("bug is the default, so the common case needs no choice", async ({ page }) => {
  let sent: any;
  await stub(page, (route, request) => {
    sent = request.postDataJSON();
    route.fulfill({ status: 200, contentType: "application/json", body: '{"id":8}' });
  });

  await page.getByRole("textbox").fill("towers stopped shooting");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Sent. Thank you.")).toBeVisible();
  expect(sent.kind).toBe("bug");
});

test("will not send something too short to act on", async ({ page }) => {
  await page.getByRole("textbox").fill("no");
  await expect(page.getByRole("button", { name: "Send" })).toBeDisabled();
});

test("shows the server's refusal instead of swallowing it", async ({ page }) => {
  await stub(page, (route) =>
    route.fulfill({
      status: 400, contentType: "application/json",
      body: JSON.stringify({ error: "say a little more than that" }),
    }));

  await page.getByRole("textbox").fill("something broke");
  await page.getByRole("button", { name: "Send" }).click();
  // The API writes these for the player. Replacing it with "400" would be worse.
  await expect(page.getByText("say a little more than that")).toBeVisible();
});

/*
 * Retry-After alone is not enough and this test proves it.
 *
 * The first version of this stubbed only the header, and the form said "60
 * minutes" for a 30 minute wait -- because a browser cannot read Retry-After
 * across origins unless the server exposes it, which ours had not. The API now
 * exposes the header *and* repeats the number in the body; the client reads
 * the body first.
 */
test("a rate limit tells the player when to come back", async ({ page }) => {
  await stub(page, (route) =>
    route.fulfill({
      status: 429, headers: { "Retry-After": "1800" },
      contentType: "application/json",
      body: JSON.stringify({ error: "slow down", retryAfterSeconds: 1800 }),
    }));

  await page.getByRole("textbox").fill("my fourth report today");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText(/try again in about 30 minutes/i)).toBeVisible();
});

test("what was typed survives a failure", async ({ page }) => {
  await stub(page, (route) => route.fulfill({ status: 500, body: "" }));

  const text = "a long report that would be infuriating to lose";
  await page.getByRole("textbox").fill(text);
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.locator(".g-error")).toBeVisible();
  // Clearing the box on failure would make the retry impossible to face.
  await expect(page.getByRole("textbox")).toHaveValue(text);
});

test("says the server is unreachable rather than \"Failed to fetch\"", async ({ page }) => {
  // What a player sees when they are offline, or when we are. A bare
  // TypeError from fetch is not an answer to somebody reporting a bug.
  await page.route("**/v1/feedback", (route) => route.abort("connectionrefused"));

  await page.getByRole("textbox").fill("the board went blank mid-match");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.locator(".g-error")).toContainText(/could not reach the server/i);
  await expect(page.locator(".g-error")).not.toContainText(/failed to fetch/i);
  await expect(page.getByRole("textbox")).toHaveValue("the board went blank mid-match");
});

test("an API without the endpoint says so, rather than showing a 404", async ({ page }) => {
  // A client is newer than the API for a moment during every deploy, and
  // permanently if one is rolled back. "could not send that (404)" is not
  // something a player can do anything with.
  await page.route("**/v1/feedback", (route) => route.fulfill({ status: 404, body: "" }));

  await page.getByRole("textbox").fill("the guide link is broken");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.locator(".g-error")).toContainText(/not switched on yet/i);
  await expect(page.locator(".g-error")).not.toContainText("404");
});

test("the menu offers somewhere to report", async ({ page }) => {
  await page.goto("/");
  const link = page.getByRole("link", { name: /report a bug/i });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute("href", /guide\.html#feedback/);
});

test("the fan-project notice is on the first screen", async ({ page }) => {
  await page.goto("/");
  const legal = page.locator(".lr-legal");
  await expect(legal).toBeVisible();
  await expect(legal).toContainText("not affiliated");
  await expect(legal).toContainText("Nintendo");
});
