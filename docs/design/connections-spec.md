# Discoveree Desktop — Connections

**UX specification · v1 (MCP sprint)**
**Date:** 4 August 2026 · **Author:** Product design
**Basis:** `docs/build-brief.md` §1 (the pitch this page makes tangible), §2 (reader seats, the upgrade moment), §4a (MCP write surface + provenance), §5 step 3 (AI-tools onboarding — the activation moment), §7 rung 1 (connect-a-teammate as the sales motion), §8 (stdio launcher + localhost HTTP; claude.ai remote is team-tier); `docs/design/001-db-seam.md` §2 (writer lock, CLI proxy-or-open); `docs/design/layout-direction-2a.html` (the home Serving line and the footer `MCP serving :7317` segment); `docs/design/onboarding-and-home-spec.md` §A.3 (per-tool panels, first-query confirmation) and §B.4 (consumption panel); `docs/design/competitors-module-spec.md` and `customers-module-spec.md` (house idiom, proposal gate, provenance registers); `docs/design/settings-spec.md` Part 4 (the Connections stub door this page replaces).
**Status:** Ready for build. Spec only — nothing here is implemented. Items marked *(ADR 005)* are pinned assumptions the tool-surface ADR may overrule; each names what changes if it does.

**Typography amendment (4 Aug 2026, owner-final):** mono usage in this spec is superseded by `docs/design/typography-ruling.md` §0 — everywhere this document says "mono" (kickers, meta/attribution lines, stamps, chips, badges, footer, figures), render Inter at the ruling's sizes/greys, with tabular-nums where digits align or tick. Mono survives only in the developer-artifact class: config snippets, commands, the copyable prompt chip, and key-mask/address fields.

All copy is final British English unless marked *(placeholder)* or *(decision needed)* — the display-locale seam handles en-US rendering. Layout terms refer to the implemented shell: dark 84px rail, 48px top bar with ⌘K, centred **720px** prose-first column, 30px mono status footer. Tokens as in `HomePage.tsx`: `text-ink`, `text-body`, `text-faint`/`text-ghost`, `text-label` mono kickers, `text-teal-deep` actions, `edge-hairline`, `edge-input`, `bg-chip`.

---

## 0. Shared conventions for this page

### 0.1 Grammar position

- **Connections is a Level-1 Overview**: one scannable page of blocks, no tabs. Its blocks are **connections, not context objects**, so — as on Settings — "materialise only when populated" applies to content *within* blocks (a reader row, a write-attempt row, a checking row), while the tool rows themselves are honest prerequisites that always render for job-5 users (0.5).
- **Doors to this Overview:** the rail item **Connections**; the home **Serving line** (every segment of it — 6.2); the footer's **`MCP serving :7317`** segment (which becomes a door with this sprint — 6.3); the Settings Connections block's names and **"Open Connections →"**; onboarding step 3's closing note ("You can connect tools any time").
- Blocks are **anchored** (`/connections#serving`, `#claude`, `#cursor`, `#chatgpt`, `#custom`, `#readers`, `#checking`) with the standard one-time landing highlight (600 ms teal 5% tint fade).
- Nothing on this page is an Object with an "Explore this" — connections are plumbing, not context. The context objects this page *cites* (module areas a tool reads, a proposal's target competitor) link out normally.

### 0.2 Gating *(decision needed — one-line amendment to onboarding §C.4)*

The rail item and page render when **any connection-bearing job** is enabled: job 5 (AI tools — the serving and readers blocks) and/or a data-tool job (jobs 2/4 — the checking block). Blocks gate independently: a job-4-only user sees Checking without Serving; a job-5-only user sees Serving without Checking. Onboarding §C.4 currently says "Connections (only if job 5)" — this spec proposes the wider rule so data-tool management has exactly one home and the Settings block stays a pure door (settings-spec §0.2 "no duplication"). Flagged in Appendix C.

### 0.3 Vocabulary (name things users recognise)

| Concept | Word used in UI | Notes |
|---|---|---|
| The MCP server | **serving** / "your context is served" | "MCP" is used — this audience configures MCP tools daily — but always with a plain-words clause the first time it appears in a block. Never "server process", "transport", "endpoint" in copy. |
| stdio transport | **the `discoveree` command** | Named by what the user pastes, not by its transport. Its defining property in copy: *"answers even when this app is closed."* |
| HTTP transport | **the local address** | `http://localhost:7317/mcp` (mono). Defining property: *"while this app is open."* |
| A teammate's connected tool | **reader** | Free, read-only. Never "guest", "viewer licence", or "seat" (a reader is the absence of a seat). |
| A tool asking a question | **query** | Matches the home line ("118 queries this week"). Never "request", "call", "invocation" in copy. |
| Intel pushed in by the user's AI | **arrived via Claude** (or the actual tool name) | The §4a proposals. "Arrived", not "synced" or "imported" — a person shared it and an AI carried it. |
| Consumption areas | module names, lowercase in prose | "reading mostly competitors and feedback themes" — the top areas a client read this week *(ADR 005: assumes tool-call logs carry an area tag; if reads are one untagged tool, this fragment is simply absent — the row renders without it, no gap)*. |

### 0.4 Colour and motion discipline (inherited, restated)

- **Amber** = a consequence or an ageing wait (tool configured but never heard from; a stale poll). Never red.
- **Destructive** = an attempt that failed (port in use, Jira unreachable) — always with "couldn't" and a retry.
- **Teal** = actions, links, and the just-connected moment.
- **No spinners and no pulses in the column** — waiting states are mono stamps; the footer keeps the only permitted pulse. In-flight work shows as mono elapsed counters where it exists (`testing · 0:03`).
- Copy affordances: every mono config block and address carries a ghost **"Copy"** top-right, flipping to mono `copied` for 2 s. No toasts anywhere on this page — the row is the surface.

### 0.5 Honesty rules specific to this page

1. **Connection is confirmed only by a received query.** "Connected" is never claimed from a written config file — the first-query detection (onboarding §A.3) is the sole promotion path. A configured-but-silent tool says so.
2. **The two transports are described truthfully and separately.** The command answers with the app closed (headless CLI, or proxied to the app when it's open — ADR 001 §2); the local address needs the app open. No copy may blur this.
3. **Serving needs no API key and survives the reading-only licence state** (settings-spec §6.3). Say it where relevant — it is a selling point, and it means this page never inherits the amber no-key notice.
4. **Attribution reported by a tool is asserted, not verified.** "shared by Maya in #sales-eu" is what Claude passed along; it renders in the asserted register (`bg-chip`, plain — the customers-module "added by you" treatment, 0.6 there), never as researched evidence. The human accept is the verification step.
5. **Readers never write, and refusals leave no side-channel.** A refused write retains the action kind and the named object only — never the content (holding the content pending "acceptance" would make readers writers with extra steps). The demand signal survives; the write does not.

---

# Part 1 — The Overview

## 1.1 Shape

Centred 720px column. Top bar breadcrumb: `Connections`. Structure, top to bottom:

1. **Kicker** — mono 11px uppercase: **"Connections · serving and checking"**. Right-aligned on the kicker line, the quiet action **"Connect a teammate"** (teal, 12.5px) — the sales motion sits at the top of the page, always visible (it scrolls to and opens 3.3).
2. **Lede** — 21px/1.5 prose, the page's state in at most two sentences (1.2).
3. **Blocks**, each with its own mono kicker, hairline-divided, fixed order:
   `SERVING` (1.3) → `YOUR AI TOOLS` (Part 2) → `READERS ON YOUR NETWORK` (Part 3) → `CHECKING` (Part 5).
   Order never changes with state; blocks gate per 0.2. Absent blocks leave no gap or ghost.

## 1.2 The lede — copy logic

Assembled from real state, most useful truth first. Priority order:

1. **Proposals waiting (outranks everything — it is work for the human):** *"`2` pieces of intel arrived via Claude and are waiting for your review."* — "your review" links to the owning module's review block (Part 4).
2. **Healthy consumption:** *"Your context answered `140` questions this week — `118` from Claude, `22` from Cursor — and `2` teammates are reading over your network."* Counts mono; tool and reader names are anchors into their rows.
3. **Configured, waiting:** *"Claude is set up but hasn't asked anything yet — the test prompt below is the quickest way to check the wiring."*
4. **Checking clause (appended when the block exists):** *"Jira was checked `2 h` ago."* — or its amber/destructive state (5.2).
5. **Degraded (prepended, destructive tone):** *"The local address isn't serving — port `7317` is in use (7.2). Claude still gets answers through the `discoveree` command."* The failure and the honest survival in one breath.

Never more than two sentences plus one appended clause.

## 1.3 Serving status (`#serving`)

- **Kicker:** `SERVING`.
- **Block lede** (15px `text-ink`): **"Your context is served over MCP — the open standard your AI tools already speak. Two ways in: the `discoveree` command answers even when this app is closed, and the local address serves while it's open."**
- **Trust line** (12.5px `text-faint`): *"Serving reads your context directly — it needs no API key, costs you nothing per query, and keeps working in the reading-only state. Answers carry the same object IDs and sources you see on these pages."*
- **Mono-metered rows** (the Settings About treatment — label · value · state):
  - **The local address** · `http://localhost:7317/mcp` (mono, Copy) · `serving now` (`text-faint`). Failure state: 7.2.
  - **On your network** · `http://faiths-mbp.local:7317/mcp` (mono, Copy) · *"what readers connect to — see below"*. Renders only while the local address serves.
  - **The command** · `discoveree mcp serve` (mono, Copy) · `last used 3 h ago` (renders only when it has actually been spawned — no dash, no "never"). When the launcher is not on PATH, this row carries the caveat state (2.5).

No sparkline in v1 — the weekly counts in the lede and tool rows carry the story; a per-day chart is dashboard furniture the 2a idiom retired. *(If demand appears, it belongs here, not on Home.)*

---

# Part 2 — Your AI tools (`#claude` · `#cursor` · `#chatgpt` · `#custom`)

## 2.1 Block anatomy

- **Kicker:** `YOUR AI TOOLS` · right-aligned quiet action **"Connect a tool"** (teal — scrolls to the first unconfigured row and expands it).
- **Tool rows**, hairline-divided, **fixed order: Claude · Cursor · ChatGPT · Custom or my own agents.** Order never changes with state (Claude first: stdio-capable and the wedge). Each row renders in exactly one of the states below. The Claude row covers Desktop and Code together — one setup, two clients; consumption splits them (2.2).

## 2.2 Row state — connected (a query has been received)

- **Name line:** tool name 15.5px/500 `text-ink` · right-aligned mono 12px stamp: `last query 14 min ago` (`text-faint`).
- **Meta line:** mono 12px `text-faint`: `118 queries this week · Desktop 96 · Code 22`. The per-client split renders only when more than one client identity has queried (Claude Desktop vs Claude Code, from MCP client info); otherwise just the count.
- **Reading line** (13px `text-faint`, renders only when area tags exist — 0.3): *"Reading mostly `competitors` and `feedback themes`."* — top two areas, each a link to its module Overview. This tells the owner what their AI actually values.
- **Proposals fragment** (only when > 0): appended to the meta line in teal mono: `· 2 proposals awaiting review` — a door to Part 4's queue in the owning module.
- **Quiet hover actions** (12.5px): **"Show config"** (re-opens the setup panel read-only, for re-pasting after a machine move) · **"Forget this tool"** (`text-faint` — removes the row's history; the config on the tool's side is the user's to delete, and the copy says so: confirm body *"This clears Discoveree's record of Claude's connection. Claude's own config still points here until you remove it there."*).
- **The just-connected moment:** at the first query ever received from this tool, the stamp renders **"Connected — first query received `just now`"** (teal, mono timestamp) with the 600 ms tint fade, settling to the normal stamp on next visit. Identical copy and detection to onboarding §A.3 — it is the same event, observed from whichever surface is open. Real detection only (the server logs the client identity); never a timer.

## 2.3 Row state — configured, waiting

- **Name line:** tool name · right-aligned mono stamp: `waiting for its first query` (`text-faint` — **no pulse**; 0.4).
- **Line** (15px): *"Set up `today`. Ask Claude something about your product to test the wiring."*
- **Test prompt chip:** copyable mono chip (`bg-chip`, 12px): `What do you know about my product from Discoveree?` — the action the user can complete right now.
- **Aged variant (> 7 days without a query):** the stamp goes amber: `set up 9 d ago · never heard from`, and the line becomes: *"The config may not have been pasted, or Claude needs restarting after a config change."* with quiet actions **"Show the config"** and **"Set up again"**. Amber is an invitation to re-check, never an alarm — nothing is broken on our side, and the copy must not imply it is.

## 2.4 Row state — not set up

- **Name line:** tool name in `text-body` (honest prerequisite, not a locked module) · one-line description 13px `text-faint` · right-aligned **"Set up"** (teal).
- "Set up" expands the row inline (accordion; multiple may be open — no dialogue). The panels are the onboarding §A.3 panels, verbatim in behaviour and copy; restated here as the permanent home:

**Claude (Desktop & Code)** — *"Claude spawns Discoveree's context server directly — it works even when this app is closed."*
- Primary: **"Set up automatically"** — writes the stdio entry into `claude_desktop_config.json` and offers the `claude mcp add` command for Claude Code. On write success the row moves to the **waiting** state (2.3) — never to "connected" (0.5.1). On failure (file missing, permission denied) it degrades to the manual snippet with: *"We couldn't edit Claude's config — paste this in yourself:"*
- Secondary: **"Show the config instead"** — mono code block (13px JetBrains Mono, Copy, filename above: `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "discoveree": {
      "command": "discoveree",
      "args": ["mcp", "serve"]
    }
  }
}
```
- Helper (12.5px `text-faint`): *"This uses the `discoveree` command, which reads your local context directly — Claude gets answers even when Discoveree isn't running."*
- Claude Code teams note (12px `text-ghost`): *"Working in a shared repo? Add a `.mcp.json` so everyone's Claude Code finds this context."* + **"Copy project snippet"**.
- Not-installed detection: if no config file or app bundle is found, the automatic button is replaced by the snippet and: *"We couldn't find Claude Desktop on this machine — if it's installed somewhere unusual, the config below still works."*

**Cursor** — *"Point Cursor's MCP settings at Discoveree."* Same stdio snippet for `~/.cursor/mcp.json`, Copy, one-line where-to-paste instruction.

**ChatGPT** — *"ChatGPT connects to Discoveree's local address while the app is running."* The local address in mono (`http://localhost:7317/mcp`, Copy) and the honest note: *"This connection needs Discoveree open. For always-on access, use a tool that supports the command, such as Claude."*

**Custom or my own agents** — *"Anything that speaks MCP can read your context."* Both routes side by side — the command and the local address, each with Copy — plus **"Open the MCP reference"** (the in-app docs page listing tools, resources and IDs).

**Closing the loop on manual setup.** Only Claude offers "Set up automatically"; for every other tool — and for Claude's manual path — Discoveree cannot see the tool's config, so the user says when the wiring is done. Each manual panel ends with a quiet first-person action beneath the snippet: **"I've pasted it in"** (teal text button, 12.5px — the "I have a key" / "I only know the name" idiom), with a helper line (12.5px `text-faint`): *"Discoveree can't read other tools' settings — say when you've pasted, and it will listen for the first query."* Clicking collapses the panel and moves the row to **waiting** (2.3: `set up today` + the test prompt chip). This is a user assertion, and that is correct by the house rules: the user is the authority on their own actions, and the waiting state claims nothing about the tool — it says only that Discoveree is listening (the aged variant's "may not have been pasted" copy already allows for an assertion that didn't stick). Two alternatives rejected for the record: promoting on **Copy** would render `set up today` from a snippet that may never have left the clipboard — a false claim — and would move the row under the user mid-task; promoting on nothing would leave the test prompt and the aged nudge unreachable. Either way the assertion is a convenience, never a gate: **a first query promotes the row from any state** — a tool wired without saying so goes straight from unconfigured to "Connected — first query received `just now`" (2.2).

Beneath the block, stated once (12px `text-ghost`): *"claude.ai in the browser can't reach local machines — that needs the team tier's shared server."* Factual scoping, not a teaser.

## 2.5 The pre-packaging caveat state *(ADR 005 / packaging dependency)*

Pinned assumption: a `discoveree` CLI launcher exists and onboarding offers to put it on PATH. Until packaging lands (build-brief sequence step 7), or when the user declined the PATH install:

- Every stdio snippet renders **what will actually work on this machine**: the `command` value becomes the absolute launcher path (e.g. `/Applications/Discoveree.app/Contents/MacOS/discoveree`), and a quiet line below the block says so: *"The `discoveree` command isn't installed on your PATH yet, so this config uses the full path — it works the same."* with the action **"Install the command"** where the app can do it.
- The Serving block's command row shows the same absolute form.
- Rule: **the snippet is never aspirational.** A config the user pastes must work as pasted, on this machine, today. If ADR 005 changes the launcher name or arguments, only the snippet strings change — every state and behaviour here stands.

---

# Part 3 — Readers on your network (`#readers`)

## 3.1 Block anatomy

- **Kicker:** `READERS ON YOUR NETWORK`.
- **Block lede** (15px): **"Teammates read free. Their AI tools connect to this machine over your local network — read-only, no account, no licence. Changing the context — adding competitors, logging feedback — is what a full seat is for."** The seat model stated honestly in one breath: generous first, boundary second, no euphemism.
- **Reader rows** (3.2), then **write attempts** (3.4) when any exist, then the foot action **"Connect a teammate"** (primary teal, full-width quiet row — the same flow as the kicker-line action, 3.3).

## 3.2 Reader rows

A reader materialises the first time a query arrives from a non-local address — connecting *is* appearing; there is no registration step.

- **Name line:** reader label 15.5px/500 `text-ink` — hostname + tool until renamed: **"Priya's MacBook — Cursor"** · right-aligned mono stamp: `last read 2 h ago`.
- **Meta line:** mono 12px `text-faint`: `41 queries this week · reading mostly strategy`.
- **Overflow** (`…` ghost): **"Rename"** (inline edit — *"This is `Priya`"*; the label becomes "Priya's Cursor" everywhere, including the home Serving line) · **"Remove reader"** — confirm dialogue: title **"Remove Priya's Cursor?"**, body *"Their tool loses access until you share the address again."*, destructive confirm **"Remove"**. *(ADR 005: removal assumes a revocable per-reader credential — see Appendix C.3. If the ADR rules the LAN surface open, "Remove" only clears the row and the body copy must weaken to "their history here is cleared"; flag before build.)*
- A caption above the group, 12px `text-ghost`: *"Readers appear here the first time they ask something."*

## 3.3 Connect a teammate — the flow

Expands inline in the column (the column is the flow; no modal). Contents, top to bottom:

1. **Prose** (15px): **"Send a teammate this address — their AI tool reads your context over your local network."**
2. **The address**, mono block with Copy: `http://faiths-mbp.local:7317/mcp` — beneath it, 12px `text-ghost`, the raw-IP fallback: `also reachable as http://192.168.1.24:7317/mcp` (some networks don't resolve machine names; both are true, say both).
3. **Tool picker** — quiet segmented chips: `Claude · Cursor · ChatGPT · Custom`. Selecting renders the ready-to-paste config for *their* tool pointing at the network address (HTTP — the command can't cross machines, and no snippet may pretend it can), mono block with Copy.
4. **"Copy an invitation"** (teal text button) — copies a paste-into-Slack message: *"I'm sharing Ledger's product context from Discoveree. Point your AI tool at http://faiths-mbp.local:7317/mcp and ask it anything about the product — reading is free, nothing to install. (Needs my machine awake and both of us on the office network.)"* Product name and address are live values. The invitation is the honest pitch in the teammate's channel — this is the sales motion for the next seat, made frictionless.
5. **QR code — deferred to 5b** (ships with the teammate-flow polish; a dependency decision, not a design rejection). When it lands: 120px, right of the address block, encoding the network address, caption 12px *"for getting the address onto another device quickly"* — no claims that scanning "connects" anything. Per the no-dead-controls rule the flow ships without the slot until then; this paragraph reserves it.
6. **Honesty lines** (12.5px `text-faint`): *"Reading needs this app open, and both machines on the same network."* · *"claude.ai in the browser can't reach local machines — that's the team tier's shared server."*

No "waiting for teammate…" state — the flow closes when the user is done, and the reader row appears whenever the first query lands (3.2), with the home Serving line updating the same moment.

## 3.4 Write attempts — the upgrade moment, owner's side

When a reader's tool calls a write tool (`propose_competitor_intel`, `log_feedback`), the MCP surface refuses politely on the reader's side (the response offers a full seat — brief §2). On the **owner's** side, the attempt is recorded as a quiet sub-list inside this block, materialising only when attempts exist. This is deliberately **not a proposal card** — there is nothing to accept (0.5.5); it is a recorded fact with a door.

- **Row anatomy:** 15px `text-ink`: *"Maya's Claude tried to add a competitor — `Harvey` — readers can't write, so nothing changed."* · mono stamp `Tue 14:02` · actions **"Invite Maya to a full seat ↗"** (teal — opens the merchant-of-record add-a-seat checkout) · **"Dismiss"** (quiet; removes the row, no questionnaire).
- **What is retained:** the reader, the action kind, the named object (a name is metadata; the claim's content is not), and the time. The refused content itself is discarded — retaining it would make the accept queue a side-channel write path for free seats, which breaks the seat model at the exact point it's designed to hold.
- **Repeat attempts collapse:** *"Maya's Claude has tried to write `3` times this week — most recently a competitor, `Harvey`."* Demand is the message; a scroll of refusals is nagging.
- The same fact reaches the home Serving line as its quiet variant (6.2) — one sentence, same copy register, linking here. It never becomes a banner, a badge, or a modal: the upgrade moment is surfaced factually or not at all.

---

# Part 4 — Arrived via your AI (the §4a write surface, owner's side)

A **full seat's** own AI can push intel in: Claude reading the team's Slack calls `propose_competitor_intel`; a CRM-connected assistant calls `log_feedback`. Nothing lands directly — every arrival enters the owning module's review queue behind the standard accept gate (competitors ADR 002 idiom; customers-module-spec Part 6 table, "Review queue → per-item accept").

## 4.1 Where arrivals surface

- **The owning module's Overview** gains a **"Waiting for your review"** block (materialises only when items exist, above the main band): one row per pending item — title + attribution stamp — expanding inline to the full card (4.2). Accept and discard live there, in the module that owns the object.
- **The home digest** notes arrivals as standard finding rows (*"Intel about Harvey arrived via Claude — shared by Jonas in #sales-eu."*) whose action is **"Review →"**. The digest never carries the accept action itself — review happens where the object lives.
- **This page** shows only the counts: the teal proposals fragment on the tool row (2.2) and the lede's priority-1 sentence (1.2). Connections is where you notice; the module is where you judge. No duplicate queue.

## 4.2 The review card — "via Claude" provenance variant

The standard proposal card (competitors-module-spec 2.4 anatomy) with the MCP provenance treatment. Competitor-intel example:

- **Header:** **"Competitor intel — Harvey"** · mono chip `VIA CLAUDE` (`bg-chip`, plain `text-muted` — the **asserted register**, deliberately not the teal tint of researched evidence; 0.5.4).
- **Attribution line**, mono 12px `text-faint`: `shared by Jonas in #sales-eu · via Claude · 4 Aug`. Person and channel are what the tool reported *(ADR 005: assumes the write tools take optional `shared_by` / `where` parameters)*; when absent the line degrades honestly to `via Claude · 4 Aug` — never invented, never "unknown".
- **The claim, verbatim** — hairline-left-ruled 13.5px `text-body`, the words as they were shared: *"Lost the Meridian renewal to Harvey — they led with SSO and SCIM in the first call."* Verbatim with its origin kept; never a paraphrase presented as the quote.
- **Extracted fields** — quiet labelled lines (13px): **Competitor:** Harvey · **Claim:** leads enterprise deals with SSO and SCIM. What the tool structured, shown so the human can see what accepting writes.
- **EvidenceRow:** the arrival's origin chip (`via Claude · #sales-eu`) plus any links the tool passed. ≥ 1 by construction — an arrival with no origin cannot be constructed, the customers-module rule at the same component level.
- **Actions:**
  - Known competitor: **"Accept into Harvey's profile"** (primary teal) · **"Discard"** (quiet). Accept merges the claim with `mcp` provenance; wherever it is later cited, it carries its chip (`via Claude · #sales-eu · 4 Aug`) — auditable forever.
  - Unknown competitor: primary becomes **"Research and track Harvey"** — routes into the add-competitor flow pre-filled; on accept there, this claim files against the new profile with its provenance intact. The arrival is the invitation; the profile is still researched and human-accepted like any other.
- **Feedback variant:** header **"Feedback — from #support"**; verbatim + provenance line (`via Claude · shared by Priya in #support · 4 Aug` — the customers `mcp` source kind, 0.6 there); suggested theme as a quiet line (*"Reads like `CSV export limits` — its `19th` mention if you accept."*). **"Accept as feedback"** files it through normal matching; **"Discard"**. Accepted items behave as any feedback item, `mcp` chip in every attribution line.

Reader tools never reach this queue — they are refused at the surface (3.4), before a card can exist.

---

# Part 5 — Checking (`#checking`) — data tools, briefly

This block is deliberately light in this sprint: full Jira/Linear management (field editing, project pickers, outbound-sync detail) belongs to the Roadmap Review sprint; feedback sources are managed in Customers (customers-module-spec 2.4). This block is their one shared status surface.

## 5.1 Anatomy

- **Kicker:** `CHECKING`.
- **Block lede** (15px): **"Discoveree checks these on a schedule while the app is open, and catches up when you launch. Nothing is ever written to them without your explicit say-so."** (The onboarding §A.4 contract, verbatim.)
- **Rows**, hairline-divided:
  - **Jira** · mono meta: `jira.acme.com · 27 roadmap items · checked 2 h ago · daily` · quiet actions **"Test"** · **"Edit"** (expands the §A.4 credential fields inline) · **"Remove"** (confirm names the consequence: *"Roadmap Review keeps its current items but stops updating until you reconnect or keep a list by hand."*). One outbound honesty line beneath (12.5px `text-faint`): *"Suggestions you accept are created in Jira — that is the only thing ever written there."*
  - **Feedback sources** · *"managed in Customers"* · mono: `G2 · CSV import` · **"Open Customers →"** — a door, not duplicate management.
- **Empty (job 4 enabled, nothing connected):** one invitation row: *"Connect Jira or Linear — or keep a hand-typed list in Roadmap Review."* → **"Connect Jira"** / **"Connect Linear"** expanding the credential fields inline.

## 5.2 States

- **Test running:** the row's stamp segment reads teal mono `testing · 0:03` (elapsed counter). Success: `✓ found 3 projects` for 5 s, then the normal meta. Failure: destructive-quiet in-row with the provider's error, fields stay editable.
- **Poll failing:** destructive-quiet stamp `couldn't reach jira.acme.com · Tue 14:02` + **"Try again"** + **"View log"**. The staleness clock counts from the last *successful* poll (roadmap items go stale at 7 days per home §B.2); three consecutive failures escalate to the Home attention row only — this page never shouts.

---

# Part 6 — Day one, and the contracts with Home and the footer

## 6.1 The activation moment — day-one page

Job 5 chosen, nothing configured yet. The rail item renders dimmed (opacity .4, lighting to full weight when the first tool is configured — configuration is real work done; the first query lights the home line). The page centres vertically, day-one grammar:

- **Lede**, 23px/1.45: **"Everything Discoveree knows can answer questions wherever you work. Connect Claude, Cursor or ChatGPT — most take under a minute — then ask about your product and watch the answer arrive with sources."**
- Beneath: the four tool rows in their not-set-up state (2.4), Claude first with **"Set up automatically"** — the shortest path from this sentence to a working connection is one click and one question.
- The claude.ai scoping line (2.4, last line), and the serving trust line (1.3) as the closing helper — *"needs no API key, costs you nothing per query"* is part of the pitch.
- **The first win:** the moment the first query arrives, the row flips to **"Connected — first query received `just now`"** (2.2), the page assembles into its standard shape around that one real row, the footer's `MCP serving :7317` segment materialises, and the home Serving line renders for the first time. One question asked in Claude is the whole demo.
- If onboarding step 3 already configured tools, day one skips straight to the standard page with those rows in the **waiting** state and their test prompt chips — an action completable right now, carried over exactly (§B.4's contract).

## 6.2 The home Serving line — door + summary contract

The home line (`Serving · Claude 118 · Cursor 22 this week · 2 teammates reading · Connect another`) is the **summary**; this page is the **source**. The contract, mirroring `Local · 42 MB` ↔ Settings About:

- **Same source of truth:** every figure on the line is a figure on this page — per-tool weekly counts (2.2), reader count (3.2). They can never disagree.
- **Every segment is a door:** tool name/count → `/connections#claude` (etc.) with the landing highlight; "`2` teammates reading" → `#readers`; **"Connect another"** → `#serving` with the first unconfigured tool row expanded. *(The current `HomePage.tsx` renders these as static text/button — this sprint wires them.)*
- **Line variants:** tools waiting → *"Serving · Claude set up, waiting for its first query"*; nothing configured (job 5 on) → the invitation *"Serving · nothing is reading your context yet — Connect a tool"*; a write attempt this week appends the quiet upgrade fact: *"· Maya's Claude tried to write — full seats"* (links to `#readers`). Job 5 off → the line is absent entirely, per gating.

## 6.3 The footer segment

`MCP serving :7317` becomes a **door to `/connections#serving`** (a `FooterDoor` navigating to the page, not a Settings anchor — small extension to `StatusFooter.tsx`). States: `MCP serving :7317` (normal) · `MCP serving :7317 · Claude 118` (as in the 2a object-view mock, when width allows) · `MCP · not serving` (destructive-quiet text tone — a failure, not a choice; the page carries the detail, 7.2). On day one before any tool is configured the segment is absent (existing `footer.mcp` optionality).

---

# Part 7 — Empty, error and degraded states, gathered

| State | Where | Treatment |
|---|---|---|
| Job 5 off, no data-tool job | — | Page and rail item absent entirely (0.2) — not even a door |
| Job 5 on, nothing configured | 6.1 | Day-one activation page; rail item dimmed; never an empty list |
| Tool configured, waiting | 2.3 | Mono `waiting for its first query` + test prompt chip; no pulse |
| Tool configured, never queried > 7 d | 2.3 | Amber stamp `set up 9 d ago · never heard from` + re-check copy; nothing claimed broken |
| Automatic config write failed | 2.4 | Degrades to the manual snippet with "paste this in yourself" |
| Tool not installed / not found | 2.4 | Snippet + "if it's installed somewhere unusual, the config below still works" |
| CLI not on PATH | 2.5 | Snippets render the absolute path that works today + "Install the command"; never aspirational |
| **Port in use** | 1.3 / 7.2 | Destructive row: *"Couldn't serve on port `7317` — another app is using it."* + **"Serve on `7318` instead"**. On change, an honest follow-up line lists what needs re-pasting: *"ChatGPT and custom tools point at the old address — copy the new one."* (each name a door to its row, Copy beside). **Claude and Cursor via the command are unaffected — say so:** *"Tools using the `discoveree` command aren't affected."* Footer reads `MCP · not serving` until resolved |
| App closed (for HTTP consumers) | not a page state | The page only renders while the app runs; the *copy contract* everywhere (2.4, 3.3) states which routes need the app open, before the user finds out the hard way |
| Reader write attempt | 3.4 | Quiet recorded fact + invite action; content discarded; collapsed repeats; never a banner |
| MCP proposals pending | 1.2 / 2.2 / 4.1 | Lede priority 1 + teal count fragment; queue lives in the owning module |
| Jira/Linear poll failing | 5.2 | Destructive-quiet stamp + Try again + View log; staleness counts from last success; Home escalation only at 3+ failures |
| Reading-only licence state | whole page | Fully functional: serving continues, readers keep reading, tool setup works (writing a config file is not a context write). Only Part 5 "Edit"/"Connect" actions follow the global write-refusal grammar (settings §6.3) |
| No LLM key | whole page | No notice here — serving needs no key (0.5.3); Home owns the agents-paused message |

Nothing on this page renders "empty", a zero, or a dead control. Every state is working, an invitation with its action, or an honestly explained consequence with the remedy beside it.

---

## Appendix A — Data contracts (extends `client/src/mock/types.ts`)

```ts
export type McpToolId = "claude" | "cursor" | "chatgpt" | "custom";

/** Serving block (1.3). Port default 7317; configurable on conflict (7.2). */
export interface ServingStatus {
  httpPort: number;
  http: "serving" | { failed: "port-in-use" };
  /** "http://faiths-mbp.local:7317/mcp" — absent while http is failed. */
  lanAddress?: string;
  /** Raw-IP fallback line (3.3.2). */
  lanAddressIp?: string;
  /** Drives the 2.5 caveat: snippets render cliCommand verbatim. */
  cliOnPath: boolean;
  /** "discoveree mcp serve" or the absolute-path form — never aspirational. */
  cliCommand: string;
  /** Absent ⇒ segment not rendered — no dash, no "never". */
  cliLastUsedAgo?: string;
}

export interface ConsumptionStats {
  queriesThisWeek: number;
  lastQueryAgo: string;
  /** Renders only with >1 client identity: "Desktop 96 · Code 22". */
  byClient?: readonly { label: string; queries: number }[];
  /** Top 2 areas; absent ⇒ reading line not rendered (ADR 005 area tags). */
  readingMostly?: readonly { areaId: ModuleId; label: string }[];
}

export type ToolRowState =
  | { kind: "unconfigured" }
  | { kind: "waiting"; setUpAgo: string; agedDays?: number } // agedDays ⇒ amber variant
  | { kind: "connected"; stats: ConsumptionStats; justConnected?: boolean };

export interface McpToolRow {
  id: McpToolId;
  name: string;                       // "Claude", "Custom or my own agents"
  description: string;                // the one-line 2.4 description
  transport: "stdio" | "http" | "both";
  state: ToolRowState;
  /** Teal meta fragment + lede priority 1; door to the owning module's queue. */
  pendingProposals?: number;
  /** Config snippet(s) as rendered — already resolved against ServingStatus. */
  snippets: readonly {
    filename?: string;                // "claude_desktop_config.json"
    body: string;                     // mono block content, copy-ready
  }[];
  /** "We couldn't find Claude Desktop on this machine…" (2.4). */
  notFoundNote?: string;
}

export interface ReaderRow {
  id: string;
  /** "Priya's MacBook — Cursor" (hostname + tool) until renamed. */
  label: string;
  /** Owner-set name; when present the label renders "Priya's Cursor". */
  renamedTo?: string;
  stats: ConsumptionStats;
}

/** 3.4 — the recorded refusal. Content is NEVER retained (0.5.5). */
export interface WriteAttempt {
  id: string;
  readerLabel: string;                // "Maya's Claude"
  action: "add-competitor" | "log-feedback" | "other";
  /** Name only — metadata, not the claim's content. */
  objectName?: string;
  at: string;                         // "Tue 14:02"
  /** Collapsed repeats: "has tried to write 3 times this week". */
  countThisWeek?: number;
}

/** 4.2 — the arrival card, rendered inside the owning module's queue. */
export interface McpArrivalCard {
  id: string;
  kind: "competitor-intel" | "feedback";
  title: string;                      // "Competitor intel — Harvey"
  /** The words as shared — verbatim, hairline-ruled, never paraphrased. */
  verbatim: string;
  attribution: {
    via: string;                      // "Claude" — from MCP client info
    sharedBy?: string;                // asserted, tool-reported (ADR 005)
    channel?: string;                 // "#sales-eu"
    date: string;
  };
  /** Known target ⇒ "Accept into <name>'s profile"; absent ⇒ research path. */
  targetObjectId?: string;
  targetName?: string;
  extracted?: readonly { label: string; value: string }[];
  /** ≥ 1 by construction — at minimum the origin chip. */
  evidence: readonly EvidenceRef[];
  /** Feedback variant: "Reads like CSV export limits — its 19th mention." */
  suggestedThemeLine?: RichText;
}

export interface CheckingRow {
  id: string;
  name: string;                       // "Jira"
  meta: string;                       // "jira.acme.com · 27 roadmap items · checked 2 h ago · daily"
  testing?: { elapsedS: number };
  testResult?: { kind: "works"; line: string } | { kind: "failed"; line: string };
  pollFailed?: { at: string; reason: string };
  /** The Feedback-sources door row renders from this variant. */
  door?: { line: string; href: string };
}

export interface ConnectionsOverview {
  lede: RichText;
  serving: ServingStatus | null;      // null ⇒ job 5 off (block + tools absent)
  tools: readonly McpToolRow[];
  readers: readonly ReaderRow[];
  writeAttempts: readonly WriteAttempt[];
  checking: readonly CheckingRow[] | null;  // null ⇒ no data-tool job
  /** Sum surfaced in the lede; per-tool splits live on the rows. */
  pendingProposalsTotal?: number;
}
```

`ServingSummary` on Home extends with door targets (`anchor` per consumer) and the optional write-attempt fragment; `FooterStatus.mcp` gains a companion `mcpFailed?: boolean` for the `MCP · not serving` tone (6.3).

## Appendix B — Review checklist

- Both themes: amber never-heard-from stamps, destructive port/poll failures, `VIA CLAUDE` chips, teal just-connected moments — all pass in light and dark (`colour/5` + `colour/20` tinted surfaces). (QR deferred to 5b — its white quiet-zone card in dark mode joins this checklist then.)
- Every mono element (`tabular-nums`): query counts, per-client splits, stamps, addresses, ports, snippets, attribution lines, elapsed counters.
- Copy grep against the `design_guidelines.md` substitution table — this page is licence-adjacent: **licence** (noun), **recognise**, **organise**; "Authorization" may appear only inside literal config snippets (code-identifier exemption), never in prose.
- **Honest-connection audit:** no state or copy claims "connected" before a query is received; "I've pasted it in" asserts pasting, never connection; a first query promotes a row from any state; waiting states carry no pulse; the aged state blames nothing.
- **Transport-truth audit:** every mention of the command says or implies "even when this app is closed"; every mention of the local address says or implies "while the app is open"; no teammate snippet uses stdio; the claude.ai scoping line is present, once.
- **Snippet audit:** every rendered snippet works verbatim on the current machine (PATH state respected); Copy affordance on every mono block; port changes propagate to every rendered address with the re-paste follow-up listing affected tools.
- **Seat-model audit:** write attempts retain action + name + time only (no content field exists in the contract); no accept affordance on an attempt row; the invite action goes to the add-a-seat checkout; reader removal copy matches the actual revocation capability (Appendix C.3).
- **Provenance audit:** `VIA CLAUDE` and attribution lines render in the asserted register (plain `bg-chip`, never teal-tint); attribution degrades to `via Claude · date` when fields are absent — no invented names; every arrival card has ≥ 1 evidence chip; accepted items carry their `mcp` chip wherever cited.
- **Grammar audit:** no tab bars; blocks in fixed order; the review queue lives in owning modules with no duplicate on this page; home Serving segments and the footer MCP segment land on the correct anchors with the highlight; unchosen jobs leave no trace of their blocks.
- Contract with Home: per-tool figures, reader counts and write-attempt facts are byte-identical between the Serving line and this page in every mock scenario.

## Appendix C — Decisions needed / ADR 005 dependencies

1. **Tool surface names and area tagging** *(ADR 005)* — this spec assumes `propose_competitor_intel` and `log_feedback` write tools, and that read tool-calls carry an area tag driving "reading mostly …". If reads are untagged, the reading line and area chips are absent (already handled: optional field, no gap); if tool names change, only Part 4 copy strings move.
2. **Attribution parameters** *(ADR 005)* — assumes optional `shared_by` / `where` parameters on the write tools, rendered as asserted attribution (4.2). If the ADR omits them, cards render `via Claude · date` only; the §4a provenance sentence ("shared by <person> in <channel>, via Claude") should then be flagged back to the brief.
3. **Reader access control** *(ADR 005 — the sharp one)* — proposed: a per-reader credential embedded in the shared address/snippet (zero-step for the teammate, revocable by the owner — "Remove reader" is real). An open LAN endpoint would contradict "Remove" and sit badly with §4b's commercial-context sensitivity; per-module reader visibility (commercial context excluded from the reader surface by default) is §4b's open question and lands with that module, but the credential seam should exist now.
4. **CLI launcher name, PATH install, packaging timing** *(ADR 005 / sequence step 7)* — drives 2.5. Whatever is ruled, the never-aspirational snippet rule stands.
5. **Gating amendment** *(owner sign-off)* — 0.2's "any connection-bearing job" rule needs a one-line amendment to onboarding §C.4 ("Connections (only if job 5)" → "Connections (any connection-bearing job)").
6. **Port default** — `7317` assumed throughout (matches the 2a mock and footer). Configurable only on conflict in v1; a free-choice port setting is deferred until someone asks.
