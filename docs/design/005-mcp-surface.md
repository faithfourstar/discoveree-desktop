# ADR 005 — The MCP surface

**Status:** Proposed · **Date:** 4 August 2026 · **Author:** Desktop architect (Claude Code)
**Context:** Build brief §1 (the pitch — "a local, agent-maintained context layer … that any AI tool can connect to"), §2 (reader seats consume read-only via MCP; the write attempt is the upgrade moment), §4a.2 (MCP-proposed intel through the proposal queue), §7 rung 1 (read-sharing over LAN), §8 (stdio launcher headless-capable + localhost HTTP; claude.ai/remote connectors are team-tier), §10 sequence item 4 (this sprint), §10a (the week-one bar). Builds on ADR 001 (writer lock carries the MCP port; dataDir resolution shared with the CLI), ADR 002 (module pattern, localIdentity seam), ADR 003 (product-scoped context; MCP product-parameter semantics specified in §1.2), ADR 004 (customers surface; gate table §7; evidence ledger).
**Source basis:** SaaS repo `main @ 823d979e` — `mcpServer.ts` (756), `mcpClient.ts` (135), `routes.ts:35226–35283` (HTTP mount); desktop repo — `server/db/lock.ts` (as built), `server/db/dataDir.ts`, `server/main.ts`, `server/app.ts`, `server/http/serverPort.ts`, both modules' routes/services, `shared/schema.ts` (`mcp_connections`, `mcp_api_keys`, `shared_conversations` already in baseline).

This is the sprint the build has been pointing at: the wedge, in both directions. Serve: the context layer becomes reachable by Claude Desktop, Claude Code, and Cursor whether or not the app is open. Write: the customer's own AI becomes an evidence channel — Slack, CRM, call notes arrive through two tools instead of N native pollers (brief §4a.2: "one build covers every tool"). Everything here is governed by the §10a corollary: Claude is a **consumer** of the context layer; this sprint builds pipes and governance, never chat/research/generation.

---

## 1. Topology: one server, three run modes, one lock

### 1.1 The three run modes and the decision flow

One MCP server implementation (`server/mcp/server.ts`, `buildMcpServer(ctx)`), reachable three ways:

| Mode | Transport | Process | DB access |
|---|---|---|---|
| **In-app** | Streamable HTTP at `http://127.0.0.1:7317/mcp` (same port as the API — `serverPort.ts` already resolves it and the lock file already carries it) | the running app (`main.ts`) | the app's open PGlite |
| **CLI, app running** | stdio, **proxied** to the app's HTTP endpoint | `discoveree mcp serve` | none — pure transport bridge |
| **CLI, app closed (headless)** | stdio, served in-process | `discoveree mcp serve` | opens PGlite itself, **holding the writer lock** |

The CLI's decision flow is exactly the lock-file handshake ADR 001 designed and `lock.ts` implements:

```
discoveree mcp serve
  └─ resolveDataDir()                        (same routine as the app — ADR 001 §2)
  └─ acquireWriterLock(dataDir)
       ├─ acquired: false, holder.mcpPort set
       │     → PROXY: bridge stdio ⇄ http://127.0.0.1:<holder.mcpPort>/mcp
       ├─ acquired: false, holder.mcpPort null      (another headless CLI is mid-startup)
       │     → retry briefly (≤5 s), then proxy to the port it publishes; else error out honestly
       └─ acquired: true
             → HEADLESS: initDatabase({pglite}) → migrate() → buildMcpServer()
               → serve stdio AND open the localhost HTTP endpoint on an
                 available port → handle.setMcpPort(port)                (§1.4)
```

Multi-instance / team-URL targeting (`discoveree mcp serve --url https://team…`) is **out of scope** — team tier. The only remote the CLI ever talks to in v1 is `127.0.0.1`.

### 1.2 Headless DB access: the CLI takes the writer lock (decision)

The instinct that "a reader shouldn't take the writer lock" dissolves on inspection, for three reasons:

1. **PGlite has no multi-process read-only mode.** Any open of the data directory is a full single-process open; a second open corrupts (ADR 001 §2). "Read-only access without the lock" is not an option that exists — the lock is the price of *any* access, and calling it the "writer" lock describes its governance role, not a permission level.
2. **The headless CLI is not a pure reader anyway.** `log_feedback` and `propose_competitor_intel` write; so do consumption stamps (§2.7). A read-only posture would be a fiction maintained by refusing useful behaviour.
3. **Single-writer governance (brief §7) is a process invariant, and the lock is its enforcement.** Whichever process holds the lock *is* the single writer. A headless CLI holding it violates nothing.

**Rejected:** a separate read lock / shared-lock protocol (builds multi-process concurrency machinery PGlite cannot honour underneath); opening a snapshot copy of the DB for headless reads (stale answers, doubles disk, and the write tools would still need the real DB).

### 1.3 The headless-writes rule (decision — the sharp question, answered)

**MCP writes work identically whether the app is running or closed: they execute through the same module service functions against the DB the current lock-holder has open. No refusal, no side queue.**

- App running (in-app HTTP, or CLI proxying to it): the app's process writes. Trivially fine.
- App closed (headless CLI holding the lock): the CLI's process writes. Also fine, per §1.2 — it is the single writer while it holds the lock.

What makes this safe rather than brave is a hard rule on the write tools themselves (§3.6): **MCP tool handlers are pure data writes — no LLM calls, no enrichment fan-out, no agent triggers.** `log_feedback` inserts a `feedback_entries` row (sentiment left null; the next `gather-feedback-agent` run's sentiment pass scores it). `propose_competitor_intel` inserts a proposal row. All downstream synthesis happens in the app's scheduled agent runs — and the catch-up-on-launch pass (ADR 002 §7) already guarantees those runs happen promptly after the app next opens. The overnight story from brief §4a ("Claude reading their Slack pushes intel in") therefore works headless with zero special machinery.

**Rejected alternatives:**

- **Refuse writes when headless** ("the app isn't running, try later"). No safety gain (the lock already guarantees single-writer), and it breaks the strongest write-surface story — unattended intel capture. Also indistinguishable, from the model's side, from a broken tool.
- **Queue writes to a file for the app to ingest.** A second write path into the same database is exactly the dual-write pattern ADR 002 banned. The database **is** the queue — that is what `intel_proposals` rows and unscored feedback entries are.
- **Headless read-only + queue only for writes.** Combines the costs of both rejected options.

The headless CLI **never starts the scheduler**: serving context is not running agents. Agents are the app's job (and, later, the licence's job — an expired-licence reader state stops agents but keeps MCP serving, settings-spec §6.3; a headless CLI that ran agents would bypass that).

### 1.4 First-holder-serves-HTTP (multi-client concurrency)

Claude Desktop, Claude Code, and Cursor each spawn their **own** `discoveree mcp serve`. Without care, the second spawn finds the lock held by the first and has nothing to proxy to. Decision: **whoever holds the lock serves the localhost HTTP endpoint; everyone else proxies to it.** The app already does this (port 7317 in the lock). The headless CLI does the same: after opening the DB it starts the HTTP listener (port 7317 if free, else an ephemeral port) and publishes it via `handle.setMcpPort(port)` — the method `lock.ts` already ships. Proxy mode is therefore **uniform**: the CLI never cares whether the holder is the app or a sibling CLI.

Lifecycle edges, ruled:

- **Holder CLI's stdio session ends** (its AI client quits): it exits and releases the lock. Sibling proxies' upstream drops; each sibling then re-runs the decision flow — the first to re-acquire becomes the new holder. Implemented as: on upstream disconnect, retry the flow (bounded) before surfacing an error to the stdio client. MCP clients tolerate a brief reconnect.
- **App starts while a CLI holds the lock:** the app signals the holder (SIGTERM, per ADR 001 §2). The holder closes PGlite, releases the lock, then — rather than exiting — **re-runs the decision flow and resumes as a proxy** to the app that displaced it. ADR 001 §2 accepted a dropped session here ("Claude reconnects — acceptable"); this design does better at near-zero cost, because the proxy path is code the CLI already has. *Flagged as a refinement of ADR 001 §2, not a conflict; the drop-and-exit behaviour remains the acceptable fallback if hand-over proves fiddly.*

### 1.5 Transport specifics (decisions)

- **Stateless Streamable HTTP**, one server instance per request (`sessionIdGenerator: undefined`) — the SaaS pattern at `routes.ts:35255–35283` ports directly. Statelessness is **load-bearing** twice over: it keeps the stdio⇄HTTP proxy a dumb message bridge (no session-header bookkeeping), and it makes the app's takeover/restart invisible to consumers. No SSE legacy endpoint (the SaaS carried one for older clients; the desktop's three target clients all speak Streamable HTTP or stdio). No server-initiated streams/subscriptions in v1 — tools only.
- **The proxy is a transport-level bridge, not a tool mirror:** `StdioServerTransport` and `StreamableHTTPClientTransport` both speak `JSONRPCMessage`; wire `onmessage` of each to `send` of the other (~50 lines). A tool-mirroring proxy (re-registering tools on a local server and forwarding calls) was rejected: it duplicates the tool registry, drifts, and breaks on capability changes.
- **Bind `127.0.0.1` only** (as `main.ts` already does), and enable the transport's **DNS-rebinding protection** (`allowedHosts: ["127.0.0.1:<port>", "localhost:<port>"]`). A malicious web page rebinding DNS to hit the unauthenticated localhost endpoint is the one real remote attack on this surface; the SDK ships the mitigation — turn it on. LAN exposure is an explicit opt-in in sprint 5b (§4).
- **No auth on localhost in solo mode** — same trust model as the existing API: the machine's user owns everything. The caller seam (§4.1) is where auth attaches when a non-loopback bind exists.
- **Dependency:** add `@modelcontextprotocol/sdk` (exact pin, per the repo's pinning discipline; its zod peer range is satisfied by the repo's 3.25). It is the only new runtime dependency of the sprint.

---

## 2. The read surface

### 2.1 Tools, not resources (decision)

Everything is exposed as **tools**. MCP resources are idiomatically right for stable documents, but: resource support is uneven across the three target clients (tool calling is the one universally-implemented primitive — and "tool-agnostic" is the pitch, brief §10a.4); every read here is parametrised (product scope, pagination, filters), which is tool-shaped; and one primitive keeps the docs page, the introspection endpoint, and the reader-seat filter (§4) single-tracked. Revisit resources only if a real client's UX demonstrably benefits (e.g. Claude Desktop resource pickers) — additive later, costs nothing to defer.

Tool results are JSON serialised into a single `text` content block (the SaaS convention; universally parsed). Adopting `structuredContent`/`outputSchema` is a noted fast-follow once client support is worth it — the declarative registry (§6.1) makes it a one-line-per-tool change.

### 2.2 The tools (v1 catalogue — 10 read, 2 write)

All read tools take the optional `product` parameter (§2.3) unless marked org-level. Names are `snake_case`, verbs `list_`/`get_` exactly as the SaaS surface used.

| Tool | Parameters | Returns (wrapping the existing route serialisers — MCP never invents a second projection) |
|---|---|---|
| `list_products` | — (org-level) | `{ products: [{ id, slug, name, description, url }] }` |
| `get_context_health` | `product?` | The Context Health summary, computed not synthesised (§2.6): per-module counts, freshness stamps, staleness flags, pending-proposal counts, unfiled feedback count |
| `get_product_profile` | `product?` | The product row's context fields (name, description, url, markets, audience, business model — what the ported `products` module serves) with `updatedAt` |
| `list_competitors` | `product?`, `include_proposed?` (default false) | `CompetitorCard[]` verbatim from `toCompetitorCard` — facet id as stable id, entity lineage, threat, classification, sentiment/reviewCount, `lastVerifiedAt`, `alsoTrackedBy` |
| `get_competitor` | `product?`, `competitor` (facet id **or** name — §2.5) | The detail payload: entity facts with child→root fallback (description, keyFeatures with per-feature `sourceUrl`, pricing + `pricingSourceUrl`, markets, integrations), the facet's differentiators/analysis, the ADR 004 §6.4 reviews block (quotes with `sourceUrl` + `verified`), monitoring stamps (`changelogLastCheckedAt`, `lastEnrichedAt`) |
| `list_competitor_changes` | `product?`, `limit?` (≤100, default 20), `since?` (ISO) | The product change feed — the ADR 003 §2.4 entity join incl. parent company-level changes: `{ id, entityId, competitorName, changeType, changeTitle, changeDescription, sourceUrl, urlVerified, stream, severity, detectedAt }` |
| `list_segments` | `product?`, `include_proposed?` | `SegmentCard[]` from ADR 004 §6.1 — **including `evidenceStatus` verbatim** (count, distinctSources, newestAt, thresholds, sufficientFor). Serving the absence honestly is the differentiator; do not strip it for "cleanliness" |
| `get_segment` | `product?`, `segment` (facet id or name) | `SegmentDetail` incl. `personas: PersonaWithFacet[]` — JTBD/goals/painPoints **with their `evidenceRefs`**, provenance (`owner`/`agent`), quotes with URLs, computed `overallSatisfaction` |
| `list_feedback_themes` | `product?` | `{ themes: Theme[], unfiledCount }` from ADR 004 §6.3 — evidence counts, confidence/coherence, aliases, `consolidationSuggested` |
| `list_feedback` | `product?`, `theme_id?`, `topic?`, `is_competitor?`, `since?`, `limit?` (≤200, default 50), `offset?` | `{ entries, total, nextOffset }` — quotedText, sourceName/sourceUrl/verified, sourceType, sentiment, sourceCreatedAt/collectedAt, competitorEntityId |
| `log_feedback` | §3.2 | write |
| `propose_competitor_intel` | §3.3 | write |

Deliberately **absent**, with reasons: `get_full_strategy_context` (the SaaS's kitchen-sink brief — reads unported strategy fields and the dead `products.competitors` jsonb; its desktop successor is `get_context_health` + targeted reads, and a strategy tool arrives with the Strategy port); `save_conversation_insight` (deferred — `shared_conversations` sits in the baseline ready, but artefact write-back belongs with the Threads/deep-dive design, and this sprint's write surface must stay small enough to prove the queue); team/task/opportunity/agent-build-loop tools (their modules are cut or unported).

### 2.3 Product parameter semantics (per ADR 003 §1.2 — implemented, not redesigned)

- `product` accepts id or slug. Omitted + exactly one product → that product. Omitted + several → the tool **fails deterministically** with the product list: `{ "error": "product_required", "message": "This organisation has 3 products — pass product.", "products": [{ id, slug, name }] }`. Never a silent `products[0]`.
- Unknown value → same shape, `"error": "product_not_found"`, with the list.
- `discoveree mcp serve --product <slug>` **pins** the scope (the `.mcp.json`-in-repo pattern, brief §8): pinned, the parameter defaults to the pin and an explicit *mismatching* value is refused (`"error": "product_pinned"`) — a project-scoped connection must not quietly read a sibling product. The pin applies equally in proxy mode (the CLI injects/validates before forwarding — the one place the bridge inspects payloads; implemented as a request middleware on the bridge, tolerable because tool-call params are stable protocol surface).
- Org-level tools (`list_products`, later entity/portfolio tools) take no product parameter, per ADR 003.

### 2.4 Consumption-grade payloads (the week-one bar, made concrete)

The customer must feel "Claude with Discoveree" beat "Claude with my docs" in week one (brief §10a). Docs lose on four properties, so every payload must exhibit them:

1. **Stable IDs, always.** Every object carries its id (facet ids for competitors/segments per ADR 003 §2.5; entry/theme/change ids). The model can cite them back — and `propose_competitor_intel` accepts them (§3.3), closing the loop a document can never close.
2. **Citations, always.** Wherever the schema has provenance (per-feature `sourceUrl`, quote URLs + `verified`, change `sourceUrl` + `urlVerified`, `evidenceRefs`), it ships. Never strip provenance to slim a payload — trim *items*, not *evidence*.
3. **Freshness stamps, always.** `lastVerifiedAt`, `lastEnrichedAt`, `newestAt`, `detectedAt` — ISO 8601, never pre-formatted (the consuming model does relative phrasing). Plus one envelope line on every response: `{ "_context": { "product": { "id", "name" }, "generatedAt": ISO } }`. A model that can say "verified two hours ago" vs "this section is three months stale" is the freshness-accounting pitch (brief §10a.3) delivered to the tool that talks to the customer.
4. **Honest absence.** `evidenceStatus`, `unfiledCount`, empty-but-explained blocks — the no-evidence-no-assertion rule (brief §10) serialised. A reader's Claude saying "Discoveree has no evidence for personas yet — 3 more cited items needed" is behaviour no prose document produces.

### 2.5 Name resolution on `get_*` (small decision, large usability)

Models frequently hold the name, not the id. `get_competitor`/`get_segment` accept either: id lookup first, then normalised-name lookup (the module `normalizeCompetitorName`/`normalizeSegmentName` functions) scoped to the product, across both competitor tree levels. Ambiguity (name matches several nodes) → deterministic error listing candidates with ids. This mirrors the add-flow's own two-level lookup (ADR 003 §2.3) — same functions, no new machinery.

### 2.6 `get_context_health` (new, but computed — not synthesised)

Counts and stamps assembled from module storage: per module `{ tracked, proposed, staleCount, newestChangeAt / newestEvidenceAt }`, org totals, pending `intel_proposals`, `unfiledCount`, and the licence/seat state placeholder (§4). **No LLM call, no prose summary** — a generated essay here is exactly the module-overview-synthesis anti-feature ADR 004 §1 cut, and the brief-§10a boundary. The client's Context Health home (onboarding-and-home spec) will share this computation server-side; building it MCP-first is fine — the home page becomes its second consumer.

### 2.7 Consumption metrics (feeds "Claude — 118 queries this week")

Additive table `mcp_activity`: `{ id, clientName, clientVersion, toolName, isError boolean, keyId nullable, calledAt }`, written per tool call by the server wrapper (client identity from the MCP `initialize` handshake's `clientInfo`), pruned >90 days by a cheap on-launch sweep. Powers the Context Health MCP panel, the onboarding step-3 activation check ("Claude has connected ✓"), and later the §2a value-moment triggers. Rejected: counters-only rollup (loses per-tool/per-client breakdown the panel copy already promises) and logging request payloads (privacy-hostile for a product whose headline is "data stays local" — **payloads are never logged**).

### 2.8 Server `instructions` (ship them — cheap, high leverage)

The `McpServer` constructor takes an `instructions` string most clients inject into context. Ours states: what Discoveree is (system of record for product context); call `get_context_health` first in a fresh conversation; ids are stable — cite them; freshness stamps mean what they say — hedge on stale data; when the user shares customer feedback or competitor intel, offer to `log_feedback`/`propose_competitor_intel` **with the user's stated attribution, never invented**; writes may be refused on reader seats — relay the refusal message verbatim. This paragraph is week-one behaviour-shaping at zero engineering cost. British English, per house rules (it is user-visible in some clients).

---

## 3. The write surface

### 3.1 The gate follows the seat, not the transport (ruling + flagged conflict)

Brief §4a.2 says MCP writes "NEVER land directly"; ADR 004 §7 rules feedback entries "direct-add, no gate" for full seats while "external writers (MCP log_feedback, readers) still enter the review queue". These collide for the v1 solo case: the MCP caller on localhost/stdio **is the owner's own full seat** — the same human whose UI POST is a direct add. Refusing or queueing their write because it arrived via Claude instead of the form would be governance theatre (and would train the owner to bypass MCP, killing the wedge).

**Ruling: write governance keys on the caller's seat, never on the transport.**

- **Owner seat** (solo localhost/stdio — everything this sprint serves): `log_feedback` is a **direct add** with provenance `mcp` and attribution fields — exactly the ADR 004 §7 gate-table row for feedback ("observations, not vocabulary"), with better provenance than the manual form. `propose_competitor_intel` **queues** — not because of the transport, but because intel shapes tracked context (facts on the competitor object), which is gated for *every* writer including the app's own agents-proposing-regrain (ADR 003 §2.9.2).
- **Reader seat** (rung 1, sprint 5b): both write tools are refused with the upgrade shape (§4.2). The queue-for-readers idea in §4a.2 is *superseded by refusal*: a free reader's write attempt is the **sales moment** (brief §2), and a queued write would dilute it into a moderation chore.

*Flagged for the owner as an amendment to brief §4a.2's wording ("writes never land directly"): the durable rule is per-object gating (ADR 004 §7's table) × per-caller seat, and §4a.2's sentence should be read as describing reader/external-person flows. The provenance promise in §4a.2 ("shared by <person> in <channel>, via Claude") is kept in full — on the direct-added row itself.*

### 3.2 `log_feedback`

```
log_feedback {
  product?: string,
  quoted_text: string          (required, 1–4000 chars — the verbatim words)
  shared_by: string            (required — the person/channel it came from, AS STATED
                                BY THE USER; the literal "unattributed" is accepted;
                                inventing attribution is forbidden by description + instructions)
  source_name?: string         ("Slack #enterprise-deals", "sales call with Acme", …)
  source_url?: string
  source_created_at?: ISO      (when it was SAID — the ADR 004 date discipline; omitted = unknown)
  topic?: string
  sentiment?: integer 0–100    (only if the user stated it; otherwise OMIT — the pipeline scores it)
  reviewer_name?: string       (the customer being quoted, if known)
  competitor?: string          (entity id or name → sets isCompetitor + competitorEntityId when
                                it resolves to a TRACKED entity; unresolved → stored as plain
                                feedback with the name in topic, never an invented entity row)
}
→ { id, message: "Feedback logged with provenance …" }
```

Handler behaviour: insert `feedback_entries` with `sourceType: "mcp"` (vocabulary extension ADR 004 §8 reserved), `verified: false`, `collectedAt: now`, `sentiment: null` unless supplied — **not** the SaaS's default-50, which polluted sentiment statistics with fake neutrality; the sentiment pass scores nulls on the next collection run. `provenance` (new jsonb column, §3.5) records `{ via: "mcp", client, sharedBy, keyId }`. Dedup: the ported 100-char prefix key against recent entries; a duplicate returns the existing id with `"duplicate": true` rather than erroring (agents retry; idempotency beats scolding).

### 3.3 `propose_competitor_intel` and the `intel_proposals` queue

```
propose_competitor_intel {
  product?: string,
  competitor: string           (required — facet id, entity id, or name)
  intel: string                (required, 1–4000 chars — the claim, in the sharer's words)
  kind?: "pricing" | "feature" | "news" | "positioning" | "customer" | "other"   (default "other")
  shared_by: string            (required — same rule as log_feedback)
  source_url?: string
  effective_date?: ISO         (when the observed thing happened, if known)
}
→ { proposalId, status: "pending", competitor: {entityId?|name}, message:
    "Queued for review in Discoveree — nothing changes until it is accepted." }
```

Resolution (reusing the §2.3/§2.5 lookup, both tree levels): a match to an org entity → proposal targets that `entityId`. **No match → the proposal is stored with `targetKind: "new_competitor"` and the name** — MCP never creates entity rows or proposed facets, because that path triggers enrichment (LLM spend) which MCP handlers must not do (§3.6), and because inventing entities from a name is the drift ADR 003 exists to prevent. On review, accepting a `new_competitor` proposal hands off to the standard add-competitor flow (which then researches and re-proposes through its own gate).

**New table (`intel_proposals`) — the §4a proposal-queue primitive, built generically because CRM records, call transcripts and document extraction (§4a.1/3/4) are queued through the same shape later:**

```ts
intel_proposals: {
  id, organizationId, productId,            // the product context it was proposed in
  targetKind: "competitor_entity" | "new_competitor",   // vocabulary reserves: "segment", "product_fact"
  targetEntityId: varchar | null,           // null when new_competitor
  targetName: text | null,                  // the unresolved name when new_competitor
  kind: text,                               // pricing | feature | news | positioning | customer | other
  claim: text,                              // verbatim intel
  sourceUrl: text | null,
  effectiveDate: timestamp | null,
  provenance: jsonb,                        // §3.5 shape
  status: "pending" | "accepted" | "dismissed",
  decidedAt, decidedByUserId,               // audit
  acceptedChangeId: varchar | null,         // → competitor_changes.id once materialised
  createdAt
}
```

**Review surface (this sprint, competitors module):** `GET /api/products/:productId/intel-proposals`, `POST …/:id/accept`, `POST …/:id/dismiss`, plus a pending-proposals block on the competitors overview (the client's proposal-card grammar already exists from the add-gate). **Accept materialises the intel as a `competitor_changes` row** on the target entity — `sourceType: "internal_report"` (vocabulary extension), `changeType` from `kind`, `changeTitle/Description` from the claim, `provenance` carried over, `urlVerified` null-or-checked. Rationale: the change feed is the module's "what's new" spine, it is already entity-keyed and served over MCP (`list_competitor_changes`), and the roadmap-review agent will join over it — accepted intel lands where every other observed change lands, instead of in a parallel store. The proposal row survives as the audit link (`acceptedChangeId`). Rejected: writing accepted intel into the `user*` fact-correction columns (those are the owner's manual overlay, and merging free-text claims into structured fact columns is an LLM job — a later "fold into profile" agent action through the same accept queue, not this sprint).

### 3.4 `propose_segment`: **OUT of this sprint** (ruling)

Reserved in the `targetKind` vocabulary, not built. Grounds: segment vocabulary creation already has two governed paths (owner direct-add; discovery-agent proposals at the onboarding sprint, ADR 004 §1) and no §4a story pulls it the way Slack-intel pulls the other two; a third write tool dilutes the sprint's proof burden (the queue + the seat seam) without adding a new mechanism — an MCP-proposed segment would be mechanically identical to `propose_competitor_intel` with a different target. Cost of deferral: one additive tool later, zero schema (the vocabulary is reserved). Revisit on first real demand ("my Claude noticed a new segment in the sales calls").

### 3.5 Provenance shape for MCP writers (one shape, shared)

`shared/provenance.ts`:

```ts
export const mcpProvenanceSchema = z.object({
  via: z.literal("mcp"),
  client: z.string().nullable(),      // INFERRED from initialize clientInfo ("claude-desktop 1.x") — never asked
  sharedBy: z.string(),               // REQUIRED from the tool call — user-stated, "unattributed" permitted
  keyId: z.string().nullable(),       // reader-key id when one exists (5b); null on owner seat
  detail: z.string().nullable(),      // optional free text ("from #competitive-intel thread")
  at: z.string(),                     // ISO, server-stamped
});
```

Required vs inferred, precisely: the tool schema **requires** `shared_by` (the human origin — the one thing only the user knows, and the §4a promise); the server **infers** `client`, `keyId`, `at` (things the caller would only get wrong). Rendered as: *"via Claude Desktop · shared by Maria (#enterprise-deals) · 4 Aug 2026"*. Columns: additive `feedback_entries.provenance` jsonb and `competitor_changes.provenance` jsonb (nullable — agent-written rows carry their existing sourceType/sourceUrl provenance and leave it null), plus the `intel_proposals` column above.

### 3.6 No LLM in MCP handlers (hard rule)

Tool handlers never call `callLLM`, never start enrichment, never trigger agents. This is what makes headless writes safe (§1.3), keeps tool latency interactive, keeps BYO-key spend attributable to visible agent runs, and enforces the §10a boundary structurally — the MCP surface cannot grow a generation feature by accident. CI-greppable: `server/mcp/` imports nothing from `server/lib/llm/`.

### 3.7 Rate and abuse considerations (explicitly minimal)

For the v1 solo surface: **no rate limiting, deliberately.** The caller is the owner's own AI on the owner's own machine writing to the owner's own database; a quota would protect them from themselves at the cost of breaking legitimate bulk capture ("log these 40 quotes from the research session"). The guardrails that do exist are correctness guardrails: Zod length caps, the `log_feedback` dedup key, proposal review before anything touches tracked context, and `mcp_activity` making volume visible on Context Health. Revisit at 5b (reader keys over LAN): per-key daily write-attempt caps become worth having there — noted in §4, not built now.

---

## 4. Reader-seat groundwork (design now, enforce in 5b)

### 4.1 The caller seam

`server/mcp/caller.ts`:

```ts
export interface McpCaller {
  seat: "full" | "reader";
  userId: string;               // owner's LOCAL_USER_ID today; key's createdByUserId later
  keyId: string | null;         // null on owner seat
  productScope: string | null;  // per-key product pin (ADR 003 §4) — 5b
}
export function resolveMcpCaller(req): McpCaller   // today: always the owner, seat "full"
export function requireWriteSeat(caller): void      // throws ReaderSeatError on "reader"
```

Both write tools call `requireWriteSeat` **from day one** (it just never fires in solo mode). This is also where the **licence state** slots at the licensing sprint: `seat` becomes a function of (key audience × install licence state), so the trial-expiry reader state (settings-spec §6.3 — "MCP still serves, writes refused") reuses this exact check. One seam, two gates, no second implementation. Read-side, the seam is where ADR 003 §4's reader visibility rules attach later (per-module audience flags — e.g. commercial context excluded from readers; per-key product scoping): each read tool will filter through the caller, which is why every tool already receives it.

### 4.2 The refusal shape (the upgrade moment, specified now)

`ReaderSeatError` serialises as an `isError` tool result whose text the model relays:

```json
{
  "error": "reader_seat",
  "message": "This connection has a free reader seat on this team's context — it can read everything shared with it, but writing (logging feedback, proposing intel) needs a full seat. Ask <owner name> to add one, or see discoveree.com/seats.",
  "requested_write": { "tool": "log_feedback", "arguments": { …echoed verbatim… } }
}
```

Decisions embedded: the echo means **nothing the user typed is lost** — the model can hand the text back or retry after upgrade; the message names the owner (the sales motion is a conversation with a colleague, not a checkout link cold); no price in the machine-readable payload (copy/pricing live on the website; the message stays true if pricing changes — final copy through the messaging log, brief §2a). The server `instructions` (§2.8) tell the model to relay refusals verbatim rather than paraphrase them away.

### 4.3 Connect-a-teammate: **split to sprint 5b** (recommendation + cost)

Brief §10 item 4 places the teammate flow inside the MCP sprint; recommend splitting it out as an immediate follow-on (**5a** = everything above; **5b** = read-sharing), because 5b's real content is not MCP code: opt-in non-loopback bind + firewall/OS-permission UX, `mcp_api_keys` mint/revoke UI + Bearer auth middleware, per-key product scoping (`mcp_api_keys.productId` — ADR 003 §4's numbered migration lands in 5b with its first consumer, *flagged as a deferral of ADR 003's "at the MCP sprint"*), the QR/paste-snippet flow, reader-refusal live-fire, and per-key write-attempt caps (§3.7). Estimate: roughly half of what 5a is — small, but it is trust-and-UX work that shouldn't be rushed into the same review as the core surface. What 5a ships so 5b is pure addition: the caller seam and refusal path (built, tested with a forced-reader test fixture), the `keyId` slot in provenance and `mcp_activity`, and stateless HTTP (readers reconnecting cost nothing). *Flagged against brief §10 item 4 — sequencing within the sprint pair, no scope dropped.*

---

## 5. Registration: onboarding step 3 and the Settings snippet

### 5.1 One resolver, always-true snippets

`server/mcp/cliInvocation.ts` — `resolveCliInvocation(): { kind: "packaged" | "dev", command: string, args: string[] }`. Dev era: the repo-absolute `npx tsx <repo>/server/cli/discoveree.ts mcp serve`. Packaged era (sprint 7): the bundled binary path. `GET /api/settings/mcp-config` returns per-tool snippets built from this resolver + `serverPort.ts`, so the Settings/Connections page (and onboarding step 3 when the wizard sprint lands) renders snippets that are **copy-paste-true for the install rendering them** — never a hardcoded string that lies on someone's machine.

### 5.2 The snippets (Settings → Connections, this sprint; wizard reuses them)

- **Claude Desktop** (stdio only): `claude_desktop_config.json` block — `{ "mcpServers": { "discoveree": { "command": <resolved>, "args": [...] } } }`.
- **Claude Code**: both options — `claude mcp add --transport http discoveree http://127.0.0.1:7317/mcp` (simplest while the app runs) and a `.mcp.json` stdio block with `--product <slug>` for the project-repo pattern (brief §8).
- **Cursor**: `.cursor/mcp.json`, same dual choice.
- **ChatGPT**: shown honestly as **not connectable in v1** — ChatGPT connectors require a remote HTTPS endpoint, the same constraint as claude.ai in the browser; both are the team-tier remote connector (brief §8). The card says so and links the team-tier interest hook rather than pretending.

Presentation rule: lead with **HTTP-while-app-runs** ("simplest — works whenever Discoveree is open"), offer **stdio** as "always available, even when the app is closed" — honest about the dev-era PATH reality (stdio needs the repo checkout + `npx tsx` until packaging; the resolver makes the snippet correct, the copy makes the trade-off plain). Post-packaging, stdio becomes the headline default.

### 5.3 CLI surface

`discoveree mcp serve [--product <slug>] [--data-dir <path>]` (`--data-dir` maps onto the existing `DISCOVEREE_DATA_DIR` resolution; no second path routine — ADR 001 §2's one-resolver rule). `package.json` gains `"bin": { "discoveree": "./bin/discoveree.mjs" }` now so `npm link` works for dogfood and the name is settled before packaging. No other subcommands this sprint — the brief is explicit that the CLI is a launcher, not a CLI product.

---

## 6. Module structure, extraction map, and the rest

### 6.1 Files

```
server/mcp/
├── registry.ts        # NEW — declarative ToolDef[]: { name, description, category,
│                      #   inputSchema (zod), handler(ctx, caller, args) }. Single source for
│                      #   server registration, the docs endpoint, and reader-seat filtering.
│                      #   Replaces the SaaS _registeredTools private-API introspection.
├── server.ts          # buildMcpServer(ctx, caller): McpServer from the registry + instructions
├── http.ts            # mountMcp(app): POST/GET/DELETE /mcp — stateless per-request transport
│                      #   (ports routes.ts:35226–35283 pattern), allowedHosts, activity logging
├── caller.ts          # §4.1 seam: resolveMcpCaller / requireWriteSeat / ReaderSeatError
├── payloads.ts        # _context envelope, pagination helpers, deterministic error shapes (§2.3)
├── tools/read.ts      # §2.2 — thin wrappers over module services + existing route serialisers
├── tools/write.ts     # §3.2/§3.3
├── activity.ts        # mcp_activity writes + summary read (Context Health panel endpoint)
└── cliInvocation.ts   # §5.1
server/cli/
├── discoveree.ts      # bin entry: arg parsing, `mcp serve`
├── mcpServe.ts        # §1.1 decision flow; headless open mirrors main.ts minus scheduler/agents
└── proxy.ts           # §1.5 transport bridge + --product pin middleware + reconnect flow
shared/provenance.ts   # §3.5
server/modules/competitors/   # intel_proposals storage/service/routes additions (§3.3)
```

Placement rules honoured: `server/mcp/` is a consumer of module **services/serialisers** (like routes are) and imports no module routes; modules never import `server/mcp/`; the read tools re-use `toCompetitorCard`/segment serialisers rather than projecting twice (export them from the modules where not already exported). `server/mcp/` importing `server/lib/llm/` is CI-banned (§3.6). App wiring: `main.ts` step 7 becomes `buildApp()` + `mountMcp(app)` on the same listener; the port already in the lock file needs no change.

### 6.2 Extraction map (SaaS → desktop; allowlist verdicts)

| SaaS source | Verdict | Notes |
|---|---|---|
| `mcpServer.ts` per-request stateless server construction (1–16) | **TAKE (pattern)** | Becomes `buildMcpServer(ctx, caller)`; org id from ctx, not parameter |
| `add_feedback` (197–231) | **TAKE-RESHAPED** → `log_feedback` | Provenance/attribution added; default-50 sentiment **dropped** (null → scored by pipeline); `teamId`/`competitorName` fields gone with the schema |
| `list_products` (20–33) | **TAKE** | + slug |
| `list_feedback_themes` (57–75) | **TAKE-RESHAPED** | Desktop `Theme` shape (aliases, evidence, confidence/coherence); `isCompetitor`/`competitorName` dropped (cut columns) |
| `list_competitor_changes` (77–97) | **TAKE-RESHAPED** | Entity-join feed (ADR 003 §2.4) replaces name-keyed rows |
| `get_full_strategy_context` (473–596) | **LEAVE** | Reads unported strategy fields + dead `products.competitors` jsonb; successor = `get_context_health` + module tools; a strategy read tool arrives with the Strategy port |
| `save_conversation_insight` (598–641) | **LEAVE — defer** | Table is in the baseline; design belongs with Threads/deep dives |
| `create_opportunity`, `create_task`, `list_team_members`, `list_goals`, `get_chief_of_staff_summary`, agent-build-loop tools (6) | **LEAVE — cut/unported modules** | Roadmap tools return with the Roadmap Review sprint, evidence-cited and human-accepted per brief §4 |
| Introspection block (646–756) | **LEAVE — replaced** | The `_registeredTools` private-API reflection and hand-maintained `TOOL_CATEGORIES` are superseded by the first-party declarative registry (category is a field; the sync test becomes unnecessary by construction) |
| `routes.ts:35226–35283` HTTP mount | **TAKE (pattern)** | Minus org-slug resolution and Bearer-key auth (returns in 5b on the caller seam), plus `allowedHosts` |
| `mcpClient.ts` | **LEAVE — later sprint** | Outbound MCP (data-tools/Connections, Roadmap sync). The proxy uses SDK transports directly, not this file |

### 6.3 Scheduler interactions: none (stated explicitly)

MCP handlers trigger no agents and take no LLM calls; the headless CLI never starts the scheduler; nothing registers a scheduled agent in this sprint. The only adjacency: writes made headless are *processed* by the app's existing catch-up pass on next launch — existing behaviour, no new hooks. ADR 004 §9's note that "the MCP-connection daily override returns at the MCP sprint" concerns `mcp_connections` **outbound** polling cadence — that belongs to the data-tools/Connections sprint, not this surface; *flagged as a re-home of that one line, not a drop.*

### 6.4 Migrations (all additive; baseline-fold optional if the window is open)

1. `intel_proposals` (new table, §3.3)
2. `feedback_entries.provenance` jsonb, `competitor_changes.provenance` jsonb (§3.5)
3. `mcp_activity` (new table, §2.7)
4. Vocabulary (Zod, no DDL): `sourceType "mcp"` on feedback; `sourceType "internal_report"` on changes
5. **Not now:** `mcp_api_keys.productId` (5b, with its first consumer — flagged §4.3)

### 6.5 Risks

| # | Risk | Recommendation |
|---|---|---|
| 1 | **SDK/protocol churn** (Streamable HTTP revisions; client transport support drift) | Exact-pin the SDK; the transport bridge and stateless mode isolate churn to `http.ts`/`proxy.ts`; canary e2e: spawn the CLI, list tools, call one read + one write over both transports |
| 2 | **Windows takeover** — the app-preempts-CLI handshake relies on SIGTERM; Windows signal semantics are degraded | Accept for the dev era (macOS-first dogfood); design note recorded: a portable fallback is a `db.lock.handover` request file the holder polls — implement in the packaging sprint if Windows testing shows unclean takeovers. Never ship Windows binaries before this is proven |
| 3 | **CLI-first-launch migrations**: after an app update, the first process to open the DB may be the headless CLI, which then runs `migrate()` (ADR 001 §3 already mandates this) | Correct by design; add the case to tests (CLI opens a dataDir one migration behind). Slow first response is acceptable; a failed migration must exit with a clear stdio error, never serve a half-migrated schema |
| 4 | **Two AI clients racing to spawn CLIs** | §1.4 first-holder-serves-HTTP; test matrix: app+CLI, CLI+CLI, CLI holder exits under sibling, app preempts holder with sibling attached |
| 5 | **Unauthenticated localhost surface** — any local process can read context and write feedback | Accepted, consistent with the existing API's trust model; DNS-rebinding protection ON (§1.5); revisit only if a real threat model (shared machines) emerges — the caller seam is where auth would attach |
| 6 | **Payload bloat blowing consumer context windows** (`get_segment` with many personas; big change feeds) | Caps + pagination (§2.2); envelope discipline; if dogfood shows pain, add `fields`/`summary` params — additive |
| 7 | **`get_context_health` scope creep into prose synthesis** | Counts and stamps only; no LLM (§2.6). The §10a boundary is a review item on every PR touching it |
| 8 | **Attribution fatigue** — models pestering users for `shared_by` | The `"unattributed"` escape + instructions tone ("ask once, accept unknown"). Monitor dogfood transcripts; loosening to optional would need an owner decision because it weakens the §4a provenance promise |
| 9 | **Proxy half-states** (upstream dies mid-call) | Bounded retry + honest JSON-RPC error; stateless server means no session to lose. The canary covers kill-the-app-mid-session |

---

### Summary of decisions

1. One MCP server, three run modes; the CLI decision flow rides the built lock handshake; **whoever holds the writer lock serves localhost HTTP and everyone else proxies** (headless CLI publishes its port via `setMcpPort`); the proxy is a transport-level bridge; stateless Streamable HTTP; bind 127.0.0.1 with DNS-rebinding protection; app preemption hands the CLI over to proxy mode rather than dropping the session (ADR 001 §2 refinement).
2. **Headless writes rule:** the headless CLI takes the writer lock (no read-only PGlite mode exists; it is the single writer while holding it) and MCP writes execute identically app-open or app-closed — no refusal, no side queue; safe because MCP handlers are pure data writes (no LLM, no enrichment, no scheduler) and the app's catch-up pass processes them later.
3. Read surface: tools only (no resources in v1); 10 read tools wrapping the existing route serialisers with stable IDs, citations, ISO freshness stamps, honest absence, and a `_context` envelope; ADR 003 §1.2 product semantics implemented incl. `--product` pin enforcement in the proxy; `get_context_health` is computed, never synthesised; `mcp_activity` powers the consumption panel without ever logging payloads.
4. Write surface: **the gate follows the seat, not the transport** (flagged amendment to brief §4a.2) — owner-seat `log_feedback` is a direct add with `mcp` provenance (`shared_by` required, `client` inferred, sentiment null-not-50); `propose_competitor_intel` always queues into the new generic `intel_proposals` table, accept materialising an entity-keyed `competitor_changes` row (`internal_report`); unresolved competitor names queue as `new_competitor`, never auto-create entities; `propose_segment` is OUT (vocabulary reserved); no rate limiting on the solo surface, said explicitly.
5. Reader groundwork without licensing: the `resolveMcpCaller`/`requireWriteSeat` seam wired into both write tools from day one (also the future licence-expiry slot), the refusal shape specified (echoes the attempted write, names the owner, model relays verbatim); connect-a-teammate split to sprint 5b (LAN bind, key mint/auth, per-key product scoping, QR/snippet) — flagged against brief §10 item 4 as sequencing, not scope loss.
6. Registration: `resolveCliInvocation()` keeps Settings/onboarding snippets copy-paste-true across the dev (npx tsx + repo checkout, HTTP-first presentation) and packaged eras; Claude Desktop/Claude Code/Cursor snippets specified; ChatGPT and claude.ai shown honestly as team-tier remote connectors; `discoveree` bin name settled now.
7. Structure: `server/mcp/` (declarative tool registry replacing the SaaS private-API introspection) + `server/cli/`; SaaS `mcpServer.ts` ports 4 tools reshaped, leaves 10 with named destinations; `mcpClient.ts` defers to the Connections sprint; zero scheduler interaction; additive migrations only (`intel_proposals`, provenance columns, `mcp_activity`); `@modelcontextprotocol/sdk` is the sprint's only new dependency.
