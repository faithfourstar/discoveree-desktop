import { test, expect } from "@playwright/test";

/**
 * Competitors — Overview (cards ↔ table view toggle over the same data),
 * the Object page with its deep-dive Thread block, and the day-one prompt.
 */

test("overview renders competitor cards and toggles to the table view of the same rows", async ({ page }) => {
  await page.goto("/p/analytics/competitors?state=briefing");

  await expect(page.getByText("Mixpanel").first()).toBeVisible();
  await expect(page.getByText("Amplitude").first()).toBeVisible();
  await expect(page.getByText("PostHog").first()).toBeVisible();

  // View toggle: a view over the same data, not a different page (spec 2.1).
  const tableToggle = page.getByRole("button", { name: "Table" });
  const cardsToggle = page.getByRole("button", { name: "Cards" });
  await expect(cardsToggle).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("table")).toHaveCount(0);

  await tableToggle.click();
  await expect(tableToggle).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("table")).toBeVisible();
  await expect(page.locator("table").getByText("Mixpanel")).toBeVisible();

  await cardsToggle.click();
  await expect(page.locator("table")).toHaveCount(0);
});

test("the competitor object shows the profile and its deep-dive thread", async ({ page }) => {
  await page.goto("/p/analytics/competitors/mixpanel?state=briefing");

  await expect(page.getByText("Two things changed since you last looked.", { exact: false })).toBeVisible();

  // The Thread pattern: an open deep dive growing inside the column.
  await expect(page.getByText("Deep dive · open")).toBeVisible();
  await expect(
    page.getByText("Could we match warehouse-native modelling in two quarters?"),
  ).toBeVisible();
  await expect(page.getByText("File under Mixpanel")).toBeVisible();

  // Finished threads file under their object.
  await expect(page.getByText("Replay: buy, partner or ignore")).toBeVisible();
});

test("day one invites the first competitor instead of an empty list", async ({ page }) => {
  await page.goto("/p/discoveree/competitors?state=day-one");

  await expect(
    page.getByText("Who should Discoveree keep an eye on?", { exact: false }),
  ).toBeVisible();
  // Never a zero, never an empty table.
  await expect(page.locator("table")).toHaveCount(0);
});
