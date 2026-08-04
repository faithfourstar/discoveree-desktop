# Discoveree Desktop — Settings

**UX specification · v1**
**Date:** 4 August 2026 · **Author:** Product design
**Basis:** `docs/build-brief.md` §2 (licensing), §3 ADAPT ("Settings slimmed: LLM keys, connections, agent schedules, licence"), §5 step 5 (LLM keys); `docs/design/layout-direction-2a.html` (idiom); `docs/design/onboarding-and-home-spec.md` (gating §0.2, staleness §B.2, the one-banner rule §B.1); `docs/design/competitors-module-spec.md` (colour discipline, stamp-as-control, no spinners in prose). SaaS reference for key-management behaviour only: `SettingsLayout.tsx` / `BillingTab.tsx` (masked-key contract, individual vs OpenRouter modes).
**Status:** Ready for build. Spec only — nothing here is implemented.

All copy is final British English unless marked *(placeholder)* or *(decision needed)*. Layout terms refer to the implemented shell: dark 84px rail, 48px top bar with ⌘K, centred **720px** prose-first column, 30px mono status footer. Tokens as in `HomePage.tsx`: `text-ink`, `text-body`, `text-faint`/`text-ghost`, `text-label` mono kickers, `text-teal-deep` actions, `edge-hairline`, `edge-input`, `bg-chip`.

---

## 0. Shared conventions for this page

### 0.1 Grammar position

- **Settings is a Level-1 Overview**: one scannable page of blocks, no tabs, no sub-navigation. The SaaS `SettingsLayout` tab bar (Users / Products & Teams / Workflow / Sources / Connections / AI Agents / Billing) does not return in any form.
- Its blocks are **controls, not context objects** — so the "materialise only when populated" rule applies to *content within blocks* (a provider row, an agent row, the Add-capabilities list), not to the control blocks themselves. A machine always has keys, schedules and a licence state to show or invite.
- Blocks are **anchored** (`/settings#llm-keys`, `#agent-schedules`, `#connections`, `#licence`, `#about`) so notices elsewhere land on the right block, which gets the standard one-time highlight (600 ms teal 5% tint fade — same as home §B.1).
- **Doors to this Overview:** the rail item **Settings**; the Home amber notice's **"Add a key"** (→ `#llm-keys`); and the **status footer segments**, which are doors, not decoration:
  - `Local · 42 MB on disk` → `#about`
  - `Agents idle · next run 21:00` (or `paused by you`) → `#agent-schedules`
  - `Licence to 14 Mar 2027` / `Trial · 9 days left` → `#licence`

### 0.2 What is deliberately not here

No billing history, no invitations, no org or user management, no seat lists (brief §3). No per-agent model pickers and no prompt editing — **the router chooses models; the schema owns the prompts**. No scoring-weight editor in v1 (the SaaS Prioritisation tab defers to the Roadmap Review sprint, where weights belong beside the review they shape). Sources is not managed here — it is a door (7.1), managed on its own surface.

### 0.3 Colour and motion discipline (inherited, restated)

- **Amber** = stale, ageing, or a consequence the user chose (no key, paused agents, licence running out). Never red.
- **Destructive** = an attempt that failed, always with "couldn't" or "failed" and a retry.
- **Teal** = actions and links.
- **No spinners in the column.** In-flight work shows as mono elapsed counters (`testing · 0:03`) — the competitors-module pattern.
- Tinted surfaces use `colour/5` background + `colour/20` border so both themes work without bespoke variants.

---

# Part 1 — The page

## 1.1 Shape

Centred 720px column. Top bar breadcrumb: `Settings`. Structure, top to bottom:

1. **Kicker** — mono 11px uppercase: **"Settings · this machine"**.
2. **Lede** — 21px/1.5 prose, the machine's state in at most two sentences (1.2).
3. **Blocks**, each opening with its own mono kicker, hairline-divided, fixed order:
   `LLM KEYS` → `AGENT SCHEDULES` → `CONNECTIONS` → `ADD CAPABILITIES` → `LICENCE` → `ABOUT & YOUR DATA`.

Order never changes with state — urgent conditions surface in the lede and the footer, they do not reshuffle the page.

## 1.2 The lede — copy logic

One or two sentences assembled from real state, most useful truth first:

- **Healthy, licensed:** *"Everything here stays on this machine. Agents run on your `Anthropic` and `Perplexity` keys — next run `Thu 09:00` — and you're licensed to `14 Mar 2027`."*
- **On trial (appended or replacing the licence clause):** *"…and you're on the free trial, `9` days left."*
- **No LLM key (amber clause, links to `#llm-keys`):** *"Agents are paused until you add an LLM key."* — carries the amber `RichText` tone.
- **All agents paused by the user:** *"You've paused the agents — nothing is being checked, and stamps are ageing."* (amber clause, links to `#agent-schedules`.)
- **Licence expired / trial ended:** *"Discoveree is reading-only just now — your context is safe and served, and edits resume with a licence."* (links to `#licence`.)

Mono figures throughout; competing clauses resolve in the order listed (key trouble beats licence trouble — a licence is worthless without a key).

---

# Part 2 — LLM keys (`#llm-keys`)

## 2.1 Block anatomy

- **Kicker:** `LLM KEYS`.
- **Block lede** (15px `text-ink`): **"One key from any provider is enough. The router picks the best available model for each job and falls back across providers automatically — more keys just mean more fallback."** — the onboarding step-5 framing, verbatim in spirit.
- **Trust line** (12.5px `text-faint`, directly beneath, always visible — this is the security honesty, part 2.6): *"Keys are encrypted and stored only on this machine, inside your local database. They are sent to exactly one place: the provider they belong to, when an agent makes a call. There is no Discoveree server for them to go to."*
- **Provider rows**, hairline-divided, fixed order: **Anthropic · OpenAI · Google · Perplexity · OpenRouter**. (Anthropic first because Claude-first customers are the wedge; OpenRouter last because it is the one-key-for-everything alternative and reads naturally as "or just this".)

## 2.2 Provider row — with a key saved

- **Name line:** provider name 15.5px/500 `text-ink` · mono tag `WEB SEARCH` (10px, `bg-chip`) on the rows whose key powers search (OpenAI, Google, Perplexity, OpenRouter — see 2.5) · right-aligned quiet actions: **"Test"** · **"Replace"** · **"Remove"** (12.5px; Test and Replace teal, Remove `text-faint`).
- **Key line:** mono 12px `text-faint`: the masked key + provenance: `sk-ant-…R4kQ · added 3 Aug · last used 14 min ago`. "Last used" renders only when the router has actually used it — no dash, no "never".
- **The masked-key contract:** the server stores keys encrypted and **only ever returns the mask** (scheme prefix + ellipsis + last four characters). The full key exists in the UI only inside an entry field before save, and is never displayed again after. There is no reveal-eye on saved keys — there is nothing to reveal. (This carries over the SaaS `••••`-return behaviour and hardens it: the desktop server has no unmasked read path at all.)

## 2.3 Provider row — no key

- **Name line:** provider name in `text-body` (not dimmed — these are honest prerequisites of an enabled capability, not locked modules) · `WEB SEARCH` tag where applicable · right-aligned **"Add a key"** (teal) and a **"Get key ↗"** ghost link (opens the provider's key page — `console.anthropic.com`, `platform.openai.com`, `aistudio.google.com`, `perplexity.ai`, `openrouter.ai/keys`).
- **"Add a key"** expands the row inline (no dialogue): one password-masked input (46px, `edge-input`, provider-correct placeholder: `sk-ant-…`, `sk-…`, `AIza…`, `pplx-…`, `sk-or-…`), primary teal **"Save and test"**, quiet **"Cancel"**. Paste-first: the field trims whitespace and strips accidental quotes.
- **OpenRouter row helper** (12.5px `text-faint`, only on this row): *"One OpenRouter key covers every job — models from all providers, including the ones that power web search."*

## 2.4 Test — honest result states

**"Save and test"** (on add/replace) and **"Test"** (on a saved key) run the same lightweight live call. While running, the row's key line swaps its trailing segment to teal mono: `testing · 0:03` — a live elapsed counter, no spinner. Results, rendered in place of that segment:

- **Works:** `✓ answered in 1.8 s` (teal, mono figure). Settles back to the normal key line after 5 s; `last used` updates.
- **Invalid key:** destructive-quiet text: **"Anthropic rejected this key."** with actions **"Replace"** (teal) and **"Remove"**. The row keeps the rejected key until the user acts — we never silently discard something they typed.
- **Provider unreachable:** destructive-quiet: **"Couldn't reach Anthropic — the key wasn't checked."** with **"Try again"**. The distinction is the point: an unreachable provider passes **no verdict** on the key, and the copy must never imply otherwise. The key saves anyway (on add), marked in the key line as `saved · not yet verified` until a test or real call succeeds.

Rules: each result names the provider, never "the API". Verdicts come only from the provider's actual response (auth error ⇒ invalid; network/5xx/timeout ⇒ unreachable). No toasts — the row is the surface.

## 2.5 Web search — how capability is communicated

Deterministic work (site crawls, changelog watching, help-centre reading) needs no search key; review mining, research-by-name and market news do (competitors spec §5.3). In this block:

- The `WEB SEARCH` mono tag marks capable rows (OpenAI, Google, Perplexity, OpenRouter) at all times — quiet labelling, not a nag.
- **When no search-capable key is saved** (e.g. Anthropic only), one quiet amber line renders at the foot of the block (13px, amber text, no banner box): *"Your agents can think but not search — reviews and market news are paused until you add an OpenAI, Google, Perplexity or OpenRouter key."* This is the same fact the Competitors Overview states in its amber notice; both point here, this line points at the rows above it.
- The moment a search-capable key tests as working, the line disappears and the module-side notices clear.

## 2.6 Removing a key — consequences stated, never dramatised

**"Remove"** opens the standard confirm dialogue only when removal changes what Discoveree can do; otherwise it removes immediately with a 5 s undo in place.

- **Removing the last key of all:** title **"Remove your last key?"**, body *"Agents can't run without an LLM key — your context will stop being kept current until you add another."*, destructive confirm **"Remove key"**. On confirm, the Home amber notice ("Agents are paused — add an LLM key…") takes over messaging, per home §B.1. This block's lede clause goes amber (1.2).
- **Removing the last search-capable key:** body *"Reviews and market news will pause — site crawling and changelog watching carry on."*
- Any other removal: no dialogue, inline undo.

## 2.7 Security honesty — the copy contract

The trust line in 2.1 is the whole story, told plainly. Rules for any future copy touching keys:

- Say **where keys live** (encrypted, in the local database on this machine) and **where they go** (directly to their provider, at call time), and nothing else.
- Never "bank-grade", "military-grade", "enterprise security", padlock icons, or shield glyphs. No security theatre.
- Never overclaim: we do not say "nobody can ever read them" — someone with access to this machine account is outside our promise, and we don't pretend otherwise. If asked to expand, the honest long form is: *"Encrypted at rest with a machine-local secret. Decrypted only in memory, only to make the call."*
- British English: no "authorization" in copy (technical HTTP terms in code are exempt per `design_guidelines.md`).

---

# Part 3 — Agent schedules (`#agent-schedules`)

## 3.1 Block anatomy

- **Kicker:** `AGENT SCHEDULES` · right-aligned on the kicker line, the **pause-all control** (3.4).
- **Block lede** (15px): **"Agents run on these rhythms while Discoveree is open, and anything overdue catches up when you launch."** — the desktop scheduler's honest contract, stated once.
- **Agent rows**, hairline-divided, **only for enabled modules** (gating §0.2 — a user without Customer Insights never sees feedback agents, not even greyed).

## 3.2 Agent row anatomy

- **Name line:** agent name 15.5px/500 `text-ink` (named by the job, never the slug) · right-aligned **next-run stamp**, mono 12px `text-faint`: `next Thu 09:00`.
- **Meta line:** mono 12px `text-faint`: what happened last — `last ran Tue 14:02 · 2 changes found` — the "changes found" fragment links to the digest items that run produced. A failed last run renders destructive-quiet: `failed Tue 14:02 · couldn't reach jira.example.com` with **"Try again"** and **"View log"** (the same failure grammar as competitor rows).
- **Description line:** 13px `text-faint`, one sentence, e.g. *"Verifies each competitor profile against their site, changelog and reviews."*
- **Frequency control:** a quiet inline select at the end of the name line (mono 12px values): `daily` / `weekly` / `fortnightly` / `monthly`. The weekly roadmap review additionally exposes day + time (`Sun 21:00`). Changing frequency recomputes and re-renders the next-run stamp immediately — the stamp is the feedback; no toast.
- **"Run now"** (teal 12.5px, name line) appears only on **set-level** agents (see table). Per-object agents deliberately do not offer it here — the competitors spec's rule stands: *the scheduler owns the set; humans nudge individual objects* from the object's own `verified …` stamp. Such rows carry instead a 12px ghost note: *"Nudge a single profile from its own page."*

While an agent runs (scheduled, catch-up, or Run now): the next-run stamp swaps to teal mono `running · 0:34` (elapsed counter), and the footer's agents segment mirrors it (`Agents · checking Mixpanel · 0:34`, pulsing dot — the footer remains the only place a pulse is permitted).

## 3.3 The v1 agent set and defaults

Defaults align with the staleness thresholds in home spec §B.2 — the schedule is always at least as frequent as the threshold it protects, so an agent that runs on time can never *cause* staleness. (SaaS defaults in `SettingsLayout.tsx` `AGENT_SCHEDULE_DEFAULTS` were the starting point, folded into fewer audience-recognisable rows.)

| Row (UI name) | Module (gates the row) | Description line | Default | Run now? |
|---|---|---|---|---|
| **Competitor check** | Competitive Intelligence | Verifies each competitor profile against their site, changelog and reviews. | fortnightly, staggered per competitor | No (per-object) |
| **Changelog watch** | Competitive Intelligence | Confirms each watched changelog, even when nothing changed. | weekly | No (per-object) |
| **Feedback gathering** | Customer Insights | Collects new feedback from your sources and reads its sentiment. | weekly | Yes |
| **Theme aggregation** | Customer Insights | Groups fresh feedback into themes after each gathering. | runs after each gathering (shown as `after gathering`, not editable separately) | No |
| **Segment & persona refresh** | Customer Insights | Re-checks segments and personas against recent evidence. | monthly | Yes |
| **Your product's inventory** | always (product profile is always on) | Re-reads your help centre, releases and changelog into the feature inventory. | monthly | Yes |
| **Roadmap poll** | Roadmap Review | Reads roadmap items from Jira or Linear. | daily | Yes |
| **Weekly roadmap review** | Roadmap Review | Scores the roadmap against strategy, feedback and competitor moves; drafts suggestions for you. | weekly · `Sun 21:00` | Yes |
| **Market review** | Strategy | Refreshes the market picture behind your strategy narrative. | monthly | Yes |

`daily` agents show next-run as a time (`21:00`); longer rhythms as day + time (`Thu 09:00`) or date when further out (`12 Aug`).

## 3.4 Pause all

- **Control:** on the kicker line, a quiet toggle rendered as text: **"Pause all"** (teal) → when paused, it reads **"Resume"** and a one-line amber state sits under the block lede: *"All agents are paused. Nothing is being checked, and freshness stamps keep counting — your context will drift stale until you resume."* Honest consequence, no guilt beyond the fact.
- Paused rows keep their frequency controls but their next-run stamp reads `paused` (mono, `text-faint`). "Run now" is disabled with the inline reason *"Agents are paused."* — visible-but-explained.
- **Footer:** the agents segment reads `Agents · paused by you` (default footer colouring — pausing is a choice, not a failure; the staleness it causes will show amber where staleness always shows).
- **Per-agent pause:** each row's overflow (`…` ghost at the row end) offers **"Pause this agent"** / **"Resume"** — same stamp treatment for that row only. The footer stays normal unless everything is paused.
- Pause state survives relaunch. The launch catch-up pass skips paused agents and says nothing about them.

## 3.5 No scheduled agents at all

Possible when the only chosen job is "Feed context to my AI tools" (plus the always-on inventory agent — so in practice the block nearly always has one row). If the inventory agent is the only row, it renders normally with a quiet closing line: *"More agents arrive with the jobs that need them — see Add capabilities below."* Never an empty block, never a teaser list.

---

# Part 4 — Connections (`#connections`) — stub for the Connections sprint

Connections has its own rail destination and page (gated by job 5); Settings does not duplicate its management. This block is a **door with a live summary**:

- **Kicker:** `CONNECTIONS`.
- **Populated:** one prose line — *"Serving `Claude` and `Cursor`; checking `Jira` daily."* — with each name an object link into the Connections page, and a right-aligned quiet action **"Open Connections →"**. Beneath, mono 12px: `Claude · 118 queries this week · Jira · polled 2 h ago`.
- **Nothing connected (job 5 or a data-tool job enabled):** invitation line — *"Your AI tools and data tools connect here — most take under a minute."* → **"Open Connections →"**. (Matches the current stub copy in `stubs.tsx`.)
- **No connection-bearing job enabled:** the block is absent entirely — per gating, not even a door.

*(Full anatomy, connect-a-teammate and per-tool panels are the Connections sprint's spec, not this one.)*

---

# Part 5 — Add capabilities

The one place unchosen modules exist (home spec §0.2). 

- **Kicker:** `ADD CAPABILITIES`.
- **Rows:** the unchosen step-2 jobs, in step-2 wording exactly — job title 15.5px/500, consequence line 13px `text-faint` (same copy as onboarding A.2's table), right-aligned action **"Switch on"** (teal). One click enables the module: its rail item and home card materialise in day-one state, and its scoped interview questions (if any) run next.
- **All jobs already chosen:** the block is absent — nothing to add is not a state worth rendering.

---

# Part 6 — Licence (`#licence`)

The desktop has three licence states: **trial**, **licensed**, and **reading-only** (trial ended or licence expired). The framing that makes all three honest: **an unlicensed Discoveree is a free reader seat of your own context.** Nothing you made is ever held hostage — context stays readable in the app and over MCP; what a licence buys is the full seat: agents running and the right to change things. This is the same seat model the team already lives by (brief §2), applied to one machine.

## 6.1 Trial state *(trial length: 14 days proposed — decision needed, commercial call)*

- **Kicker:** `LICENCE` · right-aligned mono stamp: `trial · 9 days left` (amber at ≤ 3 days).
- **Prose** (15px): **"You're trying the full product — everything on, nothing held back, `9` days to go. After that, Discoveree becomes a free reader of the context you've built: everything stays readable here and over MCP, but agents and edits wait for a licence."**
- **Actions:** **"Buy a licence ↗"** (primary teal — opens the merchant-of-record checkout) · **"I have a key"** (quiet, reveals the entry field, 6.4).
- **Footer** during trial: `Trial · 9 days left` replaces the licence segment (amber at ≤ 3 days).
- **No countdown modals, no Home banner** — the home amber notice remains reserved for the missing-LLM-key case (home §B.1). Trial state lives in the footer, this block, and the settings lede.

## 6.2 Licensed state

- **Prose:** **"Licensed to `faith@discoveree.com` · expires `14 Mar 2027`."** (mono email and date.)
- **Key row:** mono 12px `text-faint`: `DSCV-••••-••••-9F2K · entered 3 Aug 2026` · quiet action **"Replace key"** (reveals the entry field — for renewals and seat transfers).
- **Honesty line** (12.5px `text-faint`): *"Your key is checked on this machine — Discoveree doesn't phone home."* (Offline signed validation, brief §10 item 7; say it, it's a selling point.)
- **Expiry approaching (≤ 30 days):** the expiry date in the prose goes amber and a clause is appended: *"Renewing keeps agents running and updates coming — Renew ↗."* The footer licence segment goes amber in the same window. No other escalation.

## 6.3 Reading-only state (trial ended, or licence expired) *(expiry behaviour: reader-state proposed — decision needed, commercial call)*

- **Prose:** **"Your trial ended on `12 Aug`."** / **"Your licence expired on `12 Aug`."** followed by: **"Nothing you made has been taken away — your context is safe on this machine, readable here and served over MCP. Agents and edits resume with a licence."**
- **Actions:** **"Buy a licence ↗"** / **"Renew ↗"** (primary) · **"I have a key"** (quiet).
- **Footer:** `Reading only · licence expired` (mono, `text-faint` — factual, not alarmed).
- **The refusal moment is the message:** any attempted write anywhere in the app (add a competitor, accept a suggestion, edit strategy, change a schedule) is refused politely inline, in the established reader-upgrade grammar: *"Writing needs a licence — your trial ended `12 Aug`."* with **"Buy a licence ↗"**. Reads, Threads-already-filed, MCP read serving, and Settings itself (you can still enter a key, change nothing else destructive) keep working. Agents do not run; stamps age truthfully; staleness renders as staleness, never as breakage.

## 6.4 Key entry field and validation states

- One input (46px, `edge-input`, mono text), placeholder `DSCV-XXXX-XXXX-XXXX-XXXX`, paste-friendly (trims whitespace, uppercases). Primary teal **"Activate"**.
- Validation is offline (signed key). States, rendered inline beneath the field:
  - **Valid:** the field collapses; the block re-renders in licensed state; one quiet confirmation line for 5 s: *"Licensed — thank you. Expires `14 Mar 2027`."* Footer updates immediately.
  - **Malformed:** *"That doesn't look like a Discoveree key — keys look like `DSCV-XXXX-…` and arrive by email with your receipt."*
  - **Well-formed but invalid signature:** *"This key didn't validate — check for missing characters, or reply to your receipt email and we'll put it right."*
  - **Expired key entered:** *"This key expired on `2 Jan 2026` — renewing reactivates it."* + **"Renew ↗"**.
- No attempt counter, no lockout — there is nothing to brute-force locally that isn't already on the machine.

---

# Part 7 — About & your data (`#about`)

## 7.1 Block anatomy

- **Kicker:** `ABOUT & YOUR DATA`.
- **Block lede** (15px): **"Discoveree keeps everything on this machine — one folder holds the database, files and settings. Back that folder up and you've backed up Discoveree."**
- **Mono-metered rows** (the Sources-section treatment from the competitors Object — label · value · action):
  - **Your data** · `~/Library/Application Support/Discoveree` (mono 12px, middle-truncated with full path on hover) · **"Reveal in Finder"** (platform-named: "Show in Explorer" on Windows, "Show in Files" on Linux).
  - **Database** · `42 MB on disk` — the same figure, same source of truth, as the footer's `Local · 42 MB on disk`; the footer segment is a door to this row (§0.1). No engine name in copy — users recognise "database", not PGlite.
  - **Version** · `1.0.3` · state-dependent trailing text: `up to date` (`text-faint`) / **"Update ready — restart to apply"** (teal, restart action) / after a failed check: destructive-quiet `couldn't check for updates · Tue 14:02` + **"Try again"**. Quiet action when idle: **"Check for updates"**.
  - **Sources** · *"Everything agents believe, and why"* · **"Open Sources →"** — the provenance door home spec §C.4 requires from Settings.
  - **Licence terms** · `source-available · FSL` · **"Read the licence ↗"** — the legal text, one click away, no ceremony.
- **Export snapshot — placeholder, not rendered in v1.** Snapshot export/import belongs to the team-sharing rung-1 work (brief §7). Per the no-dead-controls rule, the row **does not ship** until the feature does; when it lands it materialises here as: **Snapshot** · *"A portable copy of your context a teammate can import"* · **"Export a snapshot"**. This paragraph is the placeholder — the spec reserves the slot; the UI shows nothing.

---

# Part 8 — Empty and error states, gathered

Most are specified in their blocks; the set, for build completeness:

| State | Where | Treatment |
|---|---|---|
| No LLM keys at all | 2.1 rows all in add state; lede amber clause (1.2) | Home owns the banner (§B.1); this page's job is the fix, not more nagging |
| No search-capable key | 2.5 | One quiet amber line at block foot; `WEB SEARCH` tags do the teaching |
| Key rejected / provider unreachable | 2.4 | Destructive-quiet in-row; unreachable **never** claims a verdict on the key |
| All agents paused | 3.4 | Amber consequence line, `paused` stamps, footer `Agents · paused by you` |
| Agent run failed | 3.2 | Destructive-quiet meta line, "Try again" + "View log"; staleness clock keeps counting |
| Only the inventory agent scheduled | 3.5 | Normal row + quiet pointer to Add capabilities; never an empty block |
| Nothing connected | Part 4 | Invitation line + door; block absent entirely if no connection-bearing job |
| All capabilities chosen | Part 5 | Block absent |
| Trial running / ending | 6.1 | Footer + block + lede only; no modals, no Home banner |
| Trial ended / licence expired | 6.3 | Reading-only framing; refusal-at-write is the upgrade moment |
| Bad licence key | 6.4 | Inline, specific, always with a route to resolution |
| Update check failed | 7.1 | Destructive-quiet on the Version row, "Try again" |

Nothing on this page ever renders "empty", a zero, or a locked teaser. Every state is either working, an invitation, or an honestly explained consequence with its remedy beside it.

---

## Appendix A — Data contracts (extends `client/src/mock/types.ts`)

```ts
export type ProviderId = "anthropic" | "openai" | "google" | "perplexity" | "openrouter";

export interface LlmKeyRow {
  provider: ProviderId;
  webSearch: boolean;                  // renders the WEB SEARCH tag
  saved?: {
    mask: string;                      // e.g. "sk-ant-…R4kQ" — the ONLY form the server returns
    addedAt: string;
    lastUsedAgo?: string;              // absent ⇒ segment not rendered
    verified: boolean;                 // false ⇒ "saved · not yet verified"
  };
  testing?: { elapsedS: number };
  testResult?:
    | { kind: "works"; answeredInS: number }
    | { kind: "invalid" }              // provider rejected the key
    | { kind: "unreachable" };         // no verdict on the key — copy must say so
}

export interface AgentScheduleRow {
  id: string;
  name: string;                        // job name, never a slug
  module: string;                      // drives gating
  description: string;
  frequency: "daily" | "weekly" | "fortnightly" | "monthly" | "after-gathering";
  weeklyAt?: { day: string; time: string };  // roadmap review only
  nextRun?: string;                    // absent when paused
  paused: boolean;
  running?: { elapsedS: number };
  lastRun?: { at: string; findings?: number; failed?: { reason: string } };
  runNow: boolean;                     // false for per-object agents
}

export type LicenceState =
  | { kind: "trial"; daysLeft: number }
  | { kind: "licensed"; email: string; expires: string; keyMask: string; renewalDue: boolean }
  | { kind: "readingOnly"; endedOn: string; reason: "trial" | "expired" };

export interface AboutInfo {
  dataDir: string;
  dbSizeOnDisk: string;                // same source of truth as the footer segment
  version: string;
  updateState: "current" | "ready" | { failedAt: string };
}
```

## Appendix B — Review checklist

- Both themes: amber consequence lines, destructive-quiet failures, `WEB SEARCH` and `trial` chips must pass in light and dark (`colour/5` + `colour/20` pattern).
- Every mono element (`tabular-nums`): key masks, dates, elapsed counters, next-run stamps, db size, version, licence key and expiry.
- Grep implemented copy against the `design_guidelines.md` substitution table — this page is licence-heavy: **licence** (noun) everywhere in copy; "license" survives only as a verb ("licensed to") and in code identifiers.
- Masked-key contract: verify no API response path returns an unmasked key; no reveal affordance exists in the UI.
- Honest-verdict audit: provider-unreachable copy never implies the key was judged; trial/expiry copy never implies data loss.
- Grammar audit: no tab bars; blocks in fixed order; footer segments deep-link to the correct anchors; unchosen modules appear nowhere except Add capabilities.
- No spinners in the column: all in-flight states are elapsed counters.

## Appendix C — Decisions needed (flagged, not blocking build of everything else)

1. **Trial length** — 14 days proposed (6.1). Commercial call for the owner.
2. **Expiry behaviour** — reading-only (reader-seat) state proposed for expired licences (6.3), consistent with the seat model. The alternative (Sublime/JetBrains-style perpetual fallback with updates stopped) weakens the annual model; flagged for the owner.
3. **Trial entry point** — this spec assumes the app launches straight into trial with no key gate at install; the build brief's "licence entered at install" flow should be relaxed to "licence *offered* at install" to match. Needs a one-line brief amendment if agreed.
