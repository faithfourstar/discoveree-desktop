import { test, expect } from "@playwright/test";

/**
 * Customers — the Overview's two bands (themes fast, segments slow), the
 * unfiled line, and a Theme Object's evidence list of verbatim items.
 */

test("the overview renders the themes band, the segments band and the unfiled line", async ({ page }) => {
  await page.goto("/p/analytics/customers?state=briefing");

  // Band kickers (the fast band leads, the slow band anchors).
  await expect(page.getByText("What you’re hearing")).toBeVisible();
  await expect(page.getByText("Who you serve")).toBeVisible();

  // Theme rows.
  await expect(page.getByText("Slow dashboard load").first()).toBeVisible();
  await expect(page.getByText("CSV export limits").first()).toBeVisible();

  // Segment rows.
  await expect(page.getByText("Mid-market ops teams").first()).toBeVisible();
  await expect(page.getByText("Agencies").first()).toBeVisible();

  // Unfiled items are counted honestly, never hidden.
  await expect(page.getByText("waiting for a pattern", { exact: false })).toBeVisible();

  // The log-feedback door.
  await expect(page.getByRole("button", { name: "Log a piece of feedback" })).toBeVisible();
});

test("a theme object lists its verbatim evidence with provenance", async ({ page }) => {
  await page.goto("/p/analytics/customers/themes/slow-dashboard-load?state=briefing");

  await expect(page.getByText("Slow dashboard load").first()).toBeVisible();
  // Evidence is the customer's words, kept word for word.
  await expect(
    page.getByText(
      "Dashboards take 20+ seconds on Monday mornings. The team opens spreadsheets instead.",
      { exact: false },
    ),
  ).toBeVisible();
  // Provenance sits beside the verbatim.
  await expect(page.getByText("logged by you", { exact: false }).first()).toBeVisible();
});

test("day one asks where feedback lands instead of showing empty bands", async ({ page }) => {
  await page.goto("/p/discoveree/customers?state=day-one");

  await expect(
    page.getByText("Where does customer feedback land today?", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("never guessed", { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "File it" })).toBeVisible();
});
