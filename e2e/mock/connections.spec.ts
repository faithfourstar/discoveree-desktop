import { test, expect } from "@playwright/test";

/**
 * Connections — serving status, tool row states (connection claimed only on
 * a received query), the reader/write-attempt seat model, arrivals review
 * in the owning module, and the home Serving line as a door.
 */

test("the overview serves both transports truthfully and shows every tool row state", async ({ page }) => {
  await page.goto("/p/analytics/connections?state=briefing");

  // Serving block: both transports in user words.
  await expect(
    page.getByText("the discoveree command answers even when this app is closed", { exact: false }),
  ).toBeVisible();
  await expect(page.getByText("http://localhost:7317/mcp").first()).toBeVisible();

  // Connected row: consumption is the source of truth.
  await expect(page.getByText("118 queries this week", { exact: false })).toBeVisible();

  // Waiting row: no connection claimed from a written config.
  await expect(page.getByText("waiting for its first query")).toBeVisible();
  await expect(
    page.getByText("What do you know about my product from Discoveree?"),
  ).toBeVisible();

  // GitHub Copilot is a first-class named block.
  await expect(page.getByText("GitHub Copilot")).toBeVisible();

  // Seat model: the refusal row keeps the name, never the content.
  await expect(
    page.getByText("has tried to write", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Invite Maya to a full seat/ }),
  ).toBeVisible();

  // Checking block: the read-only contract stated verbatim.
  await expect(
    page.getByText("Nothing is ever written to them without your explicit say-so.", { exact: false }),
  ).toBeVisible();
});

test("day one centres the activation pitch with the tool rows ready", async ({ page }) => {
  await page.goto("/p/analytics/connections?state=connections-day-one");

  await expect(
    page.getByText("Everything Discoveree knows can answer questions wherever you work", { exact: false }),
  ).toBeVisible();
  // Claude first, with the automatic path one click away.
  await page.getByRole("button", { name: "Set up" }).first().click();
  await expect(
    page.getByRole("button", { name: "Set up automatically" }),
  ).toBeVisible();
});

test("port-in-use degrades honestly and the footer says not serving", async ({ page }) => {
  await page.goto("/p/analytics/connections?state=connections-degraded");

  await expect(
    page.getByText("another app is using it", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("Tools using the discoveree command aren't affected.", { exact: false }),
  ).toBeVisible();
  await expect(page.getByText("MCP · not serving")).toBeVisible();
});

test("arrived intel waits for review in the competitors module with asserted provenance", async ({ page }) => {
  await page.goto("/p/analytics/competitors?state=connections-arrivals");

  await expect(page.getByText("Waiting for your review")).toBeVisible();
  await expect(page.getByText("Competitor intel — Harvey")).toBeVisible();
  await expect(page.getByText("via Claude").first()).toBeVisible();
  await expect(
    page.getByText("Lost the Meridian renewal to Harvey", { exact: false }),
  ).toBeVisible();

  // Unknown competitor: the primary routes into the add flow, not an accept.
  await expect(
    page.getByRole("button", { name: "Research and track Harvey" }),
  ).toBeVisible();

  // Known competitor: accept merges; the card leaves the queue.
  await page.getByRole("button", { name: "Competitor intel — Mixpanel", exact: false }).click();
  await page
    .getByRole("button", { name: "Accept into Mixpanel's profile" })
    .click();
  await expect(page.getByText("Competitor intel — Mixpanel")).toHaveCount(0);
});

test("the targeted competitor object carries its own review block", async ({ page }) => {
  // Spec 4.1: the queue lives in the owning module — overview AND the
  // targeted object, never a stand-in surface.
  await page.goto("/p/analytics/competitors/mixpanel?state=connections-arrivals");

  await expect(page.getByText("Waiting for your review")).toBeVisible();
  await expect(
    page.getByText("Competitor intel — Mixpanel", { exact: false }).first(),
  ).toBeVisible();
  await expect(page.getByText("via Claude").first()).toBeVisible();
  // Harvey targets no object — it must NOT appear on Mixpanel's page.
  await expect(page.getByText("Competitor intel — Harvey")).toHaveCount(0);
});

test("saying \"I've pasted it in\" moves a row to waiting; copying alone never does", async ({ page }) => {
  await page.goto("/p/analytics/connections?state=connections-day-one");

  // Open Cursor's manual panel and copy the snippet: no state change.
  await page.getByRole("button", { name: "Set up" }).nth(1).click();
  await page.getByRole("button", { name: "Copy" }).first().click();
  await expect(page.getByText("waiting for its first query")).toHaveCount(0);

  // The user's assertion is what moves the row to waiting (spec 2.4).
  await expect(
    page.getByText("Discoveree can't read other tools' settings", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "I've pasted it in" }).click();
  await expect(page.getByText("waiting for its first query")).toBeVisible();
  await expect(
    page.getByText("What do you know about my product from Discoveree?"),
  ).toBeVisible();
});

test("the home Serving line is a door into Connections", async ({ page }) => {
  await page.goto("/p/analytics/?state=briefing");

  const claudeSegment = page.getByRole("link", { name: /Claude 118/ });
  await expect(claudeSegment).toBeVisible();
  await claudeSegment.click();
  await expect(page).toHaveURL(/\/connections#claude/);
  await expect(page.getByText("Connections · serving and checking")).toBeVisible();

  // The write-attempt fact appears as the quiet fragment, same source of truth.
  await page.goto("/p/analytics/?state=briefing");
  await expect(
    page.getByText("Maya's Claude tried to write — full seats"),
  ).toBeVisible();
});
