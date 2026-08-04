# ADR 004 — Porting the Customer Insights & Feedback vertical (sprint 3b)

**Status:** Proposed · **Date:** 4 August 2026 · **Author:** Desktop architect (Claude Code)
**Amended 4 August 2026 (owner report):** §3.6 replaces wholesale theme re-derivation with a classify-first aggregation model; §1, §5, §8, §9, §10 adjusted accordingly. The owner's experience — the SaaS could not produce meaningfully distinct themes despite its merge/consolidate machinery — is treated as evidence that porting that machinery unchanged would reproduce the failure; §3.6 names the mechanism and the fix.
**Context:** Build brief §3 (KEEP: segments, personas, feedback→themes agents with sentiment), §4a (internal evidence), §4c (multi-product). Builds on ADR 001 (DB seam), ADR 002 (module pattern, extraction-map style, §9 proposal gate), ADR 003 (entity/facet model — `segment_entities`, `personas`, `persona_facets`, facet-shaped `customer_segment_profiles` are already in the baseline, empty, waiting; this port lands on them and does not redesign them).
**Source basis:** SaaS repo `main @ 823d979e` — `segmentNormalization.ts` (314), `lib/feedbackPoller.ts` (271), `reviewSearch.ts` (632), `reviewService.ts` (224), `g2Api.ts` (479), plus the named ranges of `gemini.ts` (26,949), `scheduler.ts` (8,335), `routes.ts` (46,316), `storage.ts` (5,805), `agentSeeder.ts` (2,841).
**Hard requirement (owner, 4 Aug 2026):** the SaaS populates personas and jobs-to-be-done with **no underlying data** — the LLM hallucinates customer knowledge from the product description alone. That must be **structurally impossible** in the desktop port. §3 is the design answer; every other section conforms to it.

---

## 1. Sprint scope

### The end-to-end slice that must work

> Define a segment (owner-asserted, provenance `owner`) → attach personas with per-product JTBD facets — **agent-enriched only from actual evidence, every claim cited** → feedback flows in (manual add + web-mined product reviews) → sentiment scored → themes maintained **classify-first against a stable theme set** with evidence links and confidence → served to the client. In parallel, competitor review mining runs **once per entity** and feeds both consumers: the competitor profile (sentiment, review count, "What buyers say" quotes with citations — the client blocks already exist awaiting data) and the evidence ledger.

### IN (sprint 3b)

| Piece | Why |
|---|---|
| Segment CRUD on the 3a shapes (entity + facet, gate status) | The vocabulary spine; exercises `segment_entities`/`customer_segment_profiles` for the first time |
| Persona CRUD (identity + per-product facet) | Owner-asserted personas are legitimate evidence (provenance `owner`); the agent path is additive on top |
| **Evidence ledger** (`modules/customers/evidence.ts`) | §3. New code, small; the module's centre of gravity |
| **Segment quotes agent** (`customer-quotes-agent`) | Evidence *gathering*: web-search quotes with URL provenance per segment. Keeps web search — its output IS evidence |
| **Persona/JTBD enrichment agent** (`customer-insights-agent`, rewritten) | Evidence *synthesis*: proposes personas/JTBD/needs **only** from the ledger, citations required by schema, web search OFF (§3.3) |
| **Feedback: manual add + own-product review mining** (`gather-feedback-agent`) | The feedback spine; mined entries carry source URLs and the verification pipeline |
| **Sentiment batch scoring** (`scoreSentimentBatch`) | Fills unscored entries after every collection run; the 0–100 rubric ports verbatim |
| **Theme maintenance, classify-first** (§3.6: classification against the stable theme set; residue clustering; creation-time distinctness + coherence gate; orphan pruning) | The feedback→themes differentiator done honestly: stable theme IDs and names, merge-don't-replace, entry-ID evidence links, unfiled as a designed state |
| **Competitor review mining as an ENTITY agent** (`competitor-reviews-agent`) | Mined once per org per entity node (ADR 003 §2.7); fills the entity review columns that already exist (§4) |
| Competitor detail: "What buyers say" + card sentiment/reviewCount | The two `null` fields in `CompetitorCard` and the unrendered client blocks get their data (§6.4) |
| Manual feedback-sources CRUD (`feedback_sources`) | Cheap; scopes review mining to trusted platforms; discovery agent deferred |
| Scheduler registration (2 product-kind + 1 entity-kind + 2 on-demand) + schedule defaults | Zero new scheduler infrastructure — the 3a pattern must absorb this sprint whole (ADR 002 §8.10 test) |

### OUT (explicitly, with destination)

| Piece | Verdict | Reasoning |
|---|---|---|
| **G2 API** (`g2Api.ts`) | **CUT — never port** (revises ADR 002's "defer behind own-G2-key setting") | Platform credential; meaningless under BYO keys; ~no customer holds a G2 API contract; `reviewService` already degrades without it. Carrying a dead branch through the flagship evidence pipeline is worse than deleting it. Revisit only on real customer demand — flagged as an ADR 002 §1 revision, not silently dropped |
| Segment **discovery** agent (`analyzeCustomerSegments`, gemini.ts:4776–5020) | Onboarding sprint | Same ruling as competitor discovery (ADR 002 §1): it belongs to the wizard's "propose from one URL" flow. When it lands, its output enters as **proposed** facets on the §5 gate |
| Review-platform discovery (`preDiscoverReviewPlatformUrls` 5939–6097, `analyzeReviewPlatforms` 6098–6586) | Sources sprint | Mining degrades gracefully to default platforms; manual `feedback_sources` CRUD covers the trusted-source need now |
| Module-overview synthesis (`generateCustomerInsightsSummary`, 5559–5807) | Defer, probably forever | A stored prose summary over context the customer's AI can synthesise over MCP — brief §10a boundary. The overview page is blocks, not a generated essay |
| **Document upload → extraction** (brief §4a.1) | **OUT of 3b** — Sources sprint | Ruled out deliberately: the SaaS parsing code lives in routes.ts multer/pdf-parse blocks entangled with object storage (seam not yet ported), and §4a assigns it to the Sources sprint. 3b's contribution is the evidence-ref vocabulary reserving kind `document` (§3.2), so uploads slot in later with **zero** schema change. Interim: `researchItems` on the facet (links + notes, owner-entered) carries owner research |
| MCP feedback connections (inside `collectFeedbackForProduct`, scheduler.ts:~873–1090) + MCP syncs (4606–4700, 6661–6960) | MCP sprint | Brief §4a.2: external writers enter the proposal queue there |
| Slack / analytics ingestion | OUT per brief §3 cut list | — |
| `lib/feedbackPoller.ts` (post-launch opportunity feedback polling) | **Roadmap Review sprint** — flagged | The brief's §3 keep-row lists it under Customer Insights, but it is opportunity-scoped (polls feedback for shipped `solutionIdeas`); its consumers and its `opportunities` join live in the roadmap module. Re-homing, not a cut |
| `routeFeedbackToTeams` (scheduler.ts:420–536), `team_assignment_signals`, `teamId` routing | CUT | Teams are team-tier (brief §3); see §7 for the column consequence |
| Opportunity generation from feedback/themes (`generateOpportunitiesFromFeedback`, theme→opportunity routes) | Roadmap Review sprint | It is the Suggest half of §4 of the brief |
| ICP / retention chat assistants (`chatWithCustomerSegmentationICP*`, 22713–23455) | CUT | Chat assistants the customer's AI replaces (brief §10a). `icpFit`/`isIcp` stay as owner-set fields |
| Segment coverage matrix, feature-persona mapping (26210–26550) | Later UI sprint | Views over data 3b stores |
| Call-recording mining (`syncCallRecordingsForSegment`, scheduler.ts:4943–5100) | §4a.4 sprint | Schema head start already noted there |
| CSAT/NPS **estimation by LLM** | **CUT permanently** | §3.4 — banned, not deferred |

---

## 2. Review-source strategy under BYO keys (decided)

The SaaS review stack was G2-platform-API-first with web search as fallback (`reviewService.ts:39–121`). Desktop inverts and simplifies: **web-search-driven review mining is the only source.** `searchProductReviews`/`searchCompetitorReviews` are pure outbound `callLLM({useWebSearch})` calls through the router — they survive BYO keys unchanged, and the validation pipeline (`validateReviewContent`, URL soft-404 validation, cross-allocation) is what makes their output evidence-grade rather than prose.

**One mining run, two consumers** (the core of this decision):

1. **Competitor profiles.** `competitor-reviews-agent` runs as an **entity-scoped** agent (ADR 003 §2.7) against each competitor entity node with ≥1 tracked facet. Its output writes the entity review columns that 3a already placed (`reviews`, `reviewPlatforms`, `reviewPositiveThemes`, `reviewNegativeThemes`, `reviewAverageRating`, `reviewTotalCount` — schema.ts:838–843), conditional-merge exactly as the SaaS block does (scheduler.ts:2849–2985: only overwrite fields the run actually returned). Every product tracking that entity sees the same reviews — mined once per org, the "track Mixpanel from five products, research it once" saving made real for the most expensive scan. The card's `sentiment` derives deterministically from `reviewAverageRating × 20`; `reviewCount` from `reviewTotalCount`; the detail payload gains the "What buyers say" block (§6.4).
2. **Customer feedback/themes.** Own-product mining (`gather-feedback-agent` → `searchProductReviews`) writes `feedback_entries` rows (product-scoped, ADR 003 §2.8), which sentiment scoring and theme maintenance (§3.6) then consume. Mined entries are evidence-ledger items (§3.2).

**Cross-allocation** (a product-review search that actually found a competitor mention, `reviewService` cross-allocated quotes): resolved against `competitor_entities` by normalised name. Match with a tracked facet for this product → **append to the entity's `reviews`** (dedup by the ported 100-char key; agents maintaining tracked context is normal write behaviour) and record a feedback entry with `isCompetitor: true` + `competitorEntityId`. No tracked entity → **drop and log**. The SaaS name-string routing invented competitor feedback rows for names nothing tracked; under the gate, an untracked competitor must not accumulate context.

**The SaaS profile→feedback "bridge" does NOT port** (scheduler.ts:590–645, 1444–1492, 2928–2960 — three copies of the same copy-loop). Its job was making competitor review quotes visible in the Feedback tab by duplicating them per product. Desktop ruling: **competitor voice lives on the competitor object; the Customer Insights module is about our customers.** Per-product competitor theme aggregation is cut with it — the entity's `reviewPositiveThemes`/`reviewNegativeThemes` (produced in the same mining call) already are the competitor's themes, absolute and org-level, served on the competitor detail. This halves theme-maintenance LLM spend, deletes the messiest dedup code in the pipeline, and removes a whole class of name-keyed drift.

Rejected alternatives: porting the bridge onto entity IDs (duplicated rows per product remain, for a view that the competitor object serves better); making own-product review mining entity-scoped too (our own products' feedback is the module's product-scoped core by ADR 003 §2.8 — an own-product entity observation would be a second home for the same data).

---

## 3. The evidence-grounding rule (hard requirement — the design centre)

### 3.1 Where the SaaS hallucinates — named, and NOT ported

| Site | Behaviour that does not port |
|---|---|
| `generateCustomerSegmentInsights` (gemini.ts:5062–5555) | Invents 1–3 personas (goals, pain points, behaviours), a full JTBD analysis, needs with importance/satisfaction scores, **CSAT/NPS estimates**, opportunities and recommendations from company name + segment name + generic web search ("Search for industry needs and pain points for this segment type"). `existingContext` is passed as `''` by its only real caller |
| `enrichCustomerSegmentBackground` (13586–13768) | Calls the above with empty context whenever feedback themes are absent — i.e. precisely when there is no evidence, it runs anyway and stores the result as a completed profile |
| `runCustomerSegmentGapFillForAllProducts` (scheduler.ts:3721–3770) | Mass-runs that enrichment daily for every segment with empty JTBD/needs — a hallucination *scheduler*. Its desktop replacement is the inverse: the evidence gate keeps exactly these targets **out** of the run list |
| CSAT/NPS estimate path (`csatDataSource`/`npsDataSource: "ai"`, satisfaction derived from invented needs scores at 13760) | Banned outright (§3.4) |

`analyzeCustomerSegments` (segment discovery) is web speculation too, but its output is a **proposal** of vocabulary (names + descriptions) behind the accept gate — acceptable when it lands in the onboarding sprint, because nothing becomes context without a human accept, and it must not fabricate personas/JTBD (the desktop version proposes segment names only).

### 3.2 The evidence ledger

`modules/customers/evidence.ts` defines the module's shared currency:

```ts
type EvidenceRef =
  | { kind: "feedback_entry"; id: string }          // feedback_entries.id
  | { kind: "quote"; url: string; source: string }   // mined quote with validated URL
  | { kind: "owner"; note?: string }                 // owner assertion (manual entry / interview)
  | { kind: "document"; id: string }                 // RESERVED — §4a Sources sprint
  | { kind: "crm" | "call_transcript"; id: string }; // RESERVED — §4a.3/4
```

`collectSegmentEvidence(productId, segmentEntityId)` assembles the pool for a segment: active feedback entries (own-product), URL-validated quotes on the facet, owner `researchItems`, owner-provided facts from the interview. It returns items plus computed stats: `count`, `distinctSources`, `newestAt`. The API serves this as `evidenceStatus` on every segment payload — **absence is served honestly** ("3 evidence items · personas need 3 citing this role · insights need 5"), which is what the Context Health home renders instead of fabricated completeness.

Owner knowledge is first-class evidence, clearly labelled: segments, personas, JTBD notes and research items the owner asserts are stored with provenance `owner` and rendered as such — distinct from evidence-derived, never dressed up as research. What is banned is LLM speculation stored as if researched.

### 3.3 Gates on generation — three enforcement layers

1. **Scheduler/targets layer:** the module's target listing (the 3a pattern — modules resolve their own targets) returns only segments meeting the threshold for the agent in question. Below threshold the agent simply has no target; `evidenceStatus` on the API explains why, and no fake execution rows are written. Manual "enrich now" below threshold → `422 { error: "insufficient_evidence", evidenceStatus }`.
2. **Prompt layer:** the rewritten `customer-insights-agent` receives the **enumerated evidence items with IDs** as its entire knowledge of the customer (no web search — gathering and synthesis are separated; `customer-quotes-agent` and `gather-feedback-agent` are the gatherers and keep web search because their output carries URLs). Instructions: make only claims supported by the listed items; cite item IDs per claim; return fewer/no personas rather than invent.
3. **Schema layer — where the rule actually lives:** the Zod output schemas require evidence references. `personaProposalSchema` requires `evidenceRefs: z.array(evidenceRefSchema).min(3)`; each JTBD job, goal, pain point and need row requires `evidenceRefs: min(1)`; `segmentInsights` output requires `min(5)` distinct refs. Refs are verified against the ledger before persist (a cited feedback id must exist and be active). Parse or verification failure → rejected, raw payload logged to the execution row (ADR 002 risk-3 pattern), nothing stored. This is the discipline at the data layer: the prompt asks, the schema **enforces**.

**Thresholds (v1, tune with use):**

| Output | Minimum evidence |
|---|---|
| Agent-proposed persona | ≥3 distinct items citing that role, ≥2 distinct sources |
| JTBD / goal / pain-point / need claim | ≥1 ref per claim (schema-required) |
| `segmentInsights` synthesis | pool ≥5 items |
| Theme | ≥3 member entries + coherence bar + creation-time distinctness gate (§3.6.1) |
| Segment/persona created by owner | none — provenance `owner`, labelled |

### 3.4 Scores are computed or owner-entered, never estimated

- `csatScore`/`npsScore`: owner-entered only; `csatDataSource`/`npsDataSource` can only ever hold `"user"`. The `"ai"` value does not port.
- `overallSatisfaction`: computed deterministically from the sentiment of evidence-linked feedback (mean of linked entries' scores), or null. Not an LLM output.
- `needs[].satisfaction`: only present when derived from cited feedback sentiment; otherwise omitted (schema permits absence, not invention).

### 3.5 Confidence

The SaaS theme prompt already elicits `confidence`/`coherence` (0–100) and then **drops them on the floor** (`createFeedbackTheme` never stores them). Desktop keeps the elicitation, stores it, and adds the honest half: per theme, computed `evidenceCount` (= linked active entries) and `distinctSources`. The surfaced confidence is the computed pair; the LLM's self-report is stored for calibration but never rendered alone — with one exception: `coherence` now has an enforcement job at theme creation (§3.6.1 step 4d). Persona facets carry the same computed stats via their `evidenceRefs`.

### 3.6 Theme aggregation is CLASSIFY-FIRST, never re-derivation (amendment, 4 Aug 2026)

**Owner report:** the SaaS struggled to produce meaningful, sufficiently distinct themes — despite having `mergeSemanticallySimilarThemes` and `consolidateThemes`, both of which the original draft of this ADR ported. That experience is evidence the ported machinery alone does not deliver distinctness. The mechanism of the SaaS failure, verified in source:

1. **Wholesale re-derivation.** `aggregateThemesForProduct` (scheduler.ts:1422–1715) feeds the **entire corpus** to `aggregateFeedbackThemes` (gemini.ts:8165–8489) every run; the prompt mandates *"EVERY feedback entry must be assigned to exactly one theme."* The theme set is re-invented from scratch each run — the model has no obligation, and no reliable ability, to reproduce last run's groupings or names.
2. **Within-run-only semantic dedup.** `mergeSemanticallySimilarThemes` is invoked at gemini.ts:8467 on `parsed.themes` — the current run's proposals. It **never sees the stored theme set.** The only cross-run identity mechanism is `normalizeThemeName` string equality in the merge loop (scheduler.ts:1504–1592); the model re-deriving "Unreliable Bank Statement Imports" as "Bank Import Failures" creates a sibling every time, and no machinery ever compares the two.
3. **Forced total assignment.** Every straggler entry must land somewhere, so the model invents weak themes to house them.
4. **No quality bar.** `confidence`/`coherence` are elicited and discarded; nothing prevented an incoherent grouping from becoming a stored theme.

The distinctness failure is therefore not a prompt-tuning problem — it is an **assignment-model** problem, and this amendment changes the model.

#### 3.6.1 The run shape (precise)

`theme-aggregation-agent` run, per product:

1. **Load.** The tracked theme catalogue `T` — `{ id, themeName, aliases, summary, feedbackEntryIds }` — and the **unfiled** entries `U`: active own-product entries referenced by no theme's `feedbackEntryIds` (derived, no column; the module spec's unfiled holding state). `U` is processed newest-first, capped at 300 per run (older unfiled entries rotate in on later runs).
2. **CLASSIFY.** Batched LLM calls (≤100 entries each): input = the catalogue (id, name, summary) + the entries; output Zod-validated `assignments: [{ entryId, themeId | null }]`, with every `themeId` schema-checked against the input catalogue (an invented id is a parse failure). Assigned entries are set-unioned into the theme's `feedbackEntryIds`; `mentionCount`, `averageSentiment`, `priority` and the §3.5 evidence stats are **recomputed deterministically from members**. The agent may refresh a theme's `summary` only when the theme gained entries this run (the summary describes evidence; the name is identity). **No code path in the run writes `themeName`.**
3. **RESIDUE.** Entries classified `null` go to a clustering call — the ported gemini.ts:8165–8489 prompt reduced to the residue, with the total-assignment constraint **deleted** and replaced by: *"Leave entries unassigned rather than force a grouping."* Output: candidate themes with name/summary/entryIds/confidence/coherence.
4. **CREATION GATE** — a candidate becomes a theme only if it clears all four, in order:
   - *(a)* **Name-normalised dedup at creation:** `normalizeThemeName(candidate)` against all existing theme names **and aliases** → match ⇒ converted into a classification of its entries into that theme; no new theme.
   - *(b)* **Semantic dedup at creation, against the stored set:** `mergeSemanticallySimilarThemes` repurposed — one Zod-validated call over candidates + the existing catalogue; a "same underlying problem" verdict against an existing theme ⇒ converted to classification into it. (Candidate-vs-candidate pairs are deduped in the same call, as the SaaS did within-run.)
   - *(c)* **Threshold:** ≥3 member entries.
   - *(d)* **Coherence bar:** elicited `coherence` ≥ 70.
   Failing *(c)* or *(d)* leaves the entries **unfiled, honestly** — retried on later runs; a below-threshold pair becoming a theme when the third mention arrives is exactly how the model is supposed to work. The gate can only block creation; it can never fabricate — a conservative-only use of an elicited score, which is why coherence is safe to give a job here.
5. **Soft cap.** While a product's active theme count ≥ **15**, the creation bar rises to coherence ≥ 85 AND ≥5 entries, and the run sets a "consolidation suggested" flag surfaced on the module overview / Context Health — prompting the **human** merge flow. Rationale for a rising bar rather than a hard cap: a hard cap silently discards genuinely new problems (dishonest); no cap lets pathological growth erode readability (the SaaS's own prompt already fought this with "fewer, genuinely distinct themes"). 15 is a readability heuristic, tunable in settings; it never blocks classification into existing themes.
6. **PRUNE.** `pruneOrphanedThemesForProduct` unchanged: zero-member themes deleted, reduced sets recomputed.
7. **Human operations** (per the module spec): rename and merge are human actions. A human merge records the absorbed theme's name into the survivor's `aliases`, so steps 2 and 4(a) match historical vocabulary forever. The agent never renames or merges tracked themes.

#### 3.6.2 Why the desktop pipeline will not reproduce the SaaS failure — testable mechanism differences

| # | Mechanism difference | Regression test the engineers can write |
|---|---|---|
| 1 | **Identity is input, not output.** Stored themes enter the run as the classification catalogue; the run's write-set to an existing theme is `{feedbackEntryIds ∪, recomputed stats, summary-if-grew}` — name immutability is code-enforced (no run path writes `themeName`) | Same corpus, run twice → run 2 classifies everything into run 1's themes: **identical theme IDs and names, zero creations** |
| 2 | **Semantic dedup is cross-run.** The creation gate compares candidates against the stored catalogue (names + aliases + summaries); the SaaS compared only within a single run's proposals (gemini.ts:8467) | Run corpus A, then A∪B where B paraphrases A's problems → **zero near-duplicate creations**; B entries land in A's themes |
| 3 | **Forced assignment removed.** No theme exists because an entry needed a home; unfiled is a designed, served state | Corpus of scattered singletons + one 2-entry cluster → **no themes created, all unfiled** |
| 4 | **Quality bar enforced.** Coherence gates creation (§3.6.1 step 4d) where the SaaS elicited and discarded it | Candidate fixture with coherence < 70 → not created, entries unfiled |
| 5 | **Human merges compound.** Aliases make every human consolidation permanent matching vocabulary | Post-merge, re-run with entries phrased in the absorbed theme's name → classified into the survivor |

LLM nondeterminism caveat, stated so the tests are writable: tests 1–5 run against recorded/stubbed LLM fixtures asserting **pipeline** behaviour (the gate logic, the write-set restriction, the catalogue check are all deterministic code); a small live-eval suite asserts the same invariants statistically across providers. Invariant 1's name-immutability holds by construction regardless of any model's output.

#### 3.6.3 Consequences elsewhere in this ADR

- The evidence-threshold table (§3.3) row for themes now reads: ≥3 entries **+ coherence ≥ 70 + creation-time distinctness gate**.
- `consolidateThemes` (scheduler.ts:180–245) is no longer a post-hoc pass: its below-threshold-merge logic folds into gate step 4; it does not port as a standalone function.
- The name-keyed merge loop of `aggregateThemesForProduct` (scheduler.ts:1504–1592) — the SaaS's only cross-run identity mechanism — is **not ported**; classify-first replaces it, not supplements it.
- `normalizeThemeName` (scheduler.ts:113–130) ports, extended to check `aliases`.
- Classification batches replace the whole-corpus prompt, which also resolves the context-window risk the original draft carried: each call sees the catalogue + ≤100 entries, never the corpus.
- Schema: `feedback_themes.aliases` jsonb, additive (§8).

---

## 4. Module structure (house pattern — no new infrastructure)

```
server/modules/customers/
├── routes.ts            # §6 surface (mounted under /api/products/:productId + /api/entities)
├── storage.ts           # carved: segments/personas/facets/feedback/themes/sources (§5)
├── service.ts           # add/accept/discard orchestration, facet GC, enrichment fan-out
├── schemas.ts           # Zod: agent outputs (evidence-required, §3.3) + API bodies
├── evidence.ts          # ledger, thresholds, evidenceStatus (§3.2)
├── normalization.ts     # segmentNormalization.ts ported whole (minus the two lib/text fns)
└── agents/
    ├── segmentQuotes.ts     # findCustomerSegmentQuotes (gemini.ts:5809–5933)
    ├── segmentInsights.ts   # REWRITTEN customer-insights-agent (§3.3); replaces 5062–5555
    ├── gatherFeedback.ts    # own-product mining orchestration (from scheduler.ts:538–1154, trimmed)
    ├── sentiment.ts         # scoreSentimentBatch (7745–8044) + scoreUnscoredFeedback (scheduler.ts:330–362)
    └── themes.ts            # §3.6 classify-first pipeline: NEW classification step; residue clustering
                             # (reshaped aggregateFeedbackThemes 8165–8489); creation gate (repurposed
                             # mergeSemanticallySimilarThemes 8059–8163 + normalizeThemeName w/ aliases);
                             # pruneOrphanedThemesForProduct (scheduler.ts:379–418)

server/lib/reviews/
├── search.ts            # reviewSearch.ts whole minus G2 imports (validation, cross-allocation, fallback URLs)
└── fetch.ts             # reviewService.ts G2-stripped (~90 lines): fetchProductReviews/fetchCompetitorReviews

server/lib/text.ts       # isNearDuplicateText + mergeDifferentiators (from segmentNormalization.ts)

server/modules/competitors/agents/reviews.ts   # getCompetitorReviews (gemini.ts:11516–12053) as an
                                               # entity agent writing entity review columns (§2)

shared/sentiment.ts      # sanitizeSentimentScore + rubric constants (port whole, with its test file)
```

Placement rules honoured: `lib/` compiles with zero `modules/` imports (`lib/reviews` knows product/competitor *names* as strings, no schema); competitor review mining is competitive-intelligence context, so it lives in the competitors module and the customers module never imports it — cross-allocation calls a competitors **service** function (`appendEntityReviews(entityId, quotes)`), the allowed cross-module path. The competitors service's inlined `mergeDifferentiators` copy (ADR 002 §5 `TODO(sprint-3)`) is deleted in favour of `lib/text.ts` — that TODO falls due this sprint.

---

## 5. Extraction map (allowlist; TAKE / TAKE-PARTIAL / LEAVE)

| Source (lines) | Verdict | What moves → where | Scale |
|---|---|---|---|
| `segmentNormalization.ts` (314) | **TAKE** | Whole → `modules/customers/normalization.ts`; `isNearDuplicateText` (266–284) + `mergeDifferentiators` (285–297) → `lib/text.ts` | ~314 |
| `reviewSearch.ts` (632) | **TAKE-PARTIAL** | `searchProductReviews` (27–277), `searchCompetitorReviews` (278–464), `validateUrl` (465–484), `validateProductUrl` (485–525), `validateReviewContent` (526–602), `findMatchingCompetitor` (603–616), `generateFallbackSearchUrl` (617–632) → `lib/reviews/search.ts`. G2 imports deleted | ~600 |
| `reviewService.ts` (224) | **TAKE-PARTIAL** | `fetchProductReviews` (27–133) and `fetchCompetitorReviews` (135–187) with every `g2Api` branch deleted; `mergeQuotesWithAIGenerated` (190–224) **LEAVE** — "ai_generated" quotes are fabricated evidence, banned by §3 | ~90 |
| `g2Api.ts` (479) | **LEAVE — CUT** | §2 ruling (ADR 002 revision, flagged) | 0 |
| `shared/sentiment.ts` + test | **TAKE** | Whole → desktop `shared/` | ~80 |
| `gemini.ts` | **TAKE-PARTIAL** | `findCustomerSegmentQuotes` (5809–5933) → `agents/segmentQuotes.ts`; `analyzeSentiment` (7522–7743) + `scoreSentimentBatch` (7745–8044) → `agents/sentiment.ts`; `mergeSemanticallySimilarThemes` (8059–8163) → `agents/themes.ts` **repurposed as the §3.6.1 creation gate** (input becomes candidates + stored catalogue, not a single run's proposals); `aggregateFeedbackThemes` (8165–8489) → `agents/themes.ts` **reshaped as the residue-clustering step only** (prompt loses the "EVERY feedback entry must be assigned" constraint, gains "leave entries unassigned rather than force a grouping"; the classification step of §3.6.1 is **new code**, not in the SaaS); `extractFeatureFromReview` (8494–8545) + `extractFeaturesFromReviews` (8547–8625) → `agents/gatherFeedback.ts`; `getCompetitorReviews` (11516–12053) → `modules/competitors/agents/reviews.ts` (result type 11501–11515). **LEAVE:** `analyzeCustomerSegments` (4776–5020, onboarding sprint), `generateCustomerSegmentInsights` (5062–5555, **replaced** by the §3 rewrite — the JTBD/persona TypeScript interfaces at 5030–5060 port; the prompt and the run-with-no-evidence behaviour do not), `generateCustomerInsightsSummary` (5559–5807), `enrichCustomerSegmentBackground` (13586–13768, replaced by `service.ts` orchestration with the evidence gate), platform discovery (5939–6586), ICP/retention chat (22713–23455), coverage matrix / persona mapping (26210–26550) | ~1,650 |
| `scheduler.ts` | **TAKE-PARTIAL** | `normalizeThemeName` (113–130) → `agents/themes.ts`, extended to match aliases (§3.6.1); `consolidateThemes` (180–245) → **logic only**, folded into the §3.6.1 creation gate (does not port standalone); `pruneOrphanedThemesForProduct` (379–418) → `agents/themes.ts`; `scoreUnscoredFeedback` (330–362) → `agents/sentiment.ts`; `collectFeedbackForProduct` (538–1154) → `agents/gatherFeedback.ts` **reshaped**: profile-bridge blocks (590–645) deleted (§2), competitor/adjacent loops (744–870) deleted (entity agent owns them), MCP block (~873–1090) deferred, team routing call deleted; what remains is product mining + cross-allocation + feature extraction + sentiment pass (~250 lines); `aggregateThemesForProduct` (1422–1715) → **NOT ported as written** — the bridge (1444–1492) is deleted (§2), the competitor-theme fan-out is deleted (§2), and the name-keyed merge loop (1504–1592) is **replaced** by the §3.6.1 classify-first orchestration in `service.ts`; competitorReviews block (2849–2985) → logic of `modules/competitors/agents/reviews.ts` run + conditional-merge, re-keyed to entity, feedback-bridge tail deleted; schedule triggers (2451–2510) → registry entries. **LEAVE:** `routeFeedbackToTeams` (420–536), gap-fill (3721–3770), proactive feedback (3771–3900), bridge job (4062–4130), MCP syncs (4606–4700, 6661–6960), call recordings (4943–5100) | ~700 |
| `routes.ts` | **TAKE-PARTIAL** (bodies, reshaped to 3a paths/ids) | Feedback: manual POST (17508–17542), PATCH (17545), raw GET (17053), entries GET (17895), archive/unarchive (17920/17939), themes GET (17577), theme status PATCH (17787), collect POST (17958), aggregate POST (18052). Segments: list/get/create/patch/delete (36539/36659/36678/36727/36833), blocked-segments (36882/36899). Personas: 37030/37046/37076/37096. Sources: 34302/34326/34491. **LEAVE:** bulk delete (36783), consolidate/reclassify admin (36916/36992), theme→opportunity (17620/17809, roadmap sprint), team endpoints (17419/18114/18138), source refresh agent (34367) | ~500 |
| `storage.ts` | **TAKE-PARTIAL** (verbatim bodies, re-keyed to entity/facet where marked) | Feedback entries (2956–3068) + themes (3071–3143); feedback sources (3796–3843); segment profiles (4125–4372 — `getCustomerSegmentProfileByName` becomes an entity `normalizedName` lookup; `upsertCustomerSegmentProfile`'s blocklist check kept, its legacy-column handling dropped); personas (4374–4402, re-keyed `segmentEntityId` + facet CRUD added) | ~450 |
| `agentSeeder.ts` | **TAKE-PARTIAL** | Definitions: `sentiment-analysis-agent` (110–139), `competitor-reviews-agent` (791–825), `customer-quotes-agent` (993–1026), `gather-feedback-agent` (1080–1117) → append to `lib/agents/seed.ts`. `theme-aggregation-agent` (1118–1165): slug and metadata port; the seeded prompt is **split and rewritten** for the §3.6 run shape (the classification prompt is new; the clustering prompt derives from gemini.ts:8225–8330 minus total assignment). `customer-insights-agent` (1255–1280): slug and metadata port, **prompt is new** (§3.3) — the seeded SaaS prompt is the hallucination instruction and must not ship. **LEAVE:** `customer-segments-agent` (898–992, onboarding), `review-platforms-agent` (322–367), `customer-insights-summary-agent` (1464–1500) | ~350 |
| `lib/feedbackPoller.ts` (271) | **LEAVE** | Roadmap Review sprint (§1 re-homing) | 0 |
| Client `AddFeedbackDialog.tsx`, `CustomerSegmentProfileView.tsx`, `FeedbackTab*.tsx` | Reference only | Desktop client pages are new-built to the layout grammar against §6; the dialog's field set (source, topic, text, sentiment, reviewer) is the manual-add contract | — |

Landing estimate: ~4,750 ported + ~1,050 new (evidence ledger, rewritten insights agent, §3.6 classification step + creation gate, schemas, registry entries, tests). CI grep list (ADR 002 risk 2) extends with banned symbols: `g2Api`, `mergeQuotesWithAIGenerated`, `chatWithCustomerSegmentationICP`, `chatWithUserFeedbackAgent`, `generateCustomerInsightsSummary`, `routeFeedbackToTeams`.

---

## 6. API surface (product-scoped per ADR 003 §1.1; facet ids are the stable ids)

### 6.1 Segments

```
GET    /api/products/:productId/segments                 → { segments: SegmentCard[] }   (?include=proposed)
POST   /api/products/:productId/segments                 { name, description?, segmentType? }
       → 201 { segment, adopted }      # entity dedup/adoption exactly as competitors §2.3:
                                       # normalise → org entity lookup → adopt or create.
                                       # Owner-created facets are status:"tracked" (§7 rationale);
                                       # 409 on (product, entity) duplicate; blocklist honoured.
GET    /api/products/:productId/segments/:id             → { segment: SegmentDetail }
PATCH  /api/products/:productId/segments/:id             { name?, description?, segmentType?, icpFit?, isIcp?,
                                                           csatScore?, npsScore?, researchItems?, ... }
                                                         # name/description/type → entity row; rest → facet
POST   /api/products/:productId/segments/:id/accept      → 200 (proposed → tracked; no-op if tracked)
DELETE /api/products/:productId/segments/:id             → 204  # facet delete + entity GC on last facet
                                                                # (flat — no tree); writes the product-scoped
                                                                # deleted_customer_segment_names blocklist row
GET    /api/entities/segments                            → org vocabulary view (mirrors /entities/competitors)

SegmentCard { id /* facet id */, entityId, name, segmentType, status, isIcp, icpFit,
              personaCount, evidenceStatus: { count, distinctSources, newestAt,
              thresholds: { persona: 3, insights: 5 }, sufficientFor: string[] },
              enrichmentStatus, lastEnrichedAt }
SegmentDetail = SegmentCard & { description, needsSummary, needs[/* + evidenceRefs */], jobsToBeDone,
              overallSatisfaction /* computed, §3.4 */, csatScore, npsScore, quotes[], researchItems[],
              segmentInsights, opportunities, recommendations, personas: PersonaWithFacet[] }
```

### 6.2 Personas

```
GET    /api/products/:productId/segments/:id/personas    → { personas: PersonaWithFacet[] }
POST   /api/products/:productId/segments/:id/personas    { title, description?, demographics?, behaviours?,
                                                           facet?: { goals?, painPoints?, jobsToBeDone? } }
       → 201   # owner-created: persona identity (org, on the segment entity) + facet for THIS product,
               # status:"tracked", provenance owner
PATCH  /api/products/:productId/personas/:personaId      # identity fields → personas row; goals/painPoints/
                                                         # jobsToBeDone → this product's facet (server splits)
POST   /api/products/:productId/personas/:personaId/accept   → 200 (proposed facet → tracked)
DELETE /api/products/:productId/personas/:personaId      → 204  # deletes THIS product's facet; persona
                                                                # identity GC'd when zero facets remain
POST   /api/products/:productId/segments/:id/enrich      → 202 { runId } | 422 { error:"insufficient_evidence",
                                                                 evidenceStatus }   # §3.3 manual trigger
```

`PersonaWithFacet` embeds the facet (goals/painPoints/jobsToBeDone with their `evidenceRefs`) plus `facetStatus`, `provenance: "owner" | "agent"`, and computed evidence stats. A persona with no facet for the product is not returned (ADR 003 §2.6).

### 6.3 Feedback and themes

```
GET    /api/products/:productId/feedback                 ?isCompetitor&topic&archived&unfiled&limit&offset
POST   /api/products/:productId/feedback                 { quotedText, sourceName?, topic?, sentiment?,
                                                           reviewerName?, competitorEntityId? }
       → 201   # DIRECT-ADD, no gate (§7); sourceType "manual", verified true, provenance owner
PATCH  /api/products/:productId/feedback/:entryId        { topic?, sentiment?, archived? }
DELETE /api/products/:productId/feedback/:entryId        → 204
POST   /api/products/:productId/feedback/collect         → 202 { runId } | 409 { activeRun }   # mining run
GET    /api/products/:productId/themes                   → { themes: Theme[], unfiledCount }  # own-product only (§2)
PATCH  /api/products/:productId/themes/:themeId          { status?, themeName? /* human rename */ }
POST   /api/products/:productId/themes/:themeId/merge    { absorbThemeId }    # human merge; absorbed name → aliases (§3.6.1)
POST   /api/products/:productId/themes/aggregate         → 202 { runId } | 409   # runs the §3.6.1 classify-first pass

Theme { id, themeName, aliases, summary, status, priority, mentionCount, averageSentiment,
        evidence: { count, distinctSources }, confidence, coherence /* §3.5: computed pair surfaced */,
        feedbackEntryIds, consolidationSuggested /* §3.6.1 soft cap */, lastUpdatedAt }

GET    /api/products/:productId/feedback-sources         → { sources }           # manual CRUD
POST   /api/products/:productId/feedback-sources         { name, url, type }
DELETE /api/products/:productId/feedback-sources/:id
```

### 6.4 Competitor detail extension (competitors module, same sprint)

`GET /api/products/:productId/competitors/:id` gains a `reviews` block from the entity columns (with child→root fallback per ADR 003 §2.9.2): `{ averageRating, totalCount, platforms[], positiveThemes[], negativeThemes[], quotes: [{ text, source, sourceUrl, sentiment, date }] }`. `CompetitorCard.sentiment` and `reviewCount` stop being hardwired `null` — the two fields ADR 002 §6 reserved. All quotes carry `sourceUrl`; unverifiable quotes are stored but flagged `verified: false`, never silently dressed up.

MCP tools for segments/personas/feedback/themes follow at the MCP sprint against these same payloads (product parameter semantics per ADR 003 §1.2); `log_feedback` stays queue-gated per brief §4a.2 — the external-writer queue is not the same thing as the local owner's direct-add (§7).

---

## 7. Proposal gate application (decided, with rationale)

The brief's accept-gate primitive applies to **context-shaping objects** — the vocabulary other context hangs off. Ruling per object type:

| Object | Gate? | Rationale |
|---|---|---|
| Segment facet — **agent-created** (discovery, future theme→segment proposals) | **Proposed → accept** | Vocabulary creation by an agent is exactly what the gate exists for. Mechanics mirror competitors §2.3 (adoption of an existing org entity renders instantly; discard GCs the entity when last facet, and writes the product-scoped blocklist) |
| Segment facet — **owner-created** (manual POST) | **Tracked immediately** | Deliberate asymmetry with competitor POST, flagged: competitor add means "have the agent research X" — the researched output needs review. Segment manual add is data entry of the owner's own assertion; forcing them to accept their own typed words is ceremony without governance value. Provenance `owner` distinguishes it forever |
| Persona + facet — **agent-created** (§3 enrichment) | **Proposed → accept**, per facet | A persona is the most context-shaping object in the module (roadmap review and MCP consumers will cite it). Gate at the **facet**, per ADR 003 §2.3 "propose per facet, never org-wide": attaching an existing persona to another product is a new proposed facet |
| Persona — owner-created | Tracked immediately | Same as segments |
| **Feedback entries** | **Direct-add, no gate** | Observations, not vocabulary: they shape nothing until themes aggregate them; they are high-volume (a gate would train users to rubber-stamp, destroying the gate's meaning elsewhere); every entry carries provenance and archive/delete is the correction path; dedup + blocklists govern re-ingestion. The write-governance rule is satisfied by the seat boundary — only a full seat can add at all. External writers (MCP `log_feedback`, readers) still enter the §4a review queue — that queue is the upgrade moment, distinct from the local owner's direct-add |
| **Themes** | No gate; `status` stays a **triage flag** | Derived objects with evidence links, maintained classify-first (§3.6) — creation is machine-gated (distinctness + threshold + coherence), identity changes (rename/merge) are **human-only**, so an accept gate would be redundant with a stronger control. `needs_review` is a reading prompt, not a write gate — do not conflate the two statuses in client copy |
| Entity review columns (competitor mining, cross-allocation appends) | No gate | Agent maintenance of already-tracked context — same class as the updates scan writing `competitor_changes` |

Schema consequence: `customer_segment_profiles.status` and `persona_facets.status` (`proposed | tracked`, NOT NULL, default `'tracked'`) — the competitor gate column pattern (ADR 002 §9), additive (§8).

---

## 8. Migration needs (additive only — with two flags for the owner)

**Additive columns (fine post-freeze; land as the sprint's migration):**

1. `customer_segment_profiles.status` text NOT NULL DEFAULT `'tracked'` (§7)
2. `persona_facets.status` text NOT NULL DEFAULT `'tracked'` + `provenance` text (`'owner' | 'agent'`) on `personas` and `persona_facets`
3. `feedback_entries.competitorEntityId` varchar nullable + index — exactly the column ADR 003 §2.8 anticipated ("noted, not built" — 3b is the sprint that builds it)
4. `feedback_themes.confidence` integer, `coherence` integer (§3.5/§3.6 — computed stats need no columns; they derive from `feedbackEntryIds`)
5. `feedback_themes.aliases` jsonb — human-merge vocabulary for §3.6.1 matching (the unfiled state needs **no** column: derived from non-membership)
6. Evidence refs inside existing jsonb shapes (`needs`, `jobsToBeDone`, persona facet arrays) — Zod-contract changes, no DDL; free while the tables are empty

**Flagged for the owner — genuinely worth the last rewrite window if it is still open (zero external installs). Not silently done; ADR 002 risk-8 precedent:**

- **Drop the team plumbing baked into the baseline:** `feedback_entries.teamId`, `feedback_themes.teamId`, and the whole `team_assignment_signals` table. Teams are cut to team-tier; these are dead weight of the same kind as the battlecard columns risk 8 flagged, and 3b is the sprint that would otherwise start carrying them in every carve.
- **Drop name-keyed competitor identity from feedback:** `feedback_entries.competitorName` and `feedback_themes.isCompetitor`/`competitorName`. Name-keying is precisely the drift bug ADR 003 §2.4 just fixed for `competitor_changes`; freezing it into feedback identity at first release repeats it, and §2's cut of per-product competitor themes leaves the theme columns with no writer at all.
- **Fallback if the window is ruled closed:** items 1–5 above are sufficient; the name/team columns stay dormant — never written, never read, documented as dead in the schema comments. Correctness does not depend on the drop; cleanliness does.

Everything else (`mcp` source kinds, `document` evidence kind, call-recording links, theme→opportunity FKs) is reserved vocabulary — numbered migrations with their own sprints, cost of deferral ~zero.

---

## 9. Agents and scheduler registration

| Agent (slug) | Kind | Schedule key | Notes |
|---|---|---|---|
| `gather-feedback-agent` | **product** | `feedbackCollection` | Own-product mining → entries → feature topics → sentiment pass at run end (sentiment is a pipeline stage, not a scheduled agent) |
| `theme-aggregation-agent` | **product** | `themeAggregation` | §3.6.1 classify-first run: classify unfiled → residue clustering → creation gate → prune. Never re-derives, never renames |
| `competitor-reviews-agent` | **entity** | `competitorReviews` | Per entity node with ≥1 tracked facet, via `listEntityAgentTargets` — third registrant of the 3a entity kind; conditional-merge writes |
| `customer-quotes-agent` | **product** | `segmentQuotes` (new key) | Iterates the product's tracked segment facets; evidence gathering, web search ON |
| `customer-insights-agent` | **product** | `segmentInsights` (new key) | §3 synthesis; targets = facets passing the evidence threshold **only**; web search OFF |
| `sentiment-analysis-agent` | — | — | Seeded for prompt-override editing; invoked inside the pipeline, not independently scheduled |

`computeDefaultSchedules` extends with: `feedbackCollection`/`themeAggregation` at the audience-derived pipeline cadence (SaaS scheduler.ts:26–76 semantics; the MCP-connection daily override returns at the MCP sprint), `competitorReviews` at base frequency 09:00, `segmentQuotes` weekly, `segmentInsights` weekly offset after quotes (gather before synthesise). `agentSchedulesSchema` gains the two new keys (additive Zod). Catch-up-on-launch, frequency gates, circuit breaker: inherited unchanged from the registry — **this sprint must add zero files under `server/scheduler/`**; if it can't, the 3a pattern failed and we fix it there (ADR 002 §8.10 discipline).

The SaaS daily gap-fill (`runCustomerSegmentGapFillForAllProducts`) has **no successor**: its job — enrich every empty profile — is the anti-pattern §3 exists to kill. Its desktop analogue is the evidence gate excluding those targets plus Context Health saying so.

---

## 10. Risks and open questions

| # | Risk / question | Recommended resolution |
|---|---|---|
| 1 | **Evidence gate makes week one look empty** — a fresh install has segments with no personas and "insufficient evidence" everywhere; the SaaS looked richer by lying | This is the product's honesty pitch made visible; design the absence: `evidenceStatus` renders as a progress meter with concrete next actions ("add feedback", "run review mining", "add what you know" — owner path). Onboarding interview (module-scoped) should explicitly harvest owner-known personas/JTBD so day one has labelled `owner` context. Coordinate with the onboarding sprint |
| 2 | **No feedback→segment linkage exists** (SaaS entries carry no segmentId), so per-segment evidence attribution leans on quotes + owner items + product-wide themes | Accept for 3b; thresholds are calibrated to it. Do NOT bolt on LLM-guessed segment tagging (speculation re-entering by the side door). If real use demands it: additive `feedback_entries.segmentEntityId` set by humans or by cited inference behind its own review, later ADR |
| 3 | **Web-only review mining quality** (post-G2): hallucinated quotes/URLs are the classic failure | The ported validation pipeline is the countermeasure and must not be trimmed in port: URL soft-404 validation, `validateReviewContent` product-match + cross-allocation, `verified` flag honest, unverifiable quotes flagged not laundered. CI test with recorded fixtures |
| 4 | **Prefix-key dedup (100-char lowercase) ports as-is** — near-dup variants slip through | Keep for parity; `isNearDuplicateText` is now in `lib/text.ts` — wire it as a second-pass dedup on mined entries in 3b if cheap, else log a follow-up. Do not block the sprint on it |
| 5 | **Evidence-required schemas will reject more agent output** than the SaaS tolerated (risk-3 dynamic, sharpened by §3.3) | By design: a rejected parse is a visible failure on the execution row, not silent fabrication. Start persona threshold at 3 and monitor rejection rates in dogfood; tune thresholds, never the requirement |
| 6 | **Cross-allocation writes to competitor entities** could surprise ("why did feedback mining touch Mixpanel?") | Provenance on appended quotes (`sourceType: web_search`, fetchedAt) + the change is visible on the competitor object. Dropped-untracked-mention logging gives the audit trail |
| 7 | **Unfiled pool growth** (§3.6 residual): hopeless singletons re-enter residue clustering every run, burning spend without ever clearing the gate | Cap 300/run newest-first with rotation already bounds cost; if dogfood shows waste, add a cheap heuristic (skip entries that failed clustering N consecutive runs for a cooling-off period) — behaviour, no schema. The pool being visible (`unfiledCount`) is a feature: it is the honest backlog |
| 8 | **Sentiment rubric drift across BYO providers** (one-key desktop reality) | Extend the ADR 002 §4 CI matrix: rubric fixture prompts × each provider alone, assert scores within band |
| 9 | **Two statuses in one module** (facet `proposed/tracked` vs theme `needs_review`) invite client-copy confusion | Named distinctly in payloads; client uses different affordances: accept button vs triage chip. Decide final field naming at client wiring |
| 10 | **`quotes`/`researchItems` jsonb on the facet vs the evidence ledger** — two homes for near-identical data | Deliberate for 3b: jsonb shapes port intact (near-zero churn rule), the ledger *reads* them. If the Sources sprint normalises evidence into a table (likely, for documents), the ledger is the single consumer to repoint — that is why it exists as a file |
| 11 | **Coherence threshold calibration** (§3.6.1 step 4d): an elicited score gating creation may be provider-sensitive — too strict and nothing files; too lax and it gates nothing | The gate is conservative-only (blocks creation, never fabricates), so miscalibration degrades to "more unfiled" — visible and recoverable — never to duplicate themes, which was the SaaS failure. Add the coherence distribution to the §3.6.2 live-eval suite per provider; tune 70/85 from dogfood data, and treat any *distinctness* regression (§3.6.2 test 2) as a bug, never a tuning knob |

**Conflicts with ADRs 001–003 — flagged, not overridden:**

1. **ADR 002 §1 OUT table** ("G2: defer behind own-G2-key setting") → **revised to CUT** (§2). Grounds: dead platform credential under BYO; carrying it contradicts the evidence pipeline. Needs a one-line ADR 002 amendment note on acceptance.
2. **ADR 002 §5** `segmentNormalization` deferral + `mergeDifferentiators` inline TODO → fulfilled and re-homed (`lib/text.ts`); competitors service import swap in this sprint.
3. **ADR 002 §6** `CompetitorCard.sentiment/reviewCount: null until reviews sprint` → this is that sprint; contract fields populate, no shape change.
4. **ADR 003 §2.8** (feedback strictly product-scoped; optional `competitorEntityId` "noted, not built") → column built now (§8), scoping rule itself unchanged; per-product competitor *themes* are cut in favour of entity review themes (§2) — consistent with §2.8's own test ("same external referent, expensive observation → entity").
5. **Brief §3 keep-row** lists `lib/feedbackPoller.ts` under Customer Insights → re-homed to Roadmap Review (§1), keep verdict intact.
6. **Brief §5 step 1 "keep magical"** vs the evidence gate: onboarding magic for this module becomes *proposing segment vocabulary* (names/descriptions, gated), never fabricated personas. The onboarding sprint inherits this constraint from §3.1.
7. **Brief §10 constraint "merge, don't replace"** → §3.6 *strengthens* it for themes: the SaaS "merged" name-keyed re-derivations of the whole theme set (which silently replaced identity each run); classify-first makes the stored set the invariant and identity change a human act. Flagged as an interpretation, not a deviation.

---

### Summary of decisions

1. Sprint 3b ships the full slice: segments (entity+facet on the untouched 3a shapes) → personas with per-product facets → feedback in (manual + web-mined) → sentiment → evidence-linked themes with confidence → served; competitor review mining as the third entity-kind agent feeding both the competitor profile (sentiment/reviewCount/"What buyers say") and the feedback ledger. Discovery, platform discovery, uploads, MCP writers, poller, opportunities, chat assistants all out with named destinations.
2. **Evidence-grounding is structural:** the SaaS's hallucination sites (gemini.ts:5062–5555, 13586–13768; scheduler.ts:3721–3770) are named LEAVE; generation agents split into gatherers (web search, URL-cited output) and a synthesiser (no web search, enumerated-evidence input); Zod schemas require evidence refs (persona ≥3, claim ≥1, insights pool ≥5) verified against the ledger before persist; CSAT/NPS/satisfaction are owner-entered or computed, never estimated; owner assertions are first-class evidence with `owner` provenance; below-threshold targets are excluded from scheduling and the API serves the absence honestly.
3. **Theme maintenance is classify-first (§3.6, amendment):** stored themes are the classification catalogue — never re-derived, never renamed by the agent; only the unmatched residue may propose new themes, each of which must clear a creation-time distinctness gate (normalised name + aliases, semantic check against the stored set), the ≥3-entry threshold, and a coherence ≥ 70 bar — otherwise entries stay honestly unfiled. A soft cap at 15 active themes raises the bar and requests human consolidation; human rename/merge is alias-recorded. The SaaS failure mechanisms (wholesale re-derivation, within-run-only semantic dedup, string-only cross-run identity, forced total assignment, discarded quality scores) are each answered by a testable mechanism difference (§3.6.2).
4. Review strategy: G2 API cut (ADR 002 revision, flagged); web-search mining only; mined once per competitor entity with conditional-merge; cross-allocated mentions append to tracked entities and are dropped for untracked ones; the SaaS profile→feedback bridge and per-product competitor themes do not port.
5. Gate ruling: agent-created segment/persona facets are proposed→accept (per facet, ADR 003 §2.3 shape); owner-created are tracked with `owner` provenance; feedback entries are direct-add for full seats (external MCP writers stay queued per §4a); themes are ungated derived objects — creation machine-gated, identity human-only — with a triage status.
6. Migrations: additive only (gate/provenance/confidence/coherence/aliases columns + `feedback_entries.competitorEntityId`); the teamId columns, `team_assignment_signals`, and name-keyed feedback competitor columns are flagged for the last baseline window with the drop recommended and a dormant-column fallback if the window is ruled shut.
7. Zero new scheduler/infrastructure files: two product-kind registrations, one entity-kind, two new schedule keys, defaults extended — the 3a pattern's proof-of-generality sprint.
