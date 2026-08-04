import { test, expect } from "@playwright/test";

/**
 * Settings — one scannable page of blocks in fixed order, the masked-key
 * contract (the server only ever returns scheme prefix + … + last four),
 * and the honest keyless state.
 */

test("the settings blocks render in order with masked keys and schedule rows", async ({ page }) => {
  await page.goto("/p/analytics/settings?state=briefing");

  // Fixed block order, no tabs.
  await expect(page.getByText("Settings · this machine")).toBeVisible();
  await expect(page.getByText("LLM keys", { exact: true })).toBeVisible();
  await expect(page.getByText("Agent schedules", { exact: true })).toBeVisible();
  await expect(page.getByText("Licence", { exact: true })).toBeVisible();
  await expect(page.getByText("About & your data")).toBeVisible();

  // Key-block copy: the one-key-is-enough framing and the trust line.
  await expect(
    page.getByText("One key from any provider is enough.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("Keys are encrypted and stored only on this machine", { exact: false }),
  ).toBeVisible();

  // Masked keys — never the raw key, no reveal affordance.
  await expect(page.getByText("sk-ant-…R4kQ", { exact: false })).toBeVisible();
  await expect(page.getByText("pplx-…9dQ2", { exact: false })).toBeVisible();

  // All five providers are present as rows.
  for (const provider of ["Anthropic", "OpenAI", "Google", "Perplexity", "OpenRouter"]) {
    await expect(page.getByText(provider, { exact: true }).first()).toBeVisible();
  }
});

test("with no LLM key at all, the page states the consequence and offers the fix", async ({ page }) => {
  await page.goto("/p/analytics/settings?state=no-llm-key");

  // The amber lede clause — a consequence the user chose, never red.
  await expect(
    page.getByText("Agents are paused until you add an LLM key.", { exact: false }),
  ).toBeVisible();

  // Every provider row is an invitation.
  await expect(page.getByRole("button", { name: "Add a key" })).toHaveCount(5);
});
