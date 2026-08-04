# Discoveree Desktop Edition — Build Brief

**Date:** 3 August 2026 · **Author:** Faith Forster with Claude Code
**Basis:** the existing Discoveree codebase (`main @ 823d979e`, which includes the merged `feature/data-richness` upgrade)
**Purpose:** self-contained summary of the product, commercial, and architecture decisions for the desktop edition, for agents working on the new build.

---

## 1. The product reframe

Discoveree today is a multi-tenant SaaS "Product Intelligence" platform with ~15 navigation destinations and a dozen AI assistants. Feedback says the product is overwhelming, but there is high demand for one thing it contains: **a context layer to support an AI product operating model**.

**The reframe: the agent-maintained context layer is the product.** Strategy, competitors, customers/feedback, and the product's own feature inventory — structured, kept current by agents, and served over MCP to whatever AI tools the customer already uses (Claude, Cursor, ChatGPT, custom agents). Everything else is a view or an agent on top of that layer, and most views can go.

One-sentence pitch: *a local, agent-maintained context layer for your product that any AI tool can connect to.*

Why desktop strengthens this rather than weakening it:
- **BYO API keys** (org-key support already exists in the codebase as `useOwnLlmKeys`) — zero marginal LLM cost to us.
- **Local MCP servers via stdio** can reach internal tools behind the customer's firewall — impossible for SaaS.
- **Data stays local** — a strong pitch for competitive/roadmap data.

## 2. Commercial model (decided)

- **Licence:** source-available (FSL-style recommended: converts to Apache after 2 years), NOT an OSI licence — protects the right to charge. Licence file must be in **commit #1** of the new repo.
- **Pricing: $199 per user per year** for a full (write) seat. A full seat = anyone who owns context, runs agents, accepts roadmap suggestions, or spawns deep dives.
- **Reader seats are free** — non-negotiable, this is the growth loop. A reader's AI tools consume the team's context via MCP (read-only surface only). No licence-key friction for readers.
- **Built-in upgrade moment:** when a reader tries to *change* the context ("add this competitor", "log this feedback"), the response offers a full seat.
- Annual licensing means no update-window machinery: licence key carries an expiry, the app checks it (offline, signed — no phone-home).
- **Launch offer (decided 4 Aug 2026):** the first 100 organisations get their first seat free for 12 months — and it is a **full write seat**, not a reader seat: the offer's whole point is that someone can approve competitors/segments, run agents, and accept suggestions; charging for write access would undermine the offer completely. Mechanically it is a normal licence key with a 12-month term issued at no charge (one per organisation; domain-verification/anti-abuse mechanics still undecided). At expiry the standard lifecycle applies: reader state + renewal at the normal price.
- **Trial & expiry (decided 4 Aug 2026):** licence is *offered* at install, not required — a 14-day trial runs with everything on. On trial or licence expiry the app becomes a **reader state**: a free reader seat of your own context (everything readable, MCP still serves, agents stop, writes refused with the upgrade offer). One seat model everywhere; no nag banners. Full design in docs/design/settings-spec.md.
- **Checkout:** merchant of record (Paddle or Lemon Squeezy) — handles global VAT, invoices, licence key issuance, per-seat annual subscriptions and mid-term seat additions. ~5–7% of revenue.
- **Distribution:** public GitHub repo (source) + own website (buy/download). Binaries may be freely downloadable with enforcement via licence key in-app (Sublime/Obsidian pattern).
- **Prerequisites:** Apple Developer Program ($99/yr) + notarisation for macOS; Windows code signing (Azure Trusted Signing ~$10/mo). Unsigned apps don't convert.
- Value anchor when marketing: replaces Klue/Crayon-class competitive-intelligence SaaS ($12k–60k+/yr contracts), not desktop utilities. Customer's total cost = $199/seat + their own LLM spend.

## 2a. Launch growth mechanics — in-product surfaces (decided 4 Aug 2026)

The website (built by Faith in Lovable) carries a launch-offer banner, a referral section, a user-review wall, and an organisation counter. Three of these need product-side support:

1. **In-app review ask.** Reviews are requested **after a value moment, never before download** — a review of an unused product is worthless and reads as bought. Trigger candidates (pick in design): first accepted roadmap suggestion, first accepted competitor proposal, or N days of active use (~14), whichever comes first; fire once, dismissible, never nags again. The ask deep-links to the website review form (built in Lovable — no in-app review storage). Form requirements agreed: name, role/company, star rating, review text, optional "what do you use it for"/"which AI tools", publication-consent checkbox, and a **separate opt-in checkbox for showing the organisation's logo** on the site (logo permission must not be bundled into the general publication consent). Compliance (UK DMCC 2024 / FTC): launch-offer reviews are incentivised, so the site discloses the incentive wherever reviews appear, asks are for *honest* reviews, and moderation removes spam only — never sentiment. If a review is a formal condition of the launch offer it must be stated in the offer terms; the current intent is a warm request, not a condition.
2. **Referral surface.** "Recommend Discoveree" appears in-app at the same value moments (and in Settings), sharing the website referral link. Incentive structure still undecided (goodwill vs give-a-month/get-a-month — check MoR coupon support before promising anything).
3. **Organisation counter.** The website shows "X organisations building their context layer". **Source of truth is licence issuance, not the app**: paid seats + launch-offer keys from the merchant-of-record, deduplicated by organisation. The app must NOT phone home for this — §2's licence check is explicitly offline/no-phone-home, and "your data never leaves your machine" is the headline security claim; runtime telemetry would contradict it. (If a "currently using" signal is ever wanted, it's a separate, explicit, default-off opt-in — not part of this counter.) Counter mechanics live entirely in the website/MoR webhook layer; the desktop app's only involvement is none.

**Messaging log (standing convention, 4 Aug 2026):** the website copy lives at docs/marketing/website-copy.md and messaging-worthy build decisions accumulate in docs/marketing/messaging-log.md. Whenever a design or build session decides a **user-visible behaviour worth marketing** (e.g. the roadmap-review regression rule: post-fix complaints re-escalate rather than staying buried under "addressed"), append a row to the log at the moment of decision — claim in customer language, source doc cited, status `new`. Periodic copy-sync sessions work the log (`new` → `in copy`) instead of re-reading the whole doc tree. Pure implementation detail does not belong in the log; the test is "would the website, a launch post, or a sales conversation want to say this?"

## 3. Module map

Test applied to every feature: **does it create or serve context, or consume it?** Creators/servers stay. Consumers are what the customer's AI does via MCP — with one deliberate exception (Roadmap Review & Suggestions, see §4).

### KEEP (desktop v1 core)

| Module | Notes | Existing code |
|---|---|---|
| Competitive Intelligence | Profiles, update agents, comparisons, review mining | `competitors*.tsx`, `competitorAgentRunner.ts`, `g2Api.ts`, `reviewSearch.ts`, `reviewService.ts` |
| Customer Insights & Feedback | Segments, personas, feedback→themes agents with sentiment | `customer-*.tsx`, `segmentNormalization.ts`, `lib/feedbackPoller.ts` |
| Strategy incl. **Deep Dives** | 3 of 4 tabs stay: narrative (vision/ambitions/pillars/business goals) as structured context, Goals, and Deep Dives (specialist-assistant exploration of growth options — creates context, feeds suggestions). Cut: stakeholder-review/share workflow, Team Goals, growth-roadmap Gantt tab | `product-vision.tsx`, `GoalsSection.tsx`, specialist assistant architecture, market review agent |
| Sources | Provenance layer — users audit what agents believe | `SourcesTab.tsx`, `searchProviders.ts` |
| MCP server + client | The wedge. Server side already exists; desktop adds stdio | `mcpServer.ts`, `mcpClient.ts`, `McpDocsPage.tsx` |
| Product profile + **deep product understanding** | One URL → populated profile, PLUS the data-richness upgrade: help-centre crawler, GitHub releases/changelog ingestion, `product_features` inventory. This is the evidence base preventing suggestions that duplicate existing capabilities | `helpCenterCrawler.ts`, `githubClient.ts`, `githubIngestion.ts`, `changelogMonitor.ts`, `featureNormalization.ts` (all now on main) |
| Thought Partner | The ONE standalone assistant: pressure-tests ideas against full context | `ThoughtPartnerConversations.tsx`, `IdeaTestingDrawer.tsx` |
| Roadmap Review & Suggestions | See §4 | `jiraPolling.ts`, `pmToolPolling.ts`, `roadmapOutboundSync.ts`, priority scoring; quick-win agent folds in as a suggestion type |
| LLM router, BYO keys | Multi-provider `callLLM()` with per-org keys exists; user keys become the default | `llmRouter.ts`, `crypto.ts` |

Web search survives unchanged: `searchProviders.ts` is entirely outbound API calls (Perplexity primary, OpenAI web_search, Gemini grounding).

### ADAPT (same job, desktop-shaped)

- **Homepage → Context Health view** (see §6). "Test a product idea" stays as primary action.
- **Onboarding → module-gating wizard** (see §5).
- **Database:** Neon serverless Postgres → **embedded PGlite** (keeps Drizzle schema nearly intact). Object storage: GCS → local app-data directory.
- **Scheduler:** runs only while app is open → every agent gets a "catch up on launch if overdue" pass (`scheduler.ts`).
- **PM-tool polling** (Jira/Linear) stays as optional connection — already poll-based, no inbound webhooks needed. Outbound sync stays (creates accepted suggestions in the planning tool).
- **Settings slimmed:** LLM keys, connections, agent schedules, licence. No billing/invitations/org management.

### CUT or DEFER (with destination)

- Team workspaces/Product Domains, @mentions/comments//task, Leadership & Product dashboards → **team SaaS tier**
- Battlecards, launch content, PRD/design-doc generation, idea brief expanders → **MCP replaces them** (customer's AI generates from served context)
- Roadmap planning views (Kanban/Timeline/Gantt) → **defer**; customers plan in Jira/Linear; roadmap *items* stay as context
- Analytics assistant + widgets, Capital Events assistant → defer / paid add-ons
- Stripe billing, Auth0/custom auth, sessions, multi-tenancy → **removed** (single user, licence key instead). Largest source of route complexity.
- Slack bot (needs public endpoint) → defer (Socket Mode later); email digests (Resend) → local notifications
- Member Welcome assistant → removed (onboarding wizard does this)

Result: 15 sidebar destinations → 6 (Home, Competitive Intelligence, Customer Insights, Strategy, Roadmap Review, Connections + Settings).

## 4. Roadmap Review & Suggestions (highly valued — keep both directions)

The most-valued feedback feature: judging whether the team is working on the most valuable things. This does NOT require planning views in Discoveree.

- **Review:** ingest roadmap items from Jira/Linear (polling exists; manual list as fallback). Score each initiative against strategy pillars, feedback themes, competitor moves, and the product's own feature inventory. Weekly report: what's over-invested, under-supported by evidence, duplicates existing capability, or missing.
- **Suggest:** propose roadmap items from context gaps (e.g. rising feedback theme with no roadmap coverage). Quick-win agent folds in as a "quick win" suggestion type.
- **Act:** accepted suggestions are created in the customer's planning tool via outbound sync.
- **Hard rules:** every suggestion is **evidence-cited** (shows the feedback items / pillar / competitor move behind it) and **human-accepted** — the agent never writes to Jira on its own. New build required: the evaluative agent + weekly report; ingestion and outbound plumbing exist.

## 4-loop. The ship→hear→iterate loop (decided 4 Aug 2026)

Feedback has a lifecycle relative to product change, keyed on **source dates** (when feedback was said — the 3b date discipline is the foundation):

1. **Ageing:** themes decay via the computed lifecycle (forming/established/fading) — old feedback sinks without being deleted. (Live in 3b.)
2. **Addressed:** when a release/roadmap item ships against a theme, the theme gains an "addressed by <release, date>" state — deprioritised in the overview and in roadmap-review scoring. **Regression rule:** mentions with sourceCreatedAt AFTER the fix date re-escalate the theme (post-fix complaints are a regression signal, not history). Requires the sprint-4 own-product release/changelog pipelines + roadmap items; linkage is human-confirmed or agent-proposed through the accept queue.
3. **Release response:** feedback dated after a release and matched to the shipped capability is highlighted ("heard since the v2.4 export release") — the briefing can report early response with sentiment.
4. **Iteration suggestions:** the Suggest engine (roadmap sprint) gains an "iteration" suggestion type whose evidence is post-release feedback on the shipped thing — "you shipped X; the customers using it ask for Y." Evidence-cited, human-accepted, as always.

Sequencing: (1) ships with 3b; (2)–(3) need sprint 4's release data and land with or after it; (4) belongs to Roadmap Review & Suggestions.

## 4a. Internal evidence — uploads and MCP-proposed intel (decided 3 Aug 2026)

Enterprise and niche products often have little public review/competitor data; their richest intel is internal (market research decks, sales-call notes, customer conversations). Two ingestion paths are therefore first-class roadmap items, both reusing the proposal→accept primitive from the competitor gate:

1. **Document upload → extraction agent:** upload competitor/market research (PDF/DOCX/PPTX/TXT/MD — SaaS parsing code exists in routes.ts multer/pdf-parse blocks); an agent extracts competitor facts and proposes merges into profiles with `internal_document` provenance. Belongs to the Sources sprint.
2. **MCP write surface:** MCP tools (`propose_competitor_intel`, `log_feedback`) so the customer's AI (e.g. Claude reading their Slack) can push intel in. Writes NEVER land directly: they enter a review queue behind the accept gate, provenance recorded ("shared by <person> in <channel>, via Claude"). Belongs to the MCP sprint. This is also the reader-upgrade moment mechanism.

3. **CRM competitive fields:** Salesforce/HubSpot opportunity records routinely carry who the deal is competing against and how the buyer weighed the options (competitor fields, win/loss reasons, deal notes). Two routes, not mutually exclusive: (a) a poll-based CRM connection in the Jira/Linear pattern that proposes competitor-evidence from opportunity data; (b) day one via the MCP write surface — the customer's Claude with a CRM connector proposes intel through the same tools as (2). Win/loss patterns are also prime evidence for the roadmap review ("we lose to Harvey on SSO" is a theme with revenue attached).
4. **Call recordings:** sales/customer call transcripts (Gong-class tools or uploaded recordings) mined for competitor mentions and buying criteria — the SaaS schema already carries a call-recordings table, so the data model has a head start. Same proposal-queue discipline.

Source kinds (public web / internal document / employee report / CRM record / call transcript) are distinguished in provenance and confidence handling. For thin-public-data products, internal evidence is the primary source, not the fallback — the add-competitor flow should degrade gracefully into "upload what you have" rather than returning empty.

## 4b. Commercial Model module (new build — decided 4 Aug 2026)

A context section the SaaS never properly supported: **how the product/business makes money.** Owner-identified gap; to be designed and built as a first-class module (schema first, then agents, then surface). Scope:

- **Pricing model** — tiers, price points, billing motion (self-serve/sales-led), discounting norms.
- **Distribution channels** — direct, partner, marketplace, etc., each with economics attached.
- **Profitability/margin** — across channels and customer segments (gross margin structure, cost drivers).
- **Revenue & usage spread** — concentration across strategic accounts and customer segments; which segments/accounts drive revenue vs usage.

Design notes:
- **Consumers:** roadmap review gains revenue-weighted scoring ("this initiative serves the segment that is 60% of revenue"); deep dives and Thought Partner gain commercial grounding; MCP serves it to the customer's AI for pricing/packaging/deal questions.
- **Sources:** manual/structured entry first (the owner knows these numbers); later billing (Stripe et al.), CRM (links to §4a CRM ingestion), and analytics connections via the proposal→accept queue.
- **Sensitivity (open design question):** this is the most confidential context in the product. Local-first is a genuine advantage here, but MCP serving and free reader seats likely need per-module visibility controls (e.g. commercial context excluded from the reader surface by default). Must be answered in the module's design doc.
- **Onboarding:** gates via a sixth step-2 job (e.g. "Keep our commercial model sharp"); same rule as all modules — unchosen, it doesn't appear.
- Cross-links: segment definitions shared with Customer Insights (one segment vocabulary, not two).
- **Goals ownership (decided 4 Aug 2026):** *setting* goals — the targets: expected revenue, growth, costs, per product and portfolio — belongs to the Commercial Model; *applying* them belongs to Growth Strategy, which covers both what the targets are (by reference, not copy) and the hypothesis of what we must do to reach them (pillars/bets linked to the goals they serve). The roadmap review then scores initiatives → pillars → goals. When Strategy is ported, its goals sections build on Commercial Model goal objects rather than owning their own.

## 4c. Multi-product organisations (requirement recorded 4 Aug 2026; design in ADR 003)

Individual users mostly work on one product, but larger security-conscious orgs — the desktop edition's strongest audience — will have several products, and leaders need access across all of them. End-state: leaders make investment decisions (expected revenue, growth, costs) across products — portfolio-level business goals, built on per-product Commercial Model data (§4b).

Schema already supports org → many products with product-scoped context (protected by ADR 001's tenancy decision); the current single-product API surface is a convenience layer, not a constraint. The open design (ADR 003) is **cross-product entity identity**: org-level canonical entities (a competitor as a company, researched once; a segment/persona) with product-scoped facets (threat level and feature comparison per product; jobs-to-be-done per product even when the persona is shared). Must be settled before the Customer Insights port. Team tier will also need per-product access control back (leaders all-product; product teams theirs).

## 5. Onboarding (5 steps; answers gate modules)

Current flow (details → LLM keys → billing) is replaced. Billing step is deleted (licence entered at install).

1. **Your product** — one URL; auto-detection agent drafts profile, proposes competitors. Keep magical.
2. **What should Discoveree do?** — multi-select of JOBS (not features), each switching on exactly one module: track competitors / understand customers & feedback / keep strategy sharp / check we're building the most valuable things / feed context to my AI tools.
3. **Your AI tools** — Claude, Cursor, ChatGPT, custom → generates ready-to-paste MCP config per tool. This is the activation moment.
4. **Your data tools** — Jira/Linear, Slack, analytics, none → sets up polling/MCP client connections (for Roadmap Review, this is both source and destination).
5. **LLM keys** — one key from any provider is enough; router handles fallback.

Then the existing AI interview runs, scoped only to selected modules. Unchosen modules do not appear at all (not as locked teasers); "Add capabilities" lives in Settings.

## 6. UX: layout grammar and home screen

**Principle: structured data, organic surface.** The schema stays strict (that's what makes context MCP-readable); the layout is derived from what context exists. Tabbed mega-pages retire. Three-level grammar everywhere:

1. **Overview** — one scannable page per module made of blocks that materialise only when populated. Day one, Strategy is a single "define your vision" prompt card.
2. **Object** — competitor, segment, theme, opportunity, suggestion: linkable detail views, not owned by any tab.
3. **Thread** — a deep dive is spawned from ANY object ("explore this") with a specialist assistant; finished threads file under their object and become context.

Tab-style switching survives only as view toggles over the same data (cards vs comparison table).

**Home = Context Health**, not an activity feed: overall completeness/freshness ("82% complete · 2 items need attention"), per-module cards (each a door; staleness flagged), "this week from your agents" digest, and an MCP panel showing consumption ("Claude — 118 queries this week") plus teammates reading and a **Connect a teammate** action. Discoverability lives here.

## 7. Team sharing — the upgrade ladder

The hard problem is writing together, not reading together (agents write constantly). Only one thing may write the context until the customer pays for the tier that manages concurrent writing.

1. **Rung 1 — read-sharing (v1, free):** one machine owns context and runs agents; teammates' AI tools connect to its MCP server over the local network (HTTP transport exists) + snapshot export/import. Single writer, no conflicts. "Connect a teammate" must be a first-class flow (QR/paste snippet) — it's the sales motion for the next seat.
2. **Rung 2 — git-backed context (v1.x):** context-as-code in the team's own repo; agents commit with provenance; humans review diffs of what the AI believes. Needs section-scoped files for merge discipline.
3. **Rung 3 — multi-writer (team tier, recurring revenue):** hosted SaaS or self-hosted team server (today's Express app minus Stripe) per seat. Mentions/comments/dashboards return here.

## 8. Architecture: one codebase, two deployments

Collaboration needs a shared **server**, not a web **client**. The React SPA ↔ Express API boundary already exists, so:

- **Desktop solo mode:** Tauri/Electron shell; Express embedded in-process; PGlite; client talks to localhost.
- **Team mode:** the same Express server deployed shared (hosted, or self-hosted Docker), real Postgres, agents run centrally, SSE pushes changes. It serves the same SPA to browsers (web access comes free) AND accepts desktop apps pointed at the team URL (Slack/Linear pattern).
- **Upgrade path:** solo → buy team tier → point desktop at team server → context migrates up.

**The critical early decision:** build local mode behind clean interfaces (DB, storage, auth, API base URL) — a deployment target, not a fork. This seam is simultaneously the desktop/team switch, the SaaS transition path, and the licensing boundary.

**Claude connection:** no CLI product needed — MCP is the connection. Ship a thin CLI launcher (`discoveree mcp serve`) that Claude Desktop/Claude Code spawn over stdio, registered automatically in onboarding step 3. It must be **headless-capable** (reads the local DB directly so context is served even when the app is closed). Also expose localhost HTTP MCP while the app runs. claude.ai in the browser can only reach remote connectors — that's a team-tier feature, not a v1 gap to fix. A `.mcp.json` in a customer's product repo can declare "this project's context lives in Discoveree" for Claude Code teams.

## 9. New repository (decided)

Build in a **fresh public GitHub repo, not a fork**:
- Source-available LICENSE in commit #1 (no ambiguity about terms for any historical commit).
- The existing repo's history has never been audited for secrets/customer data (scratch files like `gemini_tail.txt` have landed in it before) — seeding a clean repo avoids forensic history-scrubbing.
- Structure from day one: `shared/` (schema), `client/`, `server/` with local/team adapters.
- The team SaaS is then built off this same repo as the second deployment target.

## 10. Current state & suggested build sequence

**State (3 Aug 2026):** `feature/data-richness` (help-centre crawler, GitHub ingestion, changelog monitoring, `product_features` schema) is merged to GitHub main at `823d979e`; typecheck baseline unchanged (669 pre-existing errors, none new); the 4 new test suites pass (90 tests). Pulled into both EU and US Replit workspaces. Outstanding there: `npm run db:push` per region (schema changed) and Republish per region.

**Constraints for all agents:**
- All user-facing copy is **authored in British English** (see `design_guidelines.md` for the substitution table) — one canonical voice for authors and agents. **Display locale (decided 4 Aug 2026 — US is a primary target market):** the app renders en-US for US/rest-of-world OS locales and en-GB for UK/Commonwealth locales, via a display-time dictionary transform (inverted substitution table + curated idiom exceptions, e.g. fortnight → two weeks) with a Settings override (Auto/British/American). Agent synthesis prompts take the locale flag; mined verbatims are never transformed. Dates/numbers use the OS locale. Implemented as one seam all strings flow through — install right after sprint 3b, before more copy accumulates. Full non-English localisation stays a deliberate post-v1 decision (trigger: demand from a non-English segment). Design system: shadcn/ui "New York", Inter + JetBrains Mono, light/dark modes.
- AI-generated data validated with Zod; agents follow "merge, don't replace" on refresh.
- **No evidence, no assertion (decided 4 Aug 2026 — owner-reported SaaS defect):** the SaaS hallucinates personas/JTBD from the product description alone. In the desktop edition, customer-knowledge outputs (personas, JTBD, segment insights) are generated only from actual evidence (feedback, mined reviews, owner-provided knowledge, uploaded documents), with output schemas REQUIRING evidence references — uncited output fails validation and is not stored. Owner-asserted knowledge is a legitimate labelled source kind ("owner-provided"), never dressed as research. No-evidence states render as invitations, never fabrications.
- Suggestions/actions that write to external tools are always evidence-cited and human-accepted.

## 10a. Positioning: "why not just a Claude project with schedules and an artifact dashboard?"

Concede honestly: for a solo PM with light needs, that rig is a partial substitute. The durable differences — and therefore where the build must over-invest — are:

1. **Schema vs prose:** typed, Zod-validated relational context with stable IDs, provenance, confidence, and merge-don't-replace — not documents rewritten by prompt (which silently accumulate duplicates and drift).
2. **Deterministic maintenance:** hash-diff changelog monitoring, deterministic crawling, near-dup dedup, source re-validation — detecting *change*, not re-deriving everything per run.
3. **Freshness accounting:** the product knows what it knows and when it was last verified; a project's knowledge just quietly goes stale.
4. **Tool-agnostic + team-wide:** one context serves Claude, Cursor, ChatGPT, custom agents, and free readers with write governance; a Claude project is locked to one tool and one account.
5. **Repeatable judgment:** the weekly roadmap review is a consistent, comparable, auditable join over stable IDs, with accepted suggestions written back to Jira — not a one-off chat.

Strategic corollary: Claude is a **consumer** of the context layer, never a competitor to it. Do not build chat/research/generation features Claude already does well; over-invest in schema, pipelines, provenance, governance. Bar to clear: the customer must feel the difference between "Claude with my docs" and "Claude with Discoveree" in week one. Sales one-liner: *you could run sales from a Claude project too; nobody does — Discoveree is the system of record for product context.*

**Sequence (updated 4 Aug 2026 — steps 1–3 done through sprint 3a/Settings; 3b in build):**
1. ~~Repo: licence, skeleton, CI.~~ Done.
2. ~~DB seam (PGlite behind an interface), storage, auth removal.~~ Done (ADR 001).
3. ~~First verticals: Competitive Intelligence (ADR 002, proposal gate), multi-product entities (ADR 003), Settings + BYO keys.~~ Done. **Sprint 3b (Customer Insights, ADR 004) in build.**
4. **MCP sprint (next after 3b — owner-agreed 4 Aug):** the wedge, both directions. Serve: stdio launcher (headless-capable, lock-file handshake per ADR 001) + localhost HTTP; "connect a teammate" flow; read-only reader surface. Write: `log_feedback` / `propose_competitor_intel` tools through the §4a proposal queue — internal-tool evidence (Slack, CRM) arrives via the customer's own AI with provenance; one build covers every tool, native pollers become later refinements.
5. Sprint 4: own-product pipelines (help-centre crawler, GitHub releases, product_features) + product profile surface + onboarding wizard with module gating — unlocks "versus you" comparisons and §4-loop pieces 2–3.
6. Roadmap Review & Suggestions evaluative agent + weekly report (+ §4-loop iteration suggestions).
7. Licensing (key with expiry, offline signed validation), Paddle/Lemon Squeezy checkout, code signing + auto-update feed, Tauri packaging.
