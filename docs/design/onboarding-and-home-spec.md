# Discoveree Desktop — Onboarding Wizard & Context Health Home

**UX specification · v1**
**Date:** 3 August 2026 · **Author:** Product design, with reference to `docs/build-brief.md` §4–§6 and `design_guidelines.md`
**Status:** Ready for build. Spec only — no components are implemented here.

All copy in this document is final, British English copy unless marked *(placeholder)*. Layout terms refer to the design system: shadcn/ui "New York", Inter for body text, JetBrains Mono for data/metrics/timestamps, light and dark modes both first-class.

---

## 0. Shared conventions

### 0.1 What replaces what

| Current SaaS | Desktop v1 |
|---|---|
| `ProductSetupForm.tsx` (details → LLM keys → billing) | 5-step onboarding wizard (this spec, part A). Billing step deleted — the licence key is entered at install, before onboarding begins. |
| `Homepage.tsx` (mentions, tasks, activity feed, Chief of Staff briefing, What's Next) | Context Health home (this spec, part B). It is a health view, not an activity feed. |
| Sidebar with ~15 destinations, product switcher, teams tree | Sidebar with at most 6 destinations + Settings, filtered by module gating (part C.4). |

### 0.2 Module gating — the one rule everything obeys

Onboarding step 2 produces a set of **enabled modules**. From that moment:

- Unchosen modules **do not appear anywhere**: not in the sidebar, not as home cards, not as empty states, not as locked teasers, not in search or command palette results.
- The only place an unchosen module can be discovered is **Settings → Add capabilities**, which lists the unchosen jobs in the same wording as onboarding step 2 and enables a module with one click (followed by that module's scoped interview questions, if any).
- Enabling a module later makes its sidebar entry and home card materialise, in the day-one empty-invitation state described in part B.

Always present regardless of step-2 answers: **Home** (Context Health), the **product profile** (an Object, reachable from the home summary), **Sources** (provenance is not optional), **Thought Partner** ("Test a product idea"), and **Settings**.

### 0.3 Typography and tokens used throughout

- Page titles 32px/700 tracking-tight; section headers 24px/600; card titles 18px/600; body 15px/400/1.6; helper text and labels 13px/500 tracking-wide.
- Every count, percentage, timestamp, duration, and query number renders in **JetBrains Mono** (`font-mono tabular-nums`). Prose never does.
- Timestamps are relative under 7 days ("14 min ago", "3 days ago") and absolute after ("21 Jul 2026"). Mono, 12px.
- Freshness/staleness colour: fresh = default muted foreground; **stale = amber** (`amber-600` light / `amber-400` dark); **failed/attention = destructive**. Never red for mere staleness.
- Both themes are first-class: every state below must be checked in light and dark. Tinted surfaces use the existing `colour/5` background + `colour/20` border pattern (e.g. `bg-amber-500/5 border-amber-500/20`) so they survive dark mode without bespoke dark variants.

### 0.4 Voice

Calm, specific, and second person. The product talks about *what it knows* and *when it last checked*, never about "AI magic". Empty states are invitations phrased as the first step of a job, not apologies. Forbidden words in copy: "unlock", "upgrade to see", "coming soon" (on modules), "empty".

---

# Part A — Onboarding wizard

## A.0 Frame and mechanics

**Entry:** first launch after licence-key entry (install flow, out of scope here). Re-entry: "Add capabilities" in Settings re-runs only the relevant steps, never the whole wizard.

**Window layout:** full app window, no sidebar. Content column `max-w-2xl mx-auto`, vertically centred with `p-8`. This is a desktop app: no marketing chrome, no logo wall — a small Discoveree wordmark (24px) top-left of the window only.

**Stepper:** horizontal, top of the content column. Circles 40px with number → checkmark on completion, 14px labels beneath, connecting progress line. Per the gating logic below, **the stepper renders only the steps that will actually run** and numbers them contiguously — a skipped step never appears greyed-out; it simply is not there. Labels:

1. Your product
2. What Discoveree does
3. Your AI tools
4. Your data tools
5. LLM keys

**Navigation:** `Back` (secondary/outline) and `Continue` (primary), right-aligned below the panel, 40px height. Steps that are individually optional carry a text button `Skip for now` centred beneath (13px, muted, underline offset-2 — matching the existing skip-link pattern). Wizard state persists locally; quitting the app mid-wizard resumes at the same step on next launch.

**Conditional steps (design decision, consistent with §5 gating):**
- Step 3 (Your AI tools) runs only if the job *"Feed context to my AI tools"* is selected in step 2. It is on by default (see A.2), so in practice nearly everyone sees it.
- Step 4 (Your data tools) runs only if at least one selected job consumes an external data connection: *Check we're building the most valuable things* (Jira/Linear) or *Understand customers and feedback* (feedback sources). Otherwise it is skipped and never shown.
- Steps 1, 2, and 5 always run.

---

## A.1 Step 1 — Your product

**Job:** one URL in, a drafted product profile and proposed competitor list out. This step must stay magical: the user types one thing and watches Discoveree assemble real knowledge with visible provenance.

### Layout

- Title (32px/700): **"Start with your product"**
- Description (16px, muted): **"Give us your product's website. Discoveree will read it, draft your product profile, and propose the competitors worth tracking. You'll review everything before it's saved."**
- One input (40px, full width), label **"Product website"**, placeholder `yourproduct.com`. URL normalisation as in the current form (prepend `https://` when missing; validate as URL).
- Primary button: **"Read my site"** (not "Continue" — the button names the magic).

Carry over from the current form, restyled to match:
- **Generic-name guard** — if the *detected* product name is a category word ("Platform", "App"), show the amber inline notice on the review screen: *"This looks like a category name rather than your product's actual name. Using your real brand name helps agents find accurate data."* Dismissable, editable inline.
- No org-name field (single-user desktop), no AI-provider choice here (keys are step 5; own keys are the default and only mode).

### States

**1 — Idle.** As laid out above.

**2 — Detecting (the magical bit).** On submit, the input locks and a staged progress list replaces the space below it. Each stage is a row: 16px icon, 15px label, right-aligned status (spinner → checkmark, mono timestamp of completion). Stages appear as they start, top to bottom:

- "Reading `acme.com`…" → "Read `acme.com`" ✓
- "Drafting your product profile…" ✓
- "Looking for your help centre and changelog…" ✓ *(help-centre crawler + changelog discovery; if found, the row states what was found: "Found help centre — `help.acme.com` · 214 articles")*
- "Proposing competitors…" ✓

Rules: stages are real (bound to actual pipeline events), never simulated. Total wait is typically under a minute; no percentage bar (we can't promise linearity), just staged rows. A muted line beneath: *"This usually takes under a minute. Everything found here is kept with its source, so you can always see why Discoveree believes something."* — the first mention of provenance; it sets the contract early.

**3 — Review draft.** The staged list collapses to a single line ("Read `acme.com` · 4 findings · 38 s" — mono figures) and the draft renders as a compact editable card stack:

- **Product profile card:** name (inline-editable), one-paragraph description (inline-editable textarea), detected links as chips (website, help centre, changelog, GitHub repo — each removable, each showing a small source icon). Card title: **"Your product — drafted from your site"**.
- **Proposed competitors card:** title **"Competitors we'd suggest tracking"** — a checklist (all pre-ticked) of up to 6 proposed competitors, each row: name, one-line reason (13px muted, e.g. "Mentioned alongside you in comparison pages"), untickable. Footer text button **"Add another"** revealing a small name+URL inline form. This card renders **only if** competitor proposals came back — if none, it does not appear (no empty shell), and competitor proposal re-runs after step 2 if the competitors job is chosen.
- Helper line under the stack: *"Nothing is final — profiles are living objects and agents keep them current."*
- `Continue` becomes enabled. `Back` returns to the editable URL.

**4 — Error / unreachable.** If the site cannot be read (timeout, 4xx/5xx, DNS): the staged row goes to a destructive-tinted state, and beneath it: *"We couldn't read that site. Check the address, or carry on and tell us the basics yourself."* Two actions: **"Try again"** (secondary) and **"Enter details manually"** (text button) which swaps in a minimal fallback form: Product name (required), one-line description (optional), website (optional, with the existing warning if blank: *"Without a website, Discoveree may struggle to find your competitors and customer segments."*). Manual entry proceeds to step 2 normally; the detection agent retries silently in the background later and merges (never replaces) what it finds.

**5 — Skip.** No skip on this step. A product identity is the root object; the manual fallback is the escape hatch.

---

## A.2 Step 2 — What should Discoveree do?

**Job:** choose jobs, not features. Each selection switches on exactly one module. This is the single source of truth for gating (rule 0.2).

### Layout

- Title: **"What should Discoveree do for you?"**
- Description: **"Pick the jobs you want done. Each one switches on a part of Discoveree — anything you don't pick stays out of your way entirely, and you can add it later from Settings."**
- A vertical stack of five large selectable cards (full width, `p-4`, rounded-lg border; selected = `border-primary bg-primary/5` with a leading checkbox; the whole card is the hit target — same selected-state pattern as the current AI-provider toggle). Each card: 16px/600 job title, 13px muted consequence line. Multi-select.

| # | Job (card title) | Consequence line (13px muted) | Module switched on |
|---|---|---|---|
| 1 | **Track competitors** | Profiles kept current by agents, changelog watching, review mining, comparisons. | Competitive Intelligence |
| 2 | **Understand customers and feedback** | Segments and personas, feedback gathered into themes with sentiment. | Customer Insights & Feedback |
| 3 | **Keep strategy sharp** | Vision, ambitions, pillars and goals as structured context — plus deep dives to explore growth options. | Strategy (incl. Deep Dives) |
| 4 | **Check we're building the most valuable things** | A weekly review of your roadmap against strategy, feedback and competitor moves — with evidence-cited suggestions you approve. | Roadmap Review & Suggestions |
| 5 | **Feed context to my AI tools** | Serve everything Discoveree knows to Claude, Cursor, ChatGPT or your own agents over MCP. | MCP serving + Connections surface |

**Defaults:** card 5 is pre-selected (it is the wedge and the pitch; unticking is allowed). Cards 1–4 start unselected — choosing is the point.

**Validation:** at least one job must be selected. With none selected, `Continue` is disabled with helper text: *"Pick at least one job to carry on."*

**Dependency hinting (not gating):** when card 4 is selected, a 12px muted line appears within it: *"Works best connected to Jira or Linear — we'll set that up in a moment."* No other cross-effects.

### States

- No loading or error states; this step is pure local selection.
- No skip.
- **Gating takes effect immediately on Continue:** subsequent steps filter their options (A.0), the eventual sidebar and home render only chosen modules, and the closing interview is scoped to the selection.

---

## A.3 Step 3 — Your AI tools *(runs only if job 5 selected)*

**Job:** get at least one external AI tool actually connected. This is the activation moment of the whole product — over-invest here.

### Layout

- Title: **"Connect your AI tools"**
- Description: **"Discoveree serves your product context over MCP. Pick the tools you use and we'll set each one up — most take under a minute."**
- Four selectable rows (tool icon 24px, name 16px/600, one-line description 13px muted). Selecting a row expands it in place (accordion; multiple may be open) to reveal that tool's setup panel.

Tools and their panels:

**Claude (Desktop & Code)** — *"Claude spawns Discoveree's context server directly — it works even when this app is closed."*
- Primary action: **"Set up automatically"** — writes the `discoveree mcp serve` stdio entry into `claude_desktop_config.json` (and offers `claude mcp add` for Claude Code). On success the button becomes a confirmation row (see States).
- Secondary: **"Show the config instead"** — reveals the ready-to-paste JSON snippet in a mono code block (13px JetBrains Mono, copy button top-right, filename shown above the block: `claude_desktop_config.json`):

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
- Helper line: *"This uses the stdio server, which reads your local context directly — Claude gets answers even when Discoveree isn't running."*
- A tertiary note (12px muted) for Claude Code teams: *"Working in a shared repo? Add a `.mcp.json` to your project so everyone's Claude Code finds this context."* with a **"Copy project snippet"** text button.

**Cursor** — *"Point Cursor's MCP settings at Discoveree."* Config snippet for `~/.cursor/mcp.json` (same stdio entry), copy button, one-line where-to-paste instruction.

**ChatGPT** — *"ChatGPT connects to Discoveree's local server while the app is running."* Snippet/instructions for its MCP (HTTP localhost) connection: shows the local URL in mono (`http://localhost:PORT/mcp`) with copy button and the note: *"This connection needs Discoveree open. For always-on access, use a tool that supports stdio, such as Claude."*

**Custom / my own agents** — *"Anything that speaks MCP can read your context."* Shows both transports side by side: the stdio command (`discoveree mcp serve`) and the localhost HTTP URL, each with a copy button, plus a text link **"Open the MCP reference"** (opens the in-app MCP docs page).

Honest limitation, stated once beneath the list (12px muted): *"claude.ai in the browser can't reach local servers — that needs the team tier's shared server."* This is factual scoping, not a teaser; it names no purchasable feature list.

### How success is confirmed

Each expanded panel has a live status row at its bottom, and this is the heart of the step:

- **Waiting:** pulsing dot (muted) + *"Waiting for the first connection… ask Claude something about your product to test it."* — with a suggested test prompt in a copyable mono chip: `What do you know about my product from Discoveree?`
- **Confirmed:** the moment the MCP server receives its first request from that client, the row flips to a green check + **"Connected — first query received `just now`"** (timestamp mono). The stepper circle for this step also gains a subtle green tint. This is real detection (server logs the client identity), never a timer.
- Confirmation is **not required** to continue; the same live status re-appears on the home MCP panel, so an unconfirmed tool isn't lost.

### States

- **Loading:** "Set up automatically" shows spinner + "Writing config…"; on failure (file missing, permission denied) it degrades gracefully into the manual snippet with the message *"We couldn't edit Claude's config — paste this in yourself:"*.
- **Tool not installed:** if we can detect absence (no config file/app bundle), the automatic button is replaced by the manual snippet and a 12px note *"We couldn't find Claude Desktop on this machine — if it's installed somewhere unusual, the manual config below still works."*
- **Skip:** `Skip for now` present. Consequence copy under it: *"You can connect tools any time from the home screen."*

---

## A.4 Step 4 — Your data tools *(runs only if job 2 or job 4 selected)*

**Job:** connect the systems Discoveree reads from — and, for Roadmap Review, writes accepted suggestions back to. Poll-based; no webhooks; say so, it's a trust point.

### Layout

- Title: **"Connect your data tools"**
- Description: **"Discoveree checks these on a schedule while the app is open, and catches up when you launch. Nothing is ever written to them without your explicit say-so."**
- Selectable rows with in-place expansion, same pattern as step 3. **The rows shown are filtered by the chosen jobs:**

*Shown when "Check we're building the most valuable things" is selected:*

- **Jira** — *"Read your roadmap items for the weekly review. Accepted suggestions are created back in Jira — only ever after you approve them."* Expanded: site URL, email, API token fields (password-masked), project picker after test. **"Test connection"** button → success: green check + *"Connected — found `3` projects"* (count mono); failure: inline destructive message with the provider's error, fields stay editable.
- **Linear** — same pattern; API key + team picker.
- **Neither — I'll keep a list by hand** — radio-style alternative (mutually exclusive with Jira/Linear selection): *"You can paste or type roadmap items into Discoveree; the weekly review works the same way."* No expansion.

*Shown when "Understand customers and feedback" is selected:*

- **Feedback sources** — a single row, not per-provider: *"Where does customer feedback land today?"* Expanded: the existing feedback-source options from the poller (e.g. review platforms, a shared inbox export, CSV import) as small checkboxes, with the note *"You can refine sources any time from Customer Insights."* Keep this deliberately light — deep source configuration belongs in the module, not the wizard.

*Always shown last:*

- **None of these for now** — clears other selections; helper: *"Connections live in Settings whenever you're ready."*

**v1 scope note (for build):** Slack and analytics connections are named in the brief's step outline but their v1 integrations are deferred (§3 cut list). They must **not** appear as disabled rows — omitted entirely until shipped, per the no-teaser rule. When they ship, they join this step and Settings → Connections.

### States

- **Loading:** per-row "Testing…" spinner on the test button; `Continue` never blocks on an in-flight test.
- **Error:** inline under the failing field group; never a toast (the user is mid-form).
- **Skip:** `Skip for now` present; consequence: *"Roadmap Review will wait for a connection or a hand-typed list."* (shown only if job 4 was selected; otherwise generic *"You can connect these later from Settings."*)

---

## A.5 Step 5 — LLM keys

**Job:** one key from any provider gets everything running; the router handles the rest.

### Layout

- Title: **"Add an LLM key"**
- Description: **"Discoveree's agents run on your own API keys — your data goes to your provider and nobody else. One key from any provider is enough: the router picks the best available model for each job and falls back across providers automatically."**
- **Mode toggle** (two-card segmented selection, carried over from current form): **"Individual providers"** — *"Separate keys for Anthropic, OpenAI, Gemini, Perplexity"* / **"OpenRouter"** — *"One key, access to 200+ models"*.
- Individual mode: four password inputs (Anthropic Claude `sk-ant-…`, OpenAI `sk-…`, Google Gemini `AIza…`, Perplexity `pplx-…`), each with a "Get key ↗" text link beside the label. All individually optional; at least one required to finish this step non-skipped.
- OpenRouter mode: one input + the existing explainer line.
- Trust line (12px muted, both modes): *"Keys are encrypted and stored only on this machine."*
- Search note (12px muted): *"A Perplexity, OpenAI or Gemini key also powers web search for competitor and market research."*

### States

- **Validating:** on Continue, each provided key gets a lightweight live check; per-field status (spinner → tick / destructive "This key was rejected by Anthropic — check it and try again."). Valid keys are saved even if a sibling key fails.
- **Skip:** `Skip for now` allowed but with plain consequence copy: *"Without a key, agents can't run — your context won't stay current until you add one in Settings."* Skipping sets a persistent (non-modal) amber notice on the home summary line (see B.1).
- **Finish button:** the last step's primary button reads **"Finish setup"**.

---

## A.6 Closing — introducing the scoped interview

After "Finish setup", one transitional screen (no stepper — the wizard is done):

- Title: **"Let's get the details only you know"**
- Body: **"Your site told us a lot; the rest lives in your head. Discoveree will ask a few questions — scoped to what you chose — and turn your answers into structured context your AI tools can use."**
- Beneath, a short list of what will be covered, built strictly from chosen modules, each with its module icon:
  - Strategy chosen → "Your vision, ambitions and pillars"
  - Competitors chosen → "Which competitors matter most, and why"
  - Customers chosen → "Who your customers are and where feedback comes from"
  - Roadmap Review chosen → "How your team decides what to build"
- Actions: **"Start the interview"** (primary) and **"Do this later"** (text button). "Do this later" lands on the Context Health home, where every gap the interview would have filled shows as an invitation — the home *is* the recovery path, so skipping costs nothing structurally.
- The interview itself reuses the existing AI-interview flow, restricted to the selected modules' question sets. On completion (or exit) → Context Health home.

---

# Part B — Context Health home

## B.0 Purpose and shape

Home answers three questions at a glance: **How complete and fresh is my context? What did my agents find? Who is consuming it?** It is not an activity feed and not a dashboard of product metrics — it is the health view of the context layer itself.

**Page structure** (single scrollable page, `px-6 lg:px-8`, content `max-w-screen-2xl`):

1. **Summary line** (full width)
2. **Module health cards** (grid `grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6`)
3. **This week from your agents** (left, ~2/3 width on lg) beside **MCP consumption panel** (right, ~1/3, sticky on lg)

The page header carries the product name (32px/700) with the primary action button **"Test a product idea"** top-right (opens the Thought Partner drawer — unchanged behaviour from the current home). Secondary header action: **"Explore this"** does *not* live here — threads spawn from objects, not from Home (see part C).

Blocks materialise only when they have something to be. Order is fixed (summary → cards → digest/MCP) but absent blocks leave no gap, ghost, or placeholder frame.

## B.1 Summary line

A single row, not a card. Left-aligned reading line in three segments separated by `·`:

> **`82%` complete** · **`2` items need attention** · agents last ran **`14 min ago`**

- Numbers and timestamp in JetBrains Mono 16px/600; surrounding words Inter 15px muted.
- **Completeness** = weighted average of per-module completeness (B.2) across *enabled* modules only. Clicking the percentage opens a popover breaking it down per module (mono figures, one row per module) — the honest arithmetic, always inspectable.
- **Items need attention** = count of stale objects + failed agent runs + unconfirmed connections. Clicking it scrolls to and briefly highlights the affected cards. Rendered in amber when > 0; segment omitted entirely when 0 (the line then reads "`82%` complete · agents last ran `14 min ago`").
- **Agents last ran** = most recent completed agent execution. If an agent is running now, this segment is replaced by a live segment: pulsing green dot + "`2` agents working now" (same live pattern as the current ActiveAgentsBanner, radically slimmed: name + elapsed mono timer per row in a thin collapsible strip directly beneath the summary line; the strip disappears 60 s after the last agent finishes).
- If LLM keys were skipped in onboarding: the summary line is preceded by a persistent amber notice bar (`bg-amber-500/5 border-amber-500/20`, full width): *"Agents are paused — add an LLM key to keep your context current."* + button **"Add a key"** (→ Settings → LLM keys). This is the only banner Home is allowed.
- Beneath the line, a subdued secondary row: **"Your product profile"** as a text link with its own freshness stamp ("verified `2 days ago`", mono) — the door to the product-profile Object (features inventory, links, changelog watch).

## B.2 Module health cards

One card per **enabled** module. `p-6`, rounded-lg border, entire card clickable (hover: subtle elevation) — **each card is a door** to its module Overview. Grid order fixed: Competitive Intelligence, Customer Insights, Strategy, Roadmap Review. (The MCP job renders as the consumption panel, not a card.)

### Card anatomy (populated)

- **Header row:** module icon 24px + card title 18px/600 + right-aligned freshness stamp (12px mono, muted): "checked `2 h ago`".
- **Completeness meter:** thin (h-1) progress bar + mono percentage. Module completeness is computed from schema coverage — the fraction of the module's defined context slots that are populated (e.g. Strategy: vision, ambitions, ≥1 pillar, current-period goals; Competitors: per-competitor profile fields filled ÷ expected). The formula per module is fixed and documented in the completeness popover (B.1) — never a vibe.
- **Two or three key figures** in a row (`grid-cols-2/3 gap-4`): mono 16px/600 value over 13px muted label. Per module:
  - Competitive Intelligence: `6` competitors tracked · `2` changes this week · `1` stale profile
  - Customer Insights: `12` themes · `48` feedback items this month · trend arrow on top theme
  - Strategy: `4` pillars · `3` goals on track (of `5`) · `1` open deep dive
  - Roadmap Review: `14` items in review · `3` suggestions awaiting you · last review "`Mon`"
- **Attention row (conditional):** materialises only when something is stale or failed. Amber text 13px with a chevron: e.g. *"Acme Corp not verified in `16` days — refresh?"* Clicking goes **straight to the affected Object**, not the module Overview.

### Staleness — how it's computed and displayed

Every context object carries `last_verified_at` (set by agent verification or human edit — this is the freshness accounting the brief demands, brief §10a.3). An object is **stale** when `now − last_verified_at` exceeds its type's threshold:

| Object type | Threshold | Rationale |
|---|---|---|
| Competitor profile | 14 days | Fortnightly verification cadence of update agents |
| Competitor changelog watch | 7 days | Hash-diff monitor should confirm weekly, even when nothing changed |
| Feedback theme | 7 days | Themes decay fast; a week without re-aggregation is a gap |
| Segment / persona | 30 days | Slow-moving |
| Strategy narrative (vision, pillars) | 90 days | Quarterly rhythm; also flagged at goal-period end |
| Goals | at period end | Driven by the goal period, not a fixed window |
| Roadmap items (from Jira/Linear) | 7 days since last successful poll | Poll failure = stale, surfaced here |
| Product feature inventory | 30 days | Re-crawl cadence of help centre/changelog |

Display rules: a module card shows the **count** of stale objects in its attention row and an amber dot on its freshness stamp. Staleness is *never* an error state — copy always frames it as an invitation to refresh ("refresh?" / "worth a fresh look"), and one click either opens the object or (where safe) triggers the refresh agent directly with a "Refreshing…" inline state. Failed agent runs, by contrast, use destructive colouring and the word "failed", with a "View log" link.

### Card empty-state variants (per card, exact copy)

An enabled-but-unpopulated module renders its card as an **invitation** — same size and position as the populated card, so the page shape doesn't lurch as data arrives. Anatomy: icon, title, one line of invitation copy (15px), one primary-styled small button. No meters, no zeroes — **never render `0` anything**.

- **Competitive Intelligence:** *"Who should Discoveree keep an eye on?"* → button **"Add a competitor"**. (If onboarding proposed competitors that await confirmation, instead: *"`4` proposed competitors are waiting for your review."* → **"Review proposals"** — an invitation with the work already done.)
- **Customer Insights:** *"Point Discoveree at your feedback and it will find the themes."* → **"Add a feedback source"**.
- **Strategy:** *"Define your vision — everything else hangs off it."* → **"Start with your vision"**. (This is the brief's canonical example: day one, Strategy is a single define-your-vision prompt card.)
- **Roadmap Review:** *"Connect Jira or Linear — or paste a list — and get your first weekly review."* → **"Add roadmap items"**. If a planning tool is connected but the first review hasn't run: *"First review runs `Sunday night` — or run it now."* → **"Run the first review"**.

As soon as the first real data lands, the invitation card is replaced by the populated card with whatever figures exist; sections within it that lack data simply don't render (a Competitive Intelligence card with competitors but no changes yet shows one figure, not three).

## B.3 "This week from your agents" digest

Section header 24px/600: **"This week from your agents"**, with a muted mono count badge of items. A single chronological list (not grouped by agent), max 10 items with **"Show earlier"** expander. This digest replaces both the activity feed and the Chief of Staff briefing — but it reports *changes to context and judgments made*, not app activity. Rows are compact (`py-3`, divided list, no per-row cards).

### Item anatomy (standard finding)

- **Leading icon** (16px), coloured by module.
- **Headline** 15px/500 — one specific sentence, the finding itself: *"Acme Corp launched usage-based pricing."*
- **Provenance line** 13px muted — the evidence, always: source favicon/icon + source name + mono timestamp: *"acme.com/pricing · changelog diff · `Tue 14:02`"*. Clicking a source chip opens the Source record (the provenance layer). **No digest item may render without at least one source chip** — evidence-cited is a hard rule, enforced at the component contract level.
- **Object link** — the headline links to the relevant Object (competitor, theme, goal…). Row-hover actions (ghost, 13px): **"Open"** and **"Explore this"** (spawns a deep-dive Thread on that object — see part C).

### Item variant: evidence-cited roadmap suggestion (the important one)

Suggestions from the Roadmap Review agent appear in the digest as a visually distinct row: left accent border (primary), suggestion badge. Anatomy:

- **Badge row:** `Suggestion` pill + type pill where applicable (`Quick win` — the folded-in quick-win agent) + confidence tag (13px muted: "high confidence").
- **Headline** 15px/600: *"Add self-serve data export to the roadmap."*
- **Reasoning line** 13px: *"A rising feedback theme with no roadmap coverage, and two competitors shipped it this quarter."*
- **Evidence chips** — the citation block, always present, one chip per evidence item, each a real link to the underlying Object/Source: `Theme: Data export requests (18 items, ↑)` · `Pillar: Reduce time-to-value` · `Acme changelog 12 Jul` · `Bream release notes 28 Jul`. Chips wrap; never truncated away.
- **Actions** (right-aligned, always visible on this variant — not hover-only): **"Accept…"** (primary, small) and **"Dismiss"** (ghost, small).
  - **Accept…** opens a confirm dialogue (max-w 600px): title **"Create this in Jira?"**, body shows exactly what will be written (target project, issue type, title, description including the evidence citations as links), and the primary button **"Create in Jira"**. *The agent never writes on its own; the ellipsis in "Accept…" is honest — a human confirmation always follows.* Success toast: *"Created in Jira as `PROD-482`."* with an "Open in Jira ↗" action. If no planning tool is connected, the dialogue instead offers **"Keep in Discoveree"** (stores as an accepted item) with a quiet link to connect a tool.
  - **Dismiss** asks one optional question inline (select: "Not valuable / Already planned / We have this / Not now") — feeding the evaluative agent — then collapses the row. Undo available in the toast for 5 s.
- Accepted and dismissed suggestions leave the digest; their full record lives on the Roadmap Review Overview.

### Digest empty state

Before the first agent pass: the section renders (it's a promise, not a blank) with a single quiet row: *"Your agents run on a schedule and catch up whenever you open the app. Their first findings will appear here."* If agents are currently running, the live strip (B.1) sits above and this line reads *"First findings are on their way — `2` agents are working now."* If LLM keys are missing, this section instead defers to the amber key notice (no duplicate nagging here).

## B.4 MCP consumption panel

Right column card, `p-6`, title 18px/600: **"Your context, being used"**. This panel is the growth loop made visible — it must feel alive.

### Populated anatomy

- **Consumer rows**, one per connected client (identity from MCP client info): tool icon + name (15px/500) + right-aligned weekly count in mono 16px/600: *"Claude — `118` queries this week"*. Beneath, 12px muted: last query time (mono) + **pulling-from summary**: the top context areas that client read this week, as tiny chips: *"mostly `Competitors` and `Feedback themes`"*. (Derived from tool-call logs; top 2 areas; this tells the owner what their team's AI actually values.)
- **Teammate rows:** readers connected over the local network appear as their own rows with a person icon and machine/tool label: *"Priya's Cursor — `41` queries this week · reading `Strategy`"*. A 12px caption above the group: *"Readers on your network — free, read-only."*
- **Sparkline** (optional, h-12) of total queries per day across the top of the panel, mono total for the week beside it.
- **Footer actions:** **"Connect a teammate"** (primary, full-width, small) — first-class, always visible; opens the connect flow: a dialogue with a QR code and a copyable config snippet for the teammate's tool, plus plain copy: *"Teammates read your context free. Their AI tools connect to this machine over your local network."* Secondary text button: **"Connect another tool"** (re-opens the step-3 panels as a sheet).
- **Read-vs-write moment:** when a reader's tool attempts a write (add competitor, log feedback), the MCP surface refuses politely and this panel records it as a quiet row: *"Priya's Claude tried to add a competitor — writing needs a full seat."* with a text link **"About full seats"**. This is the built-in upgrade moment, surfaced factually, never as a nag.

### Empty / early states

- **Tools configured in onboarding but no queries yet:** each configured tool renders with its waiting state carried over from step 3: pulsing dot + *"Waiting for the first query — try asking Claude about your product."* + the copyable test prompt chip. The panel is thus never blank for anyone who did step 3.
- **Step 3 skipped (or job 5 unticked — panel absent entirely in that case):** if job 5 was selected but no tool configured, the panel renders as an invitation: *"Nothing is reading your context yet. Connect Claude, Cursor or ChatGPT and your product knowledge goes wherever you work."* → **"Connect a tool"**. "Connect a teammate" remains visible beneath — the sales motion never hides.

## B.5 The day-one page, assembled

The empty product must look **early, never empty** — like a workshop the morning it opens, not an abandoned one. Day one (typical path: onboarding done, interview maybe skipped, agents' first pass running):

1. **Summary line:** completeness will be low — so reframe rather than shame. Below 25% complete, the line's first segment reads **"Your context layer is taking shape"** (no percentage; the popover still shows the honest arithmetic) — the percentage segment appears once ≥ 25%. The live agent strip is usually active here and does most of the "alive" work.
2. **Product profile row:** already real — drafted in step 1, freshness stamp "drafted `today`". Day one's proof that the machine works.
3. **Module cards:** every enabled module renders its invitation variant (B.2). Enabled-and-populated-by-onboarding cards (e.g. competitors confirmed in step 1) render populated immediately — the ideal day-one page has one real card among the invitations, showing the destination.
4. **Digest:** the promise row, or live "first findings on their way".
5. **MCP panel:** waiting states with test prompts — an action the user can complete *right now* to get their first win ("ask Claude about your product").

Nothing on this page ever says "empty", "no data", or renders a zero. Every block is either real, an invitation with one clear action, or absent.

---

# Part C — The Overview → Object → Thread grammar on these screens

The three-level grammar (brief §6) applied concretely:

### C.1 Doors to Overviews

- Each **module health card** on Home is a door: clicking anywhere on the card (except an inner attention link) opens that module's **Overview** — one scannable page of blocks that materialise only when populated. Day-one Strategy Overview = the single "define your vision" prompt card.
- The **sidebar** entries are the same doors (C.4). Home and sidebar are the only two ways to an Overview; Overviews are never nested inside each other.
- **"Connect a tool" / "Connect a teammate"** open flows (sheet/dialogue), not Overviews — connection management's full page lives under Settings → Connections.

### C.2 What opens an Object

Objects — competitor, segment, theme, goal, opportunity, suggestion, source, the product profile — are **linkable detail views owned by no tab**; every route to one is a direct link:

- Digest **headlines** → the Object the finding is about.
- Digest **evidence chips** and provenance chips → the cited Object or Source record.
- Card **attention rows** ("Acme Corp not verified in `16` days") → the affected Object directly, bypassing the Overview.
- The **product profile row** under the summary line → the product-profile Object.
- A **suggestion** is itself an Object: its digest row is a summary; "Open" shows the full suggestion view (all evidence, scoring against pillars/themes/moves, history), which is where Accept/Dismiss also live, identically.
- The completeness **popover's** per-module rows → that module's Overview (module-level), while named gaps within it link to the Object with the gap.

Objects are addressable (stable internal URLs) so MCP consumers and digest items can cite them symmetrically — the same ID a human clicks is the ID an agent cites.

### C.3 Where "Explore this" (Thread) appears

- **Every Object header** carries an **"Explore this"** action — the universal thread-spawner. It opens a deep-dive Thread with the specialist assistant appropriate to the object type, pre-loaded with that object as context.
- On **Home**, "Explore this" appears only as the hover action on digest items (B.3) — and it operates on the item's *Object*, not on the digest row: choosing it opens the Object with a new Thread started. Home itself is not an Object and can't be explored; the grammar stays clean.
- **Overviews** never carry "Explore this" at page level; blocks within an Overview that represent objects expose it per object.
- Finished Threads **file under their Object** (a "Deep dives" block on the Object view, materialising only when one exists) and become citable context — so a Thread's conclusions can later appear as evidence chips in suggestions.
- "Test a product idea" (Thought Partner) is deliberately *not* a Thread: it is the one standalone assistant, pressure-testing an idea against the whole context rather than exploring one object. It keeps its own home in the page header.

### C.4 Navigation under gating (for completeness)

Sidebar, top to bottom, rendering **only** enabled modules: **Home** · Competitive Intelligence · Customer Insights · Strategy · Roadmap Review · **Connections** (only if job 5) — then Settings pinned at the bottom with the theme toggle. No product switcher (single product per instance in v1), no org name, no teams tree. Sources is reachable from every provenance chip and from Settings, not a top-level destination. "Add capabilities" is a row inside Settings — the only place unchosen modules exist.

---

## Appendix — copy blocklist check

All copy above uses British English: *organise, analyse, prioritise, personalise, summarise; colour; behaviour; centre/help centre; licence (noun); dialogue; cancelled.* Reviewers should grep implemented screens for the American forms in the `design_guidelines.md` substitution table before merge; timestamps and figures must render in JetBrains Mono in both themes.
