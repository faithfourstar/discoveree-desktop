import { test, expect } from "@playwright/test";

/**
 * Home — the briefing (populated) and the day-one prompt. Copy is asserted
 * verbatim (curly apostrophes included) so drift from the specs is caught.
 */

test("the morning briefing renders: kicker, lede, numbered items, serving panel", async ({ page }) => {
  await page.goto("/?state=briefing");
  // The URL guard prefixes the first product.
  await expect(page).toHaveURL(/\/p\/analytics/);

  await expect(page.getByText("Your context, this morning")).toBeVisible();
  await expect(
    page.getByText("Everything is current except", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText(", last verified 19 days ago.", { exact: false }),
  ).toBeVisible();

  // Briefing items are real, evidence-cited claims.
  await expect(
    page.getByText("Mixpanel put session replay on its pricing page.", { exact: false }),
  ).toBeVisible();
  await expect(page.getByText("“Slow dashboard load” reached 41 mentions", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Explore this →" })).toBeVisible();

  // The MCP consumption panel ("Serving · Claude 118 …").
  await expect(page.getByText("Serving", { exact: true })).toBeVisible();
  await expect(page.getByText("Claude 118", { exact: false })).toBeVisible();
  await expect(page.getByText("teammates reading", { exact: false })).toBeVisible();
});

test("day one is a single prompt: one URL in, context out", async ({ page }) => {
  await page.goto("/?state=day-one");

  await expect(
    page.getByText("Give me your product’s URL and I’ll build the first draft of your context."),
  ).toBeVisible();
  await expect(page.getByLabel("Your product's URL")).toBeVisible();
  await expect(page.getByRole("button", { name: "Begin" })).toBeVisible();
  await expect(page.getByText("Step 1 of 5", { exact: false })).toBeVisible();
});
