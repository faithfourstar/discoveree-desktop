# ADR 003 — Multi-product organisations and cross-product entity identity

**Status:** Proposed · **Date:** 4 August 2026 · **Author:** Desktop architect (Claude Code)
**Amended 4 August 2026 (owner review):** §2.9 adds the competitor company → competitor-products hierarchy and add-flow name resolution; §2.1–2.5, §5, §6 adjusted accordingly.
**Context:** Build brief §4b (Commercial Model — the portfolio layer rolls it up), §7 (team-sharing ladder), §8 (one codebase, two deployments). Builds on ADR 001 (DB seam, tenancy decisions) and ADR 002 (module pattern, §9 proposal gate).
**Owner requirements (verbatim intent):** individual desktop users mostly work on one product, but security-conscious larger orgs — the desktop edition's strongest audience — will have multiple products per organisation; some people (leaders) need access across products; the end-state is leaders making investment decisions (expected revenue, growth, costs) *across* products — effectively setting business goals at portfolio level. Competitors and customer segments may be shared across products or product-specific; even when a persona/segment is shared, its jobs-to-be-done differ per product. **(Amendment)** Competitor companies frequently have multiple products, and different products in their portfolio compete against different products in ours (e.g. Xero's sub-branded products); users may type a company name or a product name when adding a competitor, and the add flow must resolve which they meant.

Current state this ADR starts from:

- Schema: `organizations → products` is already 1:many; every context table is product-scoped (`competitor_profiles.productId`, `customer_segment_profiles.productId`, …); users are org-scoped via `organization_users`; the SaaS `product_access`/`product_access_requests` tables were deliberately stripped in the port (ADR 001 §4a).
- Surface: `server/modules/products/routes.ts` exposes a **singular** `GET/PATCH /api/product`; `server/modules/competitors/routes.ts` resolves "the product" as `getProductsByOrganization(orgId)[0]`. Multi-product is schema-possible and surface-impossible today.
- Customer Insights has **not** been ported yet — the segment/persona tables exist in the desktop baseline but no code touches them. That is the window this ADR exists to use: the port must land on the right shape day one.

---

## 1. Multi-product surface enablement

### 1.1 Route convention: explicit `/api/products/:productId/...`

**Decision:** product-scoped resources move under an explicit product path segment. Org-scoped resources stay flat.

```
GET    /api/products                              # list (replaces GET /api/product)
POST   /api/products                              # create (onboarding "add a product")
GET    /api/products/:productId                   # detail
PATCH  /api/products/:productId

GET    /api/products/:productId/competitors       # facet surface (was /api/competitors)
POST   /api/products/:productId/competitors
GET    /api/products/:productId/competitors/:id   # :id remains the facet id (see §2.5)
POST   /api/products/:productId/competitors/:id/accept | /refresh
PATCH  /api/products/:productId/competitors/:id
GET    /api/products/:productId/changes           # product-relevant change feed (entity join, §2.4)

GET    /api/entities/competitors                  # org-level canonical entities (read + entity-fact edits)
GET    /api/entities/competitors/:entityId
GET    /api/portfolio/...                         # org-level portfolio goals (later, §3)
GET    /api/settings, /api/connections, ...       # org-scoped, flat as today
```

A `productContext` middleware (sibling of `localIdentity`, ADR 002 §2) resolves `:productId`, verifies it belongs to `req.ctx.organizationId`, and sets `req.ctx.productId`. Handlers stop calling `findProduct(orgId)`; the `products[0]` convention is deleted, not deprecated.

**Rejected alternatives:**

- **Product context header (`X-Product-Id`).** Implicit state breaks everything the brief values: URLs stop being self-describing, curl/MCP debugging needs invisible headers, browser tabs on two products (team mode serves the SPA to browsers) share one header context, and HTTP caching keys wrongly. Headers are for auth, not for addressing.
- **Flat routes + `?productId=` query param.** Trivially omitted; every handler grows a "which product?" fallback branch, which is exactly the `products[0]` bug generalised. Optional scoping is how cross-product data leaks happen in team mode.
- **Keeping `/api/competitors` as a permanent alias for "the only product".** Two ways to address one resource is a fork in miniature. There are zero external API consumers before first release — hard cutover now is free; an alias would never be removable later.

**Migration plan for the existing surface (sprint-shaped, before first release):**

1. `products` module: replace singular `GET/PATCH /api/product` with the collection routes above. The client's onboarding PATCH-to-create becomes `POST /api/products`.
2. Add `productContext` middleware in `server/http/`; mount the competitors router at `/api/products/:productId` instead of `/api`.
3. Delete `findProduct`/`requireProduct` from `modules/competitors/routes.ts`; handlers read `req.ctx.productId`. Storage signatures already take `productId` explicitly (ADR 002 §3 convention) — they do not change.
4. Client: `apiUrl()` calls gain the product segment; TanStack Query keys gain `productId` (they must anyway for a switcher).

This is mechanical (~1 day including client) because ADR 002's conventions anticipated it: org-scoping from `req.ctx`, product ids passed explicitly into storage.

### 1.2 Product switcher and what "active product" means

- **Client shell:** the active product is **URL state**, nothing else — routes become `/p/:productSlug/...` (or id), the switcher is a nav control that rewrites the URL prefix. No "current product" in localStorage or a context provider divorced from the URL: deep links, browser tabs per product, and team-mode shareable URLs all fall out of URL-as-state. Single-product orgs (the common desktop case): the switcher control simply doesn't render until a second product exists — same "blocks materialise only when populated" grammar as everything else (brief §6). The Context Health home gains a per-product dimension: one product → today's home; multiple → a product strip above the module cards, plus the org-level MCP/portfolio panel.
- **MCP tools:** every product-scoped tool gains an optional `product` parameter (accepts id or slug). Resolution: omitted + one product → that product; omitted + several → the tool returns the product list and asks the caller to specify (a deterministic, self-describing error — never a silent default to `products[0]`). Add a `list_products` tool. Org-level tools (entities, portfolio) take no product param. The `.mcp.json`-in-repo pattern from brief §8 gets its natural meaning here: `discoveree mcp serve --product <slug>` pins the served scope for a Claude Code project — one product repo, one product's context.
- **Scheduler and agents: there is no "active product".** The tick already iterates products × registered agents (ADR 002 §7); a product is never skipped because it isn't on screen. What changes is a second registration kind — see §2.7: entity-scoped agents iterate org × entities, not products × agents. Catch-up-on-launch orders by product, then module, and entity agents run once per entity regardless of how many products face them — a direct cost saving the sales copy can use ("track Mixpanel from five products, research it once").

---

## 2. THE CORE: canonical entities with product-scoped facets

### 2.1 The model

One org-level **entity** carries the facts that are true regardless of which of our products looks at it (researched and monitored **once per org**). One **facet** per (entity node, product) carries everything relative to that product. The facet is where the proposal gate, threat assessment, and comparisons live; the entity is where identity, monitoring, and expensive research live. Competitor entities form a **two-level tree** (company → their sub-branded products, §2.9); single-product competitors are a single root node and never see the hierarchy.

```
organizations ─┬─ products ──────────────┐
               ├─ competitor_entities ─── competitor_profiles (facet: entityId + productId)
               │      └─ (self-ref: parentEntityId — company → their products, §2.9)
               ├─ segment_entities ────── customer_segment_profiles (facet: entityId + productId)
               │        └─ personas ───── persona_facets (personaId + productId)
               └─ (portfolio tables, §3)
```

**Rejected alternatives (whole-model):**

- **Status quo: duplicate per-product rows.** Product B adding Mixpanel re-researches everything Product A already knows, the two profiles drift, changelog monitoring runs twice against the same URL, and MCP serves two contradictory Mixpanels to the org's AI. This is precisely the "silent duplicates and drift" the brief's §10a.1 positions against — we cannot ship it in our own schema.
- **Org-level everything (no facets).** Threat level, classification, differentiators, JTBD are meaningless without a "relative to which product?" — the owner's requirement states this explicitly for segments/personas. A single org-level threat level is wrong for any org with two products.
- **Facet-as-jsonb on the entity row (`perProduct: {productId: {...}}`).** Un-indexable, un-FK-able, merge-hostile, and invisible to Drizzle/Zod typing — the exact anti-pattern the desktop port has been removing (`products.competitors` jsonb, ADR 002 §3).
- **Deferring the split until a multi-product customer exists.** The split is a baseline-schema question (§5). After first release the same change becomes a data migration executing dedup heuristics unattended on customer machines. The window argument decides the timing, not the demand argument.

### 2.2 Competitors: entity vs facet column split

New table `competitor_entities` (org-scoped); the existing `competitor_profiles` **keeps its name and becomes the facet** — "the profile of this competitor *as seen by this product*" is semantically accurate, and keeping the name preserves most of the sprint-2 storage/service code shape. It gains `entityId` (NOT NULL FK) and loses the entity-fact columns. `entityId` may reference either a company node or one of its product nodes (§2.9); the split below is unchanged either way — facts live on whichever node they are observed at.

**Moves to `competitor_entities`** (facts about the company or one of its products — identical from every product's viewpoint):

| Group | Columns |
|---|---|
| Identity | `name` (from `competitorName`), `normalizedName` (new — dedup key), `parentEntityId` (new, nullable self-FK — §2.9), `url` + `urlSource`, `parentCompany`\*, `description` + `descriptionSourceUrl` + `summaryCitations` |
| Their product facts | `keyFeatures`, `markets`, `customerSegments` (the competitor's own target segments), `integrations` |
| Pricing | `pricing`, `pricingSourceUrl`, `pricingTiers`, `pricingFreeTrial`, `pricingNotes` |
| Reviews (absolute) | `reviews`, `reviewPlatforms`, `reviewPositiveThemes`, `reviewNegativeThemes`, `reviewAverageRating`, `reviewTotalCount` |
| Monitoring state | `helpCenterUrl` + source, `changelogUrl`/`SourceUrl`/`ContentHash`/`LastCheckedAt`, `githubRepoUrl`, `githubStats`, `validReleaseSources`, `announcements`, `announcementsAnalysis`, `investorRelations` |
| Enrichment meta | its own `enrichmentStatus`, `lastEnrichedAt` (entity agents, §2.7) |
| User fact-corrections | `userNews`, `userPricing`, `userFeatures`, `userIntegrations`, `userReviews` — a manual correction of a *fact about the competitor* should be seen by every product (and single-writer governance means one person maintains it anyway) |

\* `parentCompany` (a plain text label, e.g. "Sage" owning AutoEntry) survives for **corporate ownership outside the tracked tree** — it is not the hierarchy mechanism; `parentEntityId` is (§2.9).

Unique index: `(organizationId, normalizedName)` — sub-brand product names are stored fully qualified ("Xero Payroll", never bare "Payroll"), which the resolution agent (§2.9.3) enforces, so org-wide uniqueness holds across the tree. Second lookup key on domain extracted from `url`.

**Stays on the `competitor_profiles` facet** (relative to *our* product):

- `productId`, `entityId`, `sourceCategory` (DIRECT/ADJACENT classification **is per product** — Mixpanel can be direct for one product and adjacent for another), `status` (`proposed | tracked` — the gate, §2.3), `threatLevel`
- `keyDifferentiators` (theirs vs *us*), `featureStrengthSummary`, `pricingAnalysis` (explicitly "vs own product"), `integrationAnalysis` (contains `vsOwnProduct`), `featurePersonaMapping` (against *our* personas)
- `userSummary` (judgment call: it overlays the facet's rendered positioning/differentiators view; the fact-shaped `user*` columns moved to the entity)
- facet `enrichmentStatus`/`lastEnrichedAt` (facet agents: differentiators, comparisons)
- `competitor_threat_level_history` unchanged — already `productId` + `competitorProfileId` scoped; threat is a facet concept.

The `isOwnProduct` convention (`sourceCategory: "own_product"`) survives cleanly: each of the org's own products gets a `competitor_entities` row too, and its self-facet carries the marker. Bonus the SaaS never had: Product A can hold an ordinary facet on Product B's entity — sister products that genuinely compete (it happens in portfolios) need zero special casing.

### 2.3 The proposal gate applies at the facet, and adoption is the dedup flow

**Decision: propose per facet, never org-wide.** Tracking is a per-product judgment; auto-tracking Mixpanel for Product B because Product A tracks it would write into Product B's context without a human accept — a straight violation of the write-governance rule. The ADR 002 §9 contract is unchanged in shape; only its subject is now the facet.

`POST /api/products/:productId/competitors { name, url? }`:

1. Normalise the name + extract the domain; look up `competitor_entities` for the org (domain first, then `normalizedName`) — the lookup spans **both tree levels**, so a typed "Xero Payroll" matches an existing child node and a typed "Xero" matches the root (§2.9.3 handles the ambiguous cases).
2. **Entity node exists** (the "Product B starts tracking Mixpanel" case): create a **proposed facet** referencing it. No entity re-research — the proposal card renders the entity's existing profile instantly (this is the adoption moment, and it should *feel* like adoption: "Already researched for [Product A] — reviewing for [Product B]"). Only facet-scoped agents run (differentiators, comparisons vs this product). If a facet for this node already exists on this product → 409, same as today's duplicate-name rule.
3. **No entity**: create entity + proposed facet together; entity enrichment (summary, features, pricing …) and facet enrichment both run. The enrichment pipeline's first step is now **name resolution** (§2.9.3), which may restructure the proposal into company + product nodes before the user accepts.
4. **Discard of a proposed facet** (DELETE while `proposed`): delete the facet, then apply **tree-level GC**: if zero facets remain anywhere on the entity's tree, delete the whole tree — root, children (including identity-only siblings), and their change rows — preserving §9's "a proposal that was never accepted leaves no history". If any facet survives elsewhere on the tree, the tree stays: the discarded node's draft change rows are purged, roots always survive, and a now-unfaceted **child** is **demoted to an identity-only row** (enriched columns cleared, name/url kept — §2.9.3) rather than deleted, so the tree's known portfolio stays complete for future matching. Product A's tracked context is never collateral damage of Product B's discard. *(Ruling 4 Aug 2026: this supersedes the earlier "delete the unfaceted node" wording, which conflicted with §2.9.3's identity-only siblings; the one implementation correction vs current code is demote-not-delete for the child case, unreachable until the resolution agent ships.)*
5. Deleting a **tracked** facet keeps the entity while any other facet references its tree; the last facet on the tree deleted → tree and changes deleted (matches today's semantics exactly; revisit if anyone asks for org-level "archived" entities).

The entity itself has **no status column**: its lifecycle is derived from its facets. Rejected: entity-level `proposed` state — it creates a two-stage accept (accept the company, then accept tracking it) that no user story needs.

### 2.4 `competitor_changes` moves to the entity — and resolves the ADR 002 §9 known edge

A changelog release is observed once, about the entity — running hash-diff monitoring per facet is duplicated spend and duplicated rows.

**Decision:** `competitor_changes` is re-keyed: gains `entityId` (NOT NULL FK — company or product node, wherever the change was observed), drops `productId` and `competitorName`. A product's change feed (`GET /api/products/:productId/changes`) becomes a join: changes of entity nodes for which this product has a **tracked** facet, **plus company-node changes of any parent of a tracked child facet** (tracking Xero Payroll means Xero's company-level announcements are still your news — one extra one-level join, no schema). The §9 feed-exclusion rule ("never show changes for proposed competitors") becomes the join predicate instead of a name-based filter, and the §9 known edge (name-keyed history colliding across delete/re-propose cycles) is resolved by the FK this re-key provides — this is the "profile FK on competitor_changes, deferred until a sprint needs it" arriving as an entity FK. The transactional rename plumbing (`renameCompetitorProfile` walking name-keyed change rows) simplifies to a rename on the entity row.

Deliberately **not** built now: per-(facet, change) relevance annotations ("this Mixpanel release matters to Product A, not B"). The evaluative agents can compute relevance at read time; a `competitor_change_relevance` table is a numbered migration when a real feed proves noisy. Do not pre-build it.

### 2.5 API and MCP identity: facet id stays the competitor id

`GET /api/products/:productId/competitors/:id` keeps the **facet id** as `:id` — it is the stable ID the sprint-2 client and future MCP consumers key on, and it is the per-product object the brief's layout grammar links to. The card/detail payload gains `entityId` plus, when the facet points into a tree, the resolved lineage (`entity: { id, name, parent: { id, name } | null }`), enabling cross-product linking ("also tracked by …"), the org-level entity views, and honest card copy ("Xero Payroll — part of Xero"). MCP: product-scoped tools return facets (with embedded entity facts, joined server-side — consumers see one merged competitor object and never assemble the join themselves); an org-level `get_competitor_entity` / "which products track X" tool joins facets by entity, and for company nodes lists their product nodes.

### 2.6 Customer segments and personas (lands BEFORE the Customer Insights port)

The port must create these shapes day one — there is no legacy desktop data to migrate, which is exactly why this ADR precedes it.

- **`segment_entities` (org):** `id`, `organizationId`, `name`, `normalizedName` (via the ported `segmentNormalization.normalizeSegmentName` — it exists for precisely this job), `segmentType` (`customer_segment | industry_vertical | primary_persona | partnership`), `description`, `sourceUrl`. Unique `(organizationId, normalizedName)`. This is the "one segment vocabulary, not two" the brief §4b demands for the Commercial Model cross-link — commercial revenue-by-segment will reference `segment_entities.id`, not a name string.
- **`customer_segment_profiles` becomes the facet** (keeps its name, same reasoning as competitors): `productId` + `segmentEntityId`; keeps everything that only means something against a product — `jobsToBeDone` (the owner's explicit per-product requirement), `needs`/`needsSummary`/`overallSatisfaction`, CSAT/NPS scores + comments (satisfaction is satisfaction *with a product*), analytics comments, `researchItems`, `quotes`, `icpFit`/`isIcp` (ICP is per product), `opportunities`, `recommendations`, `segmentInsights`, previous-score tracking, enrichment meta. Drops `segmentName`/`segmentDescription`/`segmentType`/`sourceUrl` (→ entity). The legacy single-persona columns on the profile (`personaTitle` … `personaBehaviors`) are **not ported** — the multi-persona table was already the real model in the SaaS; the port starts clean.
- **`personas` (org, replaces `customer_segment_personas`):** `segmentEntityId` FK; identity attributes that describe the *person*, not the relationship to a product: `title`, `description`, `demographics`, `behaviours`, `sortOrder`.
- **`persona_facets` (per product):** `personaId` + `productId`; `goals`, `painPoints`, `jobsToBeDone`. This is the owner's "even when a persona is shared, its JTBD differ per product" made literal. A persona with no facet for a product simply isn't part of that product's context.
- `deleted_customer_segment_names` blocklist stays **product-scoped**: it suppresses re-*proposal* for a product (a facet-level concern). Deleting a facet must never blocklist the entity org-wide — Product A's segment survives Product B's cleanup.
- `customer_call_recordings.segmentId` re-points to the **facet id** (a call happens in the context of a product conversation); a later migration can add `segmentEntityId` if org-level call mining wants it.

Segment entities are deliberately **flat** — no `parentEntityId`. Segment hierarchies (industry → sub-vertical) are a taxonomy problem the SaaS never had evidence for; do not import the competitor tree here speculatively.

Rejected: fully org-level personas including goals/painPoints (the current SaaS shape, roughly) — contradicts the stated requirement; and fully per-product personas (duplicate persona identity rows per product) — re-creates the drift problem one level down.

### 2.7 Scheduler consequence (flagged as an ADR 002 §7 refinement, not an override)

The `ScheduledAgent` registry is product-scoped (`run(product)`). Entity-level agents (changelog hash-diff, announcements, pricing refresh, GitHub stats, review mining) need an **entity-scoped registration kind**: `run(entity)` iterated over org × entity nodes on trees with ≥1 tracked facet, frequency-gated per agent + entity node. An agent runs against whichever nodes carry its inputs (changelog watch runs where `changelogUrl` is set — company node, product node, or both), so the hierarchy needs no scheduler special-casing. Concretely: `ai_agent_executions` gains a nullable `entityId` column (baseline, §5) so `getLastExecutionForAgentAndProduct` gets an entity twin and the gates/circuit-breaker/catch-up machinery is reused unchanged. Facet agents (differentiators, comparisons, JTBD enrichment) stay product-scoped. Single-writer is untouched: one process still owns all writes; entities merely deduplicate *what* it writes.

### 2.8 What stays product-scoped entirely, and why

| Stays per-product | Why |
|---|---|
| `feedback_entries`, `feedback_themes` | Feedback is *about a product* — its collection context, sentiment, and theming are meaningless rolled to org level. (Reviews sprint may add an optional `competitorEntityId` to competitor-flagged entries; noted, not built.) |
| `product_features`, `product_help_articles` | The own-product evidence base is by definition per product. |
| Roadmap: `opportunities`, `roadmap_recommendations`, `roadmap_summaries`, Jira/Linear sync config | You ship roadmaps per product; the review agent's join is per product. Portfolio-level judgment (§3) *reads across* these, it does not merge them. |
| Strategy narrative, goals (`products.businessGoals`, goal layers/periods), deep dives, `market_reviews`, `idea_assessments`, `thought_partner_conversations` | Vision/pillars/goals are the product's strategy. The org-level analogue is the portfolio layer (§3), a separate object — not a shared entity with facets, because two products never "share" a pillar the way they share Mixpanel. |
| `teams`, `mcp_connections` (product-scoped ones), agent schedules | Operational plumbing of a product. |

The test: an entity/facet split pays only when **the same external referent** is observed by multiple products and the observation is expensive or drift-prone. Competitors and segments qualify; nothing in the table above does.

### 2.9 Competitor company → competitor products hierarchy (amendment, 4 Aug 2026)

The owner's Xero case: one competitor *company* with several sub-branded *products*, where "Xero Payroll" competes with our Product A and a different Xero product competes with our Product B. The entity model must express both grains without complicating the common case (a single-product competitor).

#### 2.9.1 Structure: self-referencing `competitor_entities`, not a separate table

**Decision:** `competitor_entities` gains `parentEntityId` (nullable self-FK). A root node (parent null) is the company; child nodes are its sub-branded products. **Maximum depth is 2**, enforced as a service-layer invariant (a parent must itself have `parentEntityId IS NULL`) — divisions-of-divisions is corporate genealogy, not competitive intelligence. A single-product competitor is **one root node with no children** — structurally identical to today, which is what keeps the common case simple: no synthetic "default product" rows, no hierarchy visible anywhere until a second grain actually exists.

Column placement follows one rule: **facts live on the node where they are observed.** Company-wide monitoring (company changelog, GitHub org, announcements, investor relations, reviews where review sites treat the brand as one product) sits on the root; product-level facts (features, pricing, a product-specific changelog or repo where one exists) sit on the child. All columns exist once on the one table — a child simply leaves company-only columns null and vice versa. For the single-node competitor, everything sits on the root, exactly as §2.2 already specified.

**Rejected: a separate `competitor_products` table.** It forces a polymorphic problem everywhere the entity is referenced: `competitor_profiles.entityId`, `competitor_changes.entityId`, and `ai_agent_executions.entityId` would each need either dual nullable FKs (entity XOR competitor-product — un-enforceable in SQL without check-constraint gymnastics, and toxic to every join) or facets pinned to company grain with a side-link to the product, which fails the "their product X ↔ our product Y" requirement outright. It would also duplicate the fact-column set across two tables, because single-product competitors keep features/pricing on the company row regardless. Two node kinds but one referent type is exactly what a self-reference is for.

**Also rejected: modelling their products as rows in a generic products-like table shared with our own `products`.** Our products carry strategy, goals, schedules, onboarding state; theirs carry observed facts. One overloaded table serving both is the `gemini.ts` of schemas.

#### 2.9.2 Facet grain: "their product X ↔ our product Y", with company-level fallback

A facet's `entityId` may point at **either grain**:

- **Child-grain facet** — `(our Product A, Xero Payroll)`: the precise competitive relationship. Differentiators, threat level, and comparisons are computed against the child node's facts, falling back to the root's facts for anything the child doesn't carry (description, company news).
- **Company-grain facet** — `(our Product B, Mixpanel)`: the fallback and the overwhelmingly common case. A competitor whose portfolio is irrelevant to us never grows children, and nothing in §2.2–§2.5 changes for it. **Small competitors are never forced through the hierarchy.**

Rules: the existing 409 duplicate check is per `(productId, entityId)` node — so our Product A may hold facets on two different Xero children (legitimately competing with two of their products), but not two facets on the same node. Holding a company-grain facet *and* a child-grain facet on the same tree from the same product is permitted but the add flow steers away from it (§2.9.3); it is not worth a constraint. **Re-graining** an existing company-grain facet ("you actually compete with their Payroll product") is a facet update proposed by an agent through the standard proposal→accept queue — a context change, never automatic. That behaviour is additive, post-3a.

The change feed already handles the hierarchy (§2.4): child-grain facets pull their node's changes plus the parent's company-level changes.

#### 2.9.3 Add-flow name resolution (rides the existing proposal gate)

Users type "Xero", "Xero Payroll", "Payroll", or paste a URL — company and product names differ under sub-branding, and the flow must resolve which they meant. **Decision: resolution is the first step of enrichment for a new entity, and its output restructures the *proposal*, never tracked data.**

1. Dedup lookup (§2.3 step 1) runs across both tree levels first — an existing node match short-circuits resolution entirely (adoption flow as designed).
2. For a new entity, a **resolution agent** (one Zod-validated LLM call with web search, folded into the front of the existing summary agent run — not a new scheduled agent) classifies the typed input: *(a)* standalone company/product → single root node, today's flow, no hierarchy UI; *(b)* a company with a multi-product portfolio → root node + the portfolio's product nodes (names stored fully qualified, §2.2) and a **best-guess child** for which of their products competes with our product; *(c)* a sub-brand product name → that child, with its parent company inferred and matched-or-created as root.
3. The proposal card presents the resolution for confirmation: *"Xero is a company with several products — you appear to compete with Xero Payroll."* The user can confirm the suggested child, switch to another listed child, or choose company grain ("compete with Xero as a whole"). This is ordinary §9 mechanics — nothing is tracked until accept, and the §2.3 discard rule GCs the whole proposed tree (root + unfaceted children) if abandoned. Sibling child nodes created during resolution but never faceted are kept as **identity-only rows** (names + urls, no enrichment spend): a later add from any of our products matches them instantly, they cost nothing, and they are invisible outside the org entity view. *Lifecycle ruling (4 Aug 2026, aligning with §2.3 step 4):* identity-only children are **kept** while any facet exists anywhere on their tree — they are matching vocabulary, not history — and are GC'd only with the whole tree; a child whose last facet is discarded while the tree survives joins them by demotion (enrichment cleared, draft changes purged) rather than deletion.
4. Enrichment then runs at the accepted grain: entity agents fill the faceted node (plus company basics on its root); unfaceted siblings are not enriched.

Rejected: resolving *after* accept (silently converting a tracked company-grain facet to child grain later) — a write to tracked context without a human decision; and asking the user "company or product?" before research runs — the agent should do the work and present a conclusion, per the brief's "keep magical" onboarding principle (§5 step 1).

#### 2.9.4 Baseline vs additive for this amendment

Correctness requires exactly **one schema change**: `competitor_entities.parentEntityId` (nullable self-FK), in the sprint 3a baseline (§5). Everything downstream already keys on `entityId`, which now simply spans both grains: facets, changes, and executions need **no further schema change**. The fully-qualified-name convention keeps the `(organizationId, normalizedName)` unique index valid across the tree.

Additive afterwards — behaviour, not schema: the resolution agent and its proposal-card UI (until it ships, every add creates a root node, which remains *correct*, just less precise — resolution upgrades precision, not validity); the parent-changes feed join (a query change); re-grain proposals; child-node enrichment. None of it blocks the Customer Insights port.

---

## 3. Portfolio level (schema shape only — module design is a later ADR)

The end-state: leaders set business goals and make investment decisions across products, using per-product Commercial Model data (brief §4b) rolled up to org. Reserve these shapes now; **build nothing yet**:

```ts
// Org-level goals — the portfolio analogue of products.businessGoals
portfolio_goals: {
  id, organizationId, description, goalMetric, target, baseline,
  currency, periodLabel, createdAt, updatedAt
}

// How a portfolio goal decomposes across products (the investment-allocation join)
portfolio_goal_allocations: {
  id, portfolioGoalId, productId,
  expectedContribution,          // numeric, in the goal's metric
  notes, createdAt, updatedAt
}

// Per-product commercial figures per period — §4b's revenue/growth/cost data,
// one row per (product, period); org rollup is a GROUP BY, not a table.
// Final naming/columns belong to the Commercial Model ADR; the shape reserved
// here is what the portfolio layer needs from it:
product_commercial_snapshots: {
  id, productId, periodLabel,
  expectedRevenue, actualRevenue, expectedGrowthPct, costs,   // money as integer minor units + currency
  currency, source /* 'manual' | 'billing' | 'crm' | ... */, provenance jsonb,
  createdAt, updatedAt
}
```

Design constraints recorded for that later ADR: money is integer minor units + explicit currency (mixed-currency portfolios exist; rollup handles conversion at read time, never stores converted values); every snapshot row carries provenance and source kind per brief §4a/§4b; revenue-by-segment references `segment_entities.id` (§2.6). Per-product `products.businessGoals` jsonb is untouched — portfolio goals are a new org-level object, not a refactor of product goals. All three tables arrive as **numbered migrations with the Commercial Model / portfolio sprint** (§5: deferral is free — they are new tables with no upgrade path to break).

Rejected: putting portfolio goals in a jsonb column on `organizations` (the `products.businessGoals` pattern) — allocations need FKs to products and the roadmap-review agent will join over them; and modelling the portfolio as a pseudo-"product" row — it would leak into every products-iteration (scheduler, switcher, MCP list) and need special-casing forever.

---

## 4. Access model

**Desktop solo (now): nothing.** `localIdentity` grants the single seeded user the whole org; a solo user with three products sees all three. No `product_access` table in the baseline — this ADR **confirms** the ADR 001 strip, with the return path below.

**Rung-1 read-sharing / MCP readers (v1):** visibility is **org-level configuration, not per-user ACL** — per-module × per-audience flags (e.g. "commercial context: excluded from reader MCP surface", the §4b default), enforced in the MCP read layer against the key's audience (`mcp_api_keys` rows are the reader identity and already carry `createdByUserId`). Product-scoping a reader key (this key serves only Product A's context) is a cheap, useful v1 control for the security-conscious multi-product org: add a nullable `productId` to `mcp_api_keys` when the MCP sprint lands (numbered migration, or fold into baseline if the window is still open then). This composes with §4b module visibility: the served surface = (products the key may read) × (modules visible to readers). The full §4b sensitivity design stays owned by the Commercial Model ADR.

**Team tier (rung 3): `product_access` returns**, as a numbered migration, in its SaaS shape (`userId`, `productId`, `role`) plus the rule that makes leaders work without enumerating rows:

- `organization_users.role = 'Leader'` or `isAdmin = true` ⇒ implicit access to **all** products (current and future — a leader is not re-granted per product launch). The `role` column already exists with exactly this vocabulary; no schema change needed now.
- Everyone else: `product_access` rows enumerate their products; `productContext` middleware gains the check (one predicate in one middleware — the payoff of §1.1's explicit route scoping).
- Entity-level data follows a derived rule: a user may read an entity tree iff they may read ≥1 product with a facet on it; entity **writes** (fact corrections) require a full seat on such a product. Portfolio tables (§3) are leader/admin-only by default.
- `product_access_requests` returns only if the team tier wants self-serve access requests; not a schema commitment now.

Rejected: carrying `product_access` in the desktop baseline "to be ready" — dead ACL tables in a single-user app are exactly the dead weight ADR 001 §4 refused, and its return is additive (new table + one middleware predicate), so deferral costs nothing.

---

## 5. Migration path — what must be baseline vs numbered migrations

Standing rule this ADR proposes: **the baseline may be rewritten until the first public release; the moment a build ships to an outsider, `0000_baseline.sql` is frozen forever** and everything is numbered migrations. We are inside the window, and this is the last big rewrite it should absorb.

**Must land in the baseline now (cost of deferring: HIGH):**

| Change | Why baseline |
|---|---|
| `competitor_entities` + entity/facet column split of `competitor_profiles` (§2.2), `entityId` NOT NULL | Deferred, this becomes an unattended data migration on customer machines running dedup heuristics over live data (splitting rows, merging same-name competitors across products). Done now it is a schema statement plus a deterministic dev-data script. |
| `competitor_entities.parentEntityId` (nullable self-FK) (§2.9) | One column, and the whole company→product hierarchy hangs off it. Adding a column later is easy — but shipping v1 without it bakes "entity = company = product" into MCP payloads and agent prompts that first release then freezes. The behaviour on top (§2.9.3) is additive; the key is not. |
| `competitor_changes` re-key to `entityId` (§2.4) | Same table, same argument — and first release freezes the MCP/API payload shapes; the change feed's identity model must be right before any customer's AI config depends on it (brief §10a.1 stable-ID promise). |
| `ai_agent_executions.entityId` (nullable) (§2.7) | One column; retrofitting the frequency-gate key post-release means a gate-history discontinuity for every entity agent. |
| `segment_entities` / facet-shape `customer_segment_profiles` / `personas` / `persona_facets` (§2.6) | The tables are *already in the baseline* in the wrong (SaaS) shape with zero code using them. Reshape now while nothing reads them; landing the port on the old shape and migrating later is pure waste. |
| Route convention `/api/products/:productId/...` (§1.1) | Not schema, but same freeze: first release makes API paths and MCP tool signatures a public contract. |

**Numbered migrations later (cost of deferring: ~zero — all additive new tables/columns):** portfolio tables (§3), `product_access` (+ requests) at team tier (§4), `mcp_api_keys.productId` at the MCP sprint (§4), `competitor_change_relevance` if ever needed (§2.4), optional `feedback_entries.competitorEntityId` at the reviews sprint (§2.8).

**Additive behaviour, no schema (§2.9.4):** the add-flow resolution agent + proposal-card resolution UI, parent-changes feed join, re-grain proposals, child-node enrichment. Until the resolution agent ships, every add creates a root node — correct, just less precise.

**Upgrade path for existing sprint-2 data shapes** (single product, per-product competitor rows — dev/dogfood installs only):

- Preferred: regenerate `0000_baseline.sql`; dev installs delete `<dataDir>/db/` and re-onboard (ADR 002 §9 already exercised this "zero-installs baseline rewrite" precedent).
- If any dogfood data must survive, the transform is deterministic and small: per org, group `competitor_profiles` by `normalizedName(competitorName)` (single-product installs have no cross-product duplicates, so grouping is 1:1) → insert `competitor_entities` from the entity columns (**all as root nodes** — sprint-2 data has no hierarchy to infer, and none should be invented) → set `entityId` → drop moved columns; backfill `competitor_changes.entityId` via `(productId, competitorName)` join, then drop those two columns. Ship it as a one-off script in `scripts/`, **not** as a numbered migration (per ADR 001 §3, migrations serve released schemas; pre-release dev data is not a released schema).

**Conflicts with ADR 001/002 — flagged, not silently overridden:**

1. **ADR 002 §3** "`competitor_profiles` is the single source of truth" → *refined*: entity + facet are jointly canonical; the facet remains the product-scoped source of truth and the API's stable ID. The `profilesToCompetitorArray()` projection now joins the entity. The dual-write jsonb ban stands; `products.competitors` remains schema-only.
2. **ADR 002 §9** name-keyed `competitor_changes` edge and the tracked-rename 400 → *resolved* by the entity FK (§2.4); the rename restriction can be lifted (rename is now an entity-row update) — client copy for the 400 comes out when this lands.
3. **ADR 002 §6/§9 API contract** → paths move under `/api/products/:productId` (§1.1); ids, payloads, and gate semantics otherwise unchanged; cards gain `entityId` (+ lineage, §2.5) and the entity-join fields. The §2.9.3 resolution step extends the proposal card's *content*, not the gate's contract.
4. **ADR 002 §7 registry** → gains the entity-scoped agent kind (§2.7). The pattern-lock-in risk (§8.10) fires exactly as intended: this is the first sprint the pattern didn't fully cover, and this ADR is the fix before Customers multiplies it.
5. **ADR 001 §4 seeding** → unchanged (org/user/membership seed only; products are created via onboarding). The singular `GET /api/product` from the sprint-2 products module is deleted per §1.1.
6. **ADR 001 §4a strip of `product_access`** → confirmed; return path defined (§4).

---

## 6. Sequencing recommendation

**Sprint 3a — multi-product foundation (MUST precede the Customer Insights port):**

1. Baseline rewrite: `competitor_entities` (incl. `parentEntityId`, §2.9), facet-ised `competitor_profiles`, re-keyed `competitor_changes`, `ai_agent_executions.entityId`, reshaped segment/persona tables (empty, ready for the port).
2. `products` collection routes + `productContext` middleware + route migration of the competitors surface; client URL scheme `/p/:productSlug/...` + query-key updates; switcher rendered only when >1 product.
3. Competitor service rework: adoption/dedup flow on POST (§2.3, two-level lookup), discard/GC rules (tree-aware), entity-join reads (incl. child→root fact fallback, §2.9.2).
4. Scheduler: entity-scoped registration kind; changelog/announcements/GitHub agents (when they port) register as entity agents from day one.
5. **Stretch, or immediately after 3a:** the add-flow resolution agent + proposal-card resolution UI (§2.9.3) and the parent-changes feed join — pure behaviour on 3a's schema; explicitly not a blocker for the Customer Insights port.

Roughly one sprint for 1–4; the competitors module is the only consumer being reworked, and it is the template proof again (ADR 002 §8.10).

**Sprint 3b — Customer Insights port,** landing directly on `segment_entities` + facet + `personas`/`persona_facets`. Zero new infrastructure expected; if the port needs any, the 3a pattern failed and we fix it there.

**Can wait, in order of likely pull:** resolution agent if it missed 3a (item 5 above); MCP product parameter + `list_products` (MCP sprint — but specified here, §1.2, so it's implementation not design); reader-key product scoping (MCP sprint); portfolio tables + Commercial Model module (its own ADR per brief §4b, after Customer Insights gives it the segment vocabulary); re-grain proposals (§2.9.2); `product_access` (team tier); change-relevance annotations (only on evidence of a noisy feed).

**Explicitly not in scope ever (brief §10a guard):** no cross-product "portfolio chat", no auto-generated portfolio strategy documents, no comparison-report generators — the portfolio layer stores structured goals, allocations, and commercial figures with provenance; the customer's AI does the talking about them over MCP.

---

### Summary of decisions

1. Explicit `/api/products/:productId/...` routing with a `productContext` middleware; active product is URL state in the client, a `product` parameter (with single-product default and deterministic multi-product error) in MCP, and *nothing* to the scheduler.
2. Org-level canonical entities + product-scoped facets for competitors and segments: `competitor_entities`/`segment_entities` carry identity, facts, and monitoring state researched once per org; `competitor_profiles`/`customer_segment_profiles` keep their names as facets carrying classification, threat, JTBD, satisfaction, comparisons, and the proposal gate. Personas: org-level identity, per-product `persona_facets` for goals/pain points/JTBD.
3. Competitor entities form a two-level self-referencing tree (`parentEntityId`): root = company (company-wide monitoring), children = their sub-branded products (own features/pricing where observed); facts live on the node where observed. Facets point at either grain — "their product X ↔ our product Y" at child grain, company-grain fallback keeping single-product competitors a single hierarchy-free row. Add-flow name resolution (company vs product, sub-brand inference) is a Zod-validated agent step whose output restructures the *proposal* for user confirmation on the existing gate; a separate `competitor_products` table was rejected for the polymorphic-FK cost.
4. The proposal gate is per facet; adopting an existing entity node is the dedup flow (instant profile, facet-only enrichment); entity lifecycle is derived from facets (tree-aware GC on last-facet discard). `competitor_changes` re-keys to the entity node, resolving ADR 002 §9's name-keyed edge; child-grain feeds include parent company-level changes.
5. Feedback, themes, product features, roadmap, strategy, and goals stay strictly product-scoped; the org-level analogue of strategy is the portfolio layer — `portfolio_goals`, `portfolio_goal_allocations`, `product_commercial_snapshots` (shape reserved, built later, all numbered migrations).
6. Access: nothing new for desktop solo; reader visibility is org-config + optional per-key product scoping; team tier reinstates `product_access` with Leader/isAdmin ⇒ implicit all-product access.
7. Baseline rewrite now (last one before the release freeze) for the entity splits incl. `parentEntityId`, changes re-key, executions column, and segment reshape; resolution-agent behaviour and everything else additive later. Sprint 3a (foundation) → 3b (Customer Insights on the new shape) → portfolio/commercial and team-tier access when scheduled.
