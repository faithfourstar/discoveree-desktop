/**
 * §3.6.2 REGRESSION SUITE (required by ADR 004): the mechanism differences
 * that stop the desktop pipeline reproducing the SaaS theme-distinctness
 * failure, asserted deterministically against stubbed LLM fixtures — the gate
 * logic, write-set restriction, and catalogue check are deterministic code.
 *
 *   1. Identity is input, not output: same corpus twice → identical theme
 *      IDs/names, zero creations.
 *   2. Semantic dedup is cross-run: paraphrased overlap → zero near-dup
 *      creations; new entries land in the existing themes.
 *   3. Forced assignment removed: singletons stay unfiled; no junk themes.
 *   4. Quality bar enforced: coherence < 70 blocks creation.
 *   5. Human merges compound: aliases classify future candidates into the
 *      survivor.
 * Plus: invented catalogue ids are Zod failures, and the soft cap raises the
 * creation bar.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

// Scriptable LLM: each pipeline call type is recognised by its prompt header.
const mockState = vi.hoisted(() => ({
  classify: null as null | ((prompt: string) => unknown),
  residue: null as null | ((prompt: string) => unknown),
  gate: null as null | ((prompt: string) => unknown),
  calls: { classify: 0, residue: 0, gate: 0 },
  reset() {
    this.classify = null;
    this.residue = null;
    this.gate = null;
    this.calls = { classify: 0, residue: 0, gate: 0 };
  },
}));

vi.mock("../../../lib/llm/router.js", () => ({
  callLLM: vi.fn(async (config: { prompt?: string }) => {
    const prompt = config.prompt ?? "";
    const base = { promptTokens: 1, completionTokens: 1, model: "mock", provider: "gemini" as const };
    if (prompt.startsWith("You are a strict feedback classification engine")) {
      mockState.calls.classify++;
      const out = mockState.classify ? mockState.classify(prompt) : { assignments: [] };
      return { ...base, text: JSON.stringify(out) };
    }
    if (prompt.startsWith("You are a strict theme deduplication engine")) {
      mockState.calls.gate++;
      const out = mockState.gate ? mockState.gate(prompt) : { verdicts: [] };
      return { ...base, text: JSON.stringify(out) };
    }
    if (prompt.startsWith("You are an expert product analyst")) {
      mockState.calls.residue++;
      const out = mockState.residue ? mockState.residue(prompt) : { themes: [], analysisNotes: "" };
      return { ...base, text: JSON.stringify(out) };
    }
    return { ...base, text: "{}" };
  }),
  collectAllowedSourceUrls: () => new Set<string>(),
  enforceSourceUrlAllowList: (value: unknown) => ({ value, stripped: [] }),
  clearLlmClientCaches: vi.fn(),
}));

import type { Product } from "@shared/schema";
import { closeDatabase, initDatabase } from "../../../db/index.js";
import { LOCAL_ORGANIZATION_ID } from "../../../db/seedLocal.js";
import { createProduct } from "../../products/storage.js";
import { mergeThemes, runThemeAggregation } from "../service.js";
import * as storage from "../storage.js";

let product: Product;

async function seedEntry(productId: string, text: string, topic = "General"): Promise<string> {
  const entry = await storage.createFeedbackEntry({
    productId,
    isCompetitor: false,
    sourceName: "G2",
    sourceType: "review",
    verified: true,
    collectedAt: new Date(),
    sourceCreatedAt: new Date(),
    topic,
    quotedText: text,
    sentiment: 40,
  });
  return entry.id;
}

/** Pull the quoted entry ids out of a residue/classification prompt. */
function idsInPrompt(prompt: string): string[] {
  return [...prompt.matchAll(/\[ID:([0-9a-f-]{36})\]|entryId "([0-9a-f-]{36})"/g)]
    .map(m => (m[1] ?? m[2])!)
    .filter((v, i, a) => a.indexOf(v) === i);
}

beforeAll(async () => {
  await initDatabase({ target: "pglite", dataDir: "memory://" });
  product = await createProduct({
    organizationId: LOCAL_ORGANIZATION_ID,
    name: "Theme product",
    slug: "theme-product",
  });
});

afterAll(async () => {
  await closeDatabase();
});

describe("§3.6.2 regression 1 — identity is input, not output", () => {
  let bankIds: string[];
  let mobileIds: string[];

  it("run 1 creates gated themes from residue clustering", async () => {
    mockState.reset();
    bankIds = [
      await seedEntry(product.id, "Bank statement imports keep failing every Monday"),
      await seedEntry(product.id, "The bank feed import duplicated all my transactions"),
      await seedEntry(product.id, "Importing statements from my bank silently drops rows"),
    ];
    mobileIds = [
      await seedEntry(product.id, "Mobile app crashes whenever I open a receipt"),
      await seedEntry(product.id, "The iOS app crashes on upload"),
      await seedEntry(product.id, "App crashes constantly on my phone"),
    ];

    mockState.residue = () => ({
      themes: [
        { themeName: "Unreliable Bank Statement Imports", summary: "Bank imports fail or duplicate.", feedbackEntryIds: bankIds, confidence: 90, coherence: 92 },
        { themeName: "Mobile App Crashes", summary: "The mobile app crashes in core flows.", feedbackEntryIds: mobileIds, confidence: 88, coherence: 90 },
      ],
      analysisNotes: "two clusters",
    });
    mockState.gate = () => ({ verdicts: [] });

    const result = await runThemeAggregation(LOCAL_ORGANIZATION_ID, product);
    expect(result.created).toBe(2);
    expect(result.leftUnfiled).toBe(0);
    expect(mockState.calls.classify).toBe(0); // empty catalogue → nothing to classify against
  });

  it("run 2 on the SAME corpus: identical theme IDs and names, ZERO creations, zero LLM calls", async () => {
    const before = await storage.getFeedbackThemesByProduct(product.id);
    const beforeIdentity = before.map(t => ({ id: t.id, themeName: t.themeName })).sort((a, b) => a.id.localeCompare(b.id));
    const callsBefore = { ...mockState.calls };

    const result = await runThemeAggregation(LOCAL_ORGANIZATION_ID, product);
    expect(result.created).toBe(0);

    const after = await storage.getFeedbackThemesByProduct(product.id);
    const afterIdentity = after.map(t => ({ id: t.id, themeName: t.themeName })).sort((a, b) => a.id.localeCompare(b.id));
    expect(afterIdentity).toEqual(beforeIdentity); // name immutability holds by construction
    expect(mockState.calls).toEqual(callsBefore); // everything filed → no calls at all
  });

  it("regression 2 — paraphrased overlap classifies into the EXISTING themes; zero near-dup creations", async () => {
    const themes = await storage.getFeedbackThemesByProduct(product.id);
    const bankTheme = themes.find(t => t.themeName === "Unreliable Bank Statement Imports")!;
    const namesBefore = themes.map(t => t.themeName).sort();

    const b1 = await seedEntry(product.id, "Statement import from the bank produced duplicates again");
    const b2 = await seedEntry(product.id, "Bank import failures force manual reconciliation");

    // Classification against the stored catalogue — B lands in A's theme.
    mockState.classify = (prompt) => ({
      assignments: idsInPrompt(prompt)
        .filter(id => [b1, b2].includes(id))
        .map(id => ({ entryId: id, themeId: bankTheme.id })),
    });

    const result = await runThemeAggregation(LOCAL_ORGANIZATION_ID, product);
    expect(result.created).toBe(0); // zero near-duplicate creations
    expect(result.classified).toBe(2);
    expect(mockState.calls.residue).toBe(1); // run 1 only — no residue left this run

    const updated = await storage.getFeedbackThemeById(bankTheme.id);
    const memberIds = updated!.feedbackEntryIds as string[];
    expect(memberIds).toContain(b1);
    expect(memberIds).toContain(b2);
    expect(updated!.themeName).toBe("Unreliable Bank Statement Imports"); // never renamed by the run
    expect(updated!.mentionCount).toBe(5); // recomputed deterministically from members

    const namesAfter = (await storage.getFeedbackThemesByProduct(product.id)).map(t => t.themeName).sort();
    expect(namesAfter).toEqual(namesBefore);
  });

  it("an INVENTED catalogue id in the classification output is a Zod failure — the run fails, nothing drifts", async () => {
    const extra = await seedEntry(product.id, "Another bank import complaint entirely");
    mockState.classify = () => ({ assignments: [{ entryId: extra, themeId: "invented-theme-id" }] });

    await expect(runThemeAggregation(LOCAL_ORGANIZATION_ID, product)).rejects.toThrow(/invented|catalogue/i);

    // The invented id stored nothing; the entry is still honestly unfiled.
    const unfiled = await storage.getUnfiledFeedbackEntries(product.id);
    expect(unfiled.map(e => e.id)).toContain(extra);
    // Clean up for later tests.
    await storage.deleteFeedbackEntry(extra);
  });
});

describe("§3.6.2 regressions 3 + 4 — no forced assignment, coherence bar", () => {
  let product2: Product;

  beforeAll(async () => {
    product2 = await createProduct({
      organizationId: LOCAL_ORGANIZATION_ID,
      name: "Sparse product",
      slug: "sparse-product",
    });
  });

  it("scattered singletons + a 2-entry cluster → NO themes created, all unfiled", async () => {
    mockState.reset();
    const clusterIds = [
      await seedEntry(product2.id, "Exports time out on big projects"),
      await seedEntry(product2.id, "Export never finishes for large data"),
    ];
    for (const text of ["Login is slow", "Wish it had dark mode", "Pricing page confused me", "Docs are thin", "Great support!"]) {
      await seedEntry(product2.id, text);
    }

    // Honest clustering: one small cluster proposed, singletons left out.
    mockState.residue = () => ({
      themes: [{ themeName: "Slow Large Exports", summary: "Exports time out.", feedbackEntryIds: clusterIds, confidence: 85, coherence: 90 }],
      analysisNotes: "one small cluster; singletons unassigned",
    });
    mockState.gate = () => ({ verdicts: [] });

    const result = await runThemeAggregation(LOCAL_ORGANIZATION_ID, product2);
    expect(result.created).toBe(0); // 2 < 3 — below the entry threshold
    expect(result.leftUnfiled).toBe(7); // the honest backlog, served
    expect(await storage.getFeedbackThemesByProduct(product2.id)).toEqual([]);
  });

  it("a 3-entry candidate below the coherence bar (<70) is not created; entries stay unfiled", async () => {
    const weakIds = [
      await seedEntry(product2.id, "Something about setup"),
      await seedEntry(product2.id, "Vaguely related grumble"),
      await seedEntry(product2.id, "Another loosely similar note"),
    ];
    mockState.residue = () => ({
      themes: [{ themeName: "General Setup Friction", summary: "A loose grouping.", feedbackEntryIds: weakIds, confidence: 60, coherence: 55 }],
      analysisNotes: "low coherence",
    });

    const result = await runThemeAggregation(LOCAL_ORGANIZATION_ID, product2);
    expect(result.created).toBe(0);
    const unfiled = await storage.getUnfiledFeedbackEntries(product2.id);
    for (const id of weakIds) expect(unfiled.map(e => e.id)).toContain(id);
  });
});

describe("§3.6.2 regression 5 — human merges compound through aliases", () => {
  it("post-merge, a candidate phrased in the absorbed theme's name classifies into the survivor", async () => {
    mockState.reset();
    const themes = await storage.getFeedbackThemesByProduct(product.id);
    const survivor = themes.find(t => t.themeName === "Unreliable Bank Statement Imports")!;
    const mobile = themes.find(t => t.themeName === "Mobile App Crashes")!;

    // Human merge (the API's POST /themes/:id/merge calls this service fn):
    // absorb "Mobile App Crashes" into the bank theme purely to record an alias
    // mechanism check — the absorbed NAME becomes permanent matching vocabulary.
    const merged = await mergeThemes(survivor, mobile);
    expect((merged.aliases as string[])).toContain("Mobile App Crashes");
    expect(await storage.getFeedbackThemeById(mobile.id)).toBeUndefined();

    // New entries phrased in the ABSORBED name; classification returns null
    // (simulating a model that does not recognise them), so they reach residue —
    // which proposes a candidate under the absorbed name. Gate step 4(a)
    // matches the ALIAS and converts it into classification into the survivor.
    const newIds = [
      await seedEntry(product.id, "Mobile app crashes on the new update"),
      await seedEntry(product.id, "App crash when scanning receipts"),
      await seedEntry(product.id, "Crashes make the mobile app unusable"),
    ];
    mockState.classify = (prompt) => ({
      assignments: idsInPrompt(prompt).filter(id => newIds.includes(id)).map(id => ({ entryId: id, themeId: null })),
    });
    mockState.residue = () => ({
      themes: [{ themeName: "Mobile App Crashes", summary: "Crashes again.", feedbackEntryIds: newIds, confidence: 90, coherence: 91 }],
      analysisNotes: "",
    });

    const result = await runThemeAggregation(LOCAL_ORGANIZATION_ID, product);
    expect(result.created).toBe(0); // no sibling theme — the alias caught it
    expect(result.convertedToClassification).toBe(1);

    const after = await storage.getFeedbackThemeById(merged.id);
    const memberIds = after!.feedbackEntryIds as string[];
    for (const id of newIds) expect(memberIds).toContain(id);
    expect(after!.themeName).toBe("Unreliable Bank Statement Imports");
  });
});

describe("§3.6.1 step 5 — soft cap raises the creation bar", () => {
  let product3: Product;

  beforeAll(async () => {
    product3 = await createProduct({
      organizationId: LOCAL_ORGANIZATION_ID,
      name: "Capped product",
      slug: "capped-product",
    });
    // 15 active themes → the soft cap is in force.
    for (let i = 0; i < 15; i++) {
      const anchor = await seedEntry(product3.id, `Anchor entry for theme ${i} with distinct content ${i}`);
      await storage.createFeedbackTheme({
        productId: product3.id,
        themeName: `Existing Problem Number ${i}`,
        aliases: [],
        summary: `Problem ${i}`,
        status: "needs_review",
        mentionCount: 1,
        feedbackEntryIds: [anchor],
        confidence: 90,
        coherence: 90,
      });
    }
  });

  it("at ≥15 active themes a 3-entry/coherence-80 candidate is blocked; a 5-entry/coherence-90 one clears", async () => {
    mockState.reset();
    const smallIds = [
      await seedEntry(product3.id, "New niggle A"),
      await seedEntry(product3.id, "New niggle B"),
      await seedEntry(product3.id, "New niggle C"),
    ];
    const bigIds: string[] = [];
    for (let i = 0; i < 5; i++) bigIds.push(await seedEntry(product3.id, `Major recurring failure report ${i}`));

    mockState.classify = (prompt) => ({
      assignments: idsInPrompt(prompt).filter(id => [...smallIds, ...bigIds].includes(id)).map(id => ({ entryId: id, themeId: null })),
    });
    mockState.residue = () => ({
      themes: [
        { themeName: "Minor New Niggle", summary: "Small.", feedbackEntryIds: smallIds, confidence: 85, coherence: 80 },
        { themeName: "Major Recurring Failure", summary: "Big.", feedbackEntryIds: bigIds, confidence: 95, coherence: 90 },
      ],
      analysisNotes: "",
    });
    mockState.gate = () => ({ verdicts: [] });

    const result = await runThemeAggregation(LOCAL_ORGANIZATION_ID, product3);
    expect(result.created).toBe(1); // only the 5-entry / ≥85-coherence candidate
    const names = (await storage.getFeedbackThemesByProduct(product3.id)).map(t => t.themeName);
    expect(names).toContain("Major Recurring Failure");
    expect(names).not.toContain("Minor New Niggle");
  });
});
