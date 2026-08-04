import { test, expect } from "@playwright/test";

/**
 * The ?state= demo-data latch: visible whenever active, survives in-app
 * navigation (a design review walks between pages), but never survives a
 * fresh boot without the param — and the indicator's switch control is the
 * explicit way out. (Owner-reported defect: silent, sticky demo mode.)
 */

test("the demo indicator renders while latched and survives in-app navigation", async ({ page }) => {
  await page.goto("/p/analytics/connections?state=briefing");

  await expect(page.getByText("Viewing demo data")).toBeVisible();
  await expect(page.getByText("118 queries this week", { exact: false })).toBeVisible();

  // In-app navigation drops the param; the latch (and indicator) hold.
  await page.getByRole("link", { name: "Home" }).click();
  await expect(page).not.toHaveURL(/state=/);
  await expect(page.getByText("Viewing demo data")).toBeVisible();
  await expect(page.getByText("Your context, this morning")).toBeVisible();
});

test("a fresh load without the param boots live — no latch, no demo data", async ({ page }) => {
  // Simulates the user editing the URL / reloading without ?state=.
  await page.goto("/p/analytics/connections");

  await expect(page.getByText("Viewing demo data")).toHaveCount(0);
  await expect(page.getByText("118 queries this week", { exact: false })).toHaveCount(0);
});

test("the switch control exits demo mode and lands on the workspace", async ({ page }) => {
  await page.goto("/p/analytics/competitors?state=briefing");
  await expect(page.getByText("Viewing demo data")).toBeVisible();

  await page.getByRole("button", { name: "Switch to your workspace" }).click();

  await expect(page.getByText("Viewing demo data")).toHaveCount(0);
  // Demo dataset gone with the latch.
  await expect(page.getByText("Your context, this morning")).toHaveCount(0);
});
