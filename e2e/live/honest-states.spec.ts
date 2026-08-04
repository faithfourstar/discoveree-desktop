import { test, expect } from "@playwright/test";

/**
 * The live walk: real server (scratch data dir, port 7411), real client
 * build, NO LLM keys — every state asserted here is the honest keyless
 * behaviour the desktop promises. Steps run in order and build on each
 * other's data (single worker, see the live config).
 *
 * API writes go straight to the server (creating a product and a competitor
 * is onboarding/agent work the UI wraps in flows this suite is not about);
 * the assertions are all on what the UI then honestly shows.
 */

const API = "http://127.0.0.1:7411/api";

let productId: string;

test.describe.configure({ mode: "serial" });

test("a fresh install serves the products collection", async ({ request }) => {
  const res = await request.get(`${API}/products`);
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { products: unknown[] };
  // Empty on a fresh boot; a serial-mode retry re-enters here after later
  // steps created data, so assert the shape, not emptiness.
  expect(Array.isArray(body.products)).toBe(true);
});

test("after creating a product, competitors shows its day-one prompt", async ({ page, request }) => {
  const created = await request.post(`${API}/products`, {
    data: { name: "Acme Analytics", url: "https://acme.example" },
  });
  expect(created.status()).toBe(201);
  productId = ((await created.json()) as { product: { id: string } }).product.id;

  await page.goto(`/p/${productId}/competitors`);
  await expect(
    page.getByText("Who should Discoveree keep an eye on?", { exact: false }),
  ).toBeVisible();
});

test("an accepted competitor renders as a not-yet-verified row (no keys → save-unverified)", async ({ page, request }) => {
  const created = await request.post(`${API}/products/${productId}/competitors`, {
    data: { name: "Rivalcorp", url: "https://rivalcorp.example", classification: "DIRECT" },
  });
  expect(created.status()).toBe(201);
  const competitorId = ((await created.json()) as { competitor: { id: string } }).competitor.id;

  const accepted = await request.post(
    `${API}/products/${productId}/competitors/${competitorId}/accept`,
  );
  expect(accepted.status()).toBe(200);

  await page.goto(`/p/${productId}/competitors`);
  await expect(page.getByText("Rivalcorp").first()).toBeVisible();
  // Without keys the first check cannot verify — the page says so honestly
  // (never a bare "verified"): the lede states it and the row carries the
  // failure grammar with its remedy beside it.
  await expect(
    page.getByText("hasn’t been verified yet", { exact: false }).first(),
  ).toBeVisible();
  await expect(
    page.getByText("couldn’t complete the first check", { exact: false }).first(),
  ).toBeVisible();
  await expect(page.getByText("Try again").first()).toBeVisible();
});

test("feedback logged through the UI files word for word and settles honestly", async ({ page }) => {
  await page.goto(`/p/${productId}/customers`);
  await expect(
    page.getByText("Where does customer feedback land today?", { exact: false }),
  ).toBeVisible();

  await page
    .getByLabel("What they said")
    .fill("The weekly export takes forever and the numbers never match the dashboard.");
  await page.getByRole("button", { name: "File it" }).click();

  // The verbatim files immediately — filing never blocks on an LLM key.
  await expect(
    page.getByText("Filed word for word", { exact: false }),
  ).toBeVisible({ timeout: 15_000 });

  // Matching cannot run without a key; the flow settles on an honest line
  // (which one depends on whether the aggregation run was accepted before
  // failing) and the item is counted as unfiled, not lost.
  await expect(
    page
      .getByText("a theme forms when the pattern does", { exact: false })
      .or(page.getByText("matching runs when agents are back on", { exact: false })),
  ).toBeVisible({ timeout: 40_000 });

  await page.goto(`/p/${productId}/customers`);
  await expect(page.getByText("1 item waiting for a pattern", { exact: false })).toBeVisible();
});

test("settings shows all five providers keyless with the amber consequence lede", async ({ page }) => {
  await page.goto(`/p/${productId}/settings`);

  await expect(
    page.getByText("Agents are paused until you add an LLM key.", { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Add a key" })).toHaveCount(5);
  for (const provider of ["Anthropic", "OpenAI", "Google", "Perplexity", "OpenRouter"]) {
    await expect(page.getByText(provider, { exact: true }).first()).toBeVisible();
  }
  // The masked-key contract leaves nothing to reveal on a keyless machine.
  await expect(
    page.getByText("Keys are encrypted and stored only on this machine", { exact: false }),
  ).toBeVisible();
});
