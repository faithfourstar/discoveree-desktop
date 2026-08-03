# Discoveree Desktop — Competitors Module

**UX specification · v1**
**Date:** 3 August 2026 · **Author:** Product design
**Basis:** `docs/design/layout-direction-2a.html` (the 2a "briefing in a shell" idiom), `docs/design/onboarding-and-home-spec.md` (staleness thresholds §B.2, evidence-cited contracts §B.3), `docs/build-brief.md` §6 (layout grammar), and the SaaS content inventory in `competitors.tsx`, `competitor-detail.tsx`, `competitor-profiles-summary.tsx`, `competitor-compare.tsx`.
**Status:** Ready for build. Spec only — nothing here is implemented.

All copy is final British English unless marked *(placeholder)*. Layout terms refer to the implemented shell: dark 84px rail, 48px top bar with ⌘K, centred **720px** prose-first column, 30px mono status footer. Tokens as used in `HomePage.tsx` / `CompetitorsPage.tsx`: `text-ink` prose, `text-body` secondary, `text-faint`/`text-ghost` quiet, `text-label` mono kickers, `text-teal-deep` actions, `edge-hairline` dividers, `bg-chip` evidence chips.

---

## 0. Shared conventions for this module

### 0.1 Grammar position

- **This page is a Level-1 Overview** (brief §6): one scannable page for the whole competitive set, blocks materialise only when populated.
- Each competitor is a **Level-2 Object** (`CompetitorsPage.tsx` already implements the Mixpanel object view — part 3 completes it).
- Deep dives are **Level-3 Threads**, spawned from any object via "Explore this", growing inline in the column. The Thread pattern is unchanged by this spec.
- Doors to this Overview: the rail item **Competitors** and the Competitive Intelligence health card on Home. Nothing else routes here; digest headlines and attention rows go straight to Objects.

### 0.2 Vocabulary (name things users recognise)

| Concept | Word used in UI | Notes |
|---|---|---|
| Relationship | **Direct** / **Adjacent** | Rendered as the mono badge (`DIRECT`, `ADJACENT`) beside the name — as on the existing object view. The SaaS "Mark as Adjacent Product" job survives as an edit on the Object. |
| Threat | **big threat** / **competitive** / **watch** / **quiet** | Lowercase, mono, in the meta line and as a table column — never a coloured alarm badge. Threat is a judgment word, not a status light. ("quiet" replaces the SaaS "None"/"No Threat", which read as a verdict of irrelevance.) |
| Freshness | **verified `4 h ago`** | The `last_verified_at` stamp, mono. Threshold for a competitor profile: **14 days** (home spec §B.2). Changelog watch threshold: 7 days — surfaced on the Object's Sources section, not on the Overview meta line. |
| The agent's finding | **the change line** | One prose sentence per competitor: the one thing that changed since the user last looked. |

### 0.3 Colour discipline

- **Amber** = stale only (14 days without verification). Amber underline in prose (`RichText` tone `"stale"`), amber stamp in meta lines. Never red for staleness.
- **Destructive** = a run that failed (site unreachable, provider error). Always paired with the word "couldn't" or "failed" and a way to retry or read the log.
- **Teal** = actions, links, live agent work, and the `NEW` marker on freshly detected changes.
- **No spinners anywhere in the prose column** (see part 4.2). Spinners survive only inside form controls in flows (the add flow's staged rows use the onboarding pattern, which sits in a flow context, not the reading column — and even there, rows resolve to ✓ + mono timestamp).

### 0.4 Evidence contract

Every change line, proposed profile, and thread answer carries an `EvidenceRow` (existing `EvidenceChip.tsx` contract): at least one chip, each a real link to a Source record or context Object. **No finding renders without provenance.** This is enforced at the component level, same as the home digest rule (home spec §B.3).

---

# Part 1 — The Overview

## 1.1 Shape

Centred 720px column inside the standard shell. Top bar breadcrumb reads `Competitors`. Structure, top to bottom:

1. **Kicker** — mono 11px uppercase: **"Competitors · since you last looked"**. Right-aligned on the same baseline, the **view toggle** (1.5) and the quiet action **"Track another"** (teal, 12.5px — same treatment as "Explore this").
2. **Lede** — the module's own mini-briefing, 21px/1.5 prose. What changed *across the set*, in one or two sentences (1.2).
3. **The set** — one row per competitor, hairline-divided (1.3). 4–8 rows fit one screen without scrolling strain; this page is designed for that count.
4. **Track another** — repeated as a full-width quiet row at the foot of the list: *"Track another competitor"* (teal). Opens the add flow (part 2) inline in the column.

No other blocks in v1. The SaaS Overview tab's "Competitive Landscape" narrative, "Customer Segment Coverage", "Product Recommendations" and "Market Review" do not return as page furniture: landscape narrative is the lede's job, recommendations are the Roadmap module's job (evidence-cited suggestions), market review becomes a Thread you can spawn, and segment coverage lives on the Object.

## 1.2 The lede — copy logic

The lede is generated from the same change records the rows show, and it always says the most useful true sentence first. Priority order:

1. **Changes exist:** *"Two of your six competitors moved this week. Mixpanel put session replay on its pricing page, and Amplitude dropped its free-tier event cap."* — count in mono, then the one or two most significant changes as plain prose. Competitor names are object links (teal).
2. **No changes, all fresh:** *"Nothing has changed across your six competitors since Thursday. Every profile is current."* — stillness stated as a verified fact, never as emptiness. The verification is the product working.
3. **Staleness present (appended to either):** *"Heap hasn't been verified in `16` days."* — the phrase carries the amber staleness underline (existing `RichText` tone `"stale"`) and links to the Heap object.
4. **Agents currently checking (prepended):** *"Checking Mixpanel and Amplitude now — "* followed by the rest of the lede. See 4.2 for the live treatment.

The lede never exceeds two sentences plus one staleness clause. Everything else belongs to the rows.

## 1.3 Competitor row (card view — the default)

Anatomy, matching the home briefing-row rhythm (`py-5`, `border-t edge-hairline`, last row also `border-b`):

- **Name line:** competitor name 15.5px/500 `text-ink` (the whole row is a door to the Object; the name is the visible link) · mono badge `DIRECT`/`ADJACENT` (teal-tint chip, as on the Object header) · right-aligned, the freshness stamp: mono 12px `verified 4 h ago` (`text-faint`; amber when past 14 days).
- **Meta line:** mono 12px `text-faint`: `mixpanel.com · big threat · sentiment 66 · 107 reviews`. Sentiment and review count render only when review data exists — absent figures leave no gap, no dash, no zero.
- **Change line:** one sentence, 15px/1.6 `text-ink`: *"Session replay is now on the pricing page — it touches pillar 2."* Followed by its `EvidenceRow` (e.g. `2 sources` · `142 features`) and the row action **"Open →"** (teal 12.5px). When the change is unseen since detection, the sentence starts with a mono teal tag `NEW` (10px, teal-tint chip) — cleared once the Object has been opened (part 4.3).
- **No change:** the change line reads, in `text-body`: *"Nothing new since `24 Jul` — pricing, changelog and reviews all confirmed."* Confirmation is a finding.
- **Stale row (> 14 days):** the freshness stamp goes amber, and the change line is replaced by an invitation in amber-toned prose: *"Not verified in `16` days — worth a fresh look."* with the action **"Check now"** (teal). One click triggers the refresh agent directly (part 4); no navigation required.
- **Failed last run:** stamp shows destructive-quiet `couldn't reach heap.io · Tue 14:02` with actions **"Try again"** and **"View log"**. The staleness clock keeps counting underneath — a failed check never masquerades as a fresh one.

**Ordering:** threat descending (big threat → competitive → watch → quiet), then staleness (stale rows rise within their threat band), then name. Ordering is stable during a session — a detected change gets the `NEW` tag, it does not reshuffle the page under the reader. The SaaS threat-filter chips do not return; at 4–8 competitors, ordering does the job filtering did.

## 1.4 Row density at the extremes

- **4 competitors:** the page breathes; nothing stretches to fill.
- **8+ competitors:** rows beyond the eighth render in a compressed form (name line + meta line only, no change line unless a `NEW` change exists) under a hairline label **"Also watching"** (mono kicker). Compressed rows expand to full form when they have news. This keeps one scannable page true at any set size.

## 1.5 View toggle — cards vs table

**This is the one place tab-style switching survives** (brief §6): a view toggle over the same data, not a navigation tab.

- **Control:** a two-segment mono toggle on the kicker line, right-aligned: `Cards | Table` (10.5px mono uppercase; active segment `text-ink` on `bg-chip`, inactive `text-faint`). Choice persists per user. Keyboard: `⌘\` cycles views.
- **Table view:** the lede stays exactly as in card view (the mini-briefing is view-independent). The list is replaced by a table. Because a table needs air, the column relaxes to **max-width 960px** in this view only — the single sanctioned deviation from 720px, and it snaps back on toggling to cards.
- **Columns:** Competitor (name + `DIRECT`/`ADJACENT` badge) · Threat · Sentiment (mono) · Reviews (mono) · Latest change (the change line, single-line truncated with title on hover) · Verified (mono stamp, amber when stale). Numbers right-aligned, `tabular-nums`. Sortable by Threat, Sentiment, Verified; default sort mirrors card ordering. Row click opens the Object. `NEW` tag appears in the Latest-change cell.
- **What the table replaces:** the SaaS two-up compare page (`competitor-compare.tsx`) retires as a destination. Its scanning job is done by this table; its judgment job ("what meaningfully separates A and B?") is done by a Thread — from any competitor Object, "Explore this" with a question like *"How do we stack up against Amplitude compared with Mixpanel?"* produces the strategic comparison inline, evidence-cited, and files under the object. No `Compare` route, no selection checkboxes, no floating compare bar.
- Empty cells render as nothing (blank), never `—` walls or zeroes.

---

# Part 2 — Add a competitor ("Track another")

## 2.1 Entry points

- **"Track another"** on the Overview (kicker line and foot of list).
- The Home card invitation **"Add a competitor"** (home spec §B.2) routes here and opens the flow immediately.
- A reader's MCP tool attempting to add a competitor is refused politely at the MCP surface (home spec §B.4) — that path never reaches this flow.

## 2.2 The flow — inline, in the column

Clicking "Track another" expands an inline section at the foot of the list (the column is the flow; no modal). The section:

- Prompt line, 15px `text-ink`: **"Who should Discoveree keep an eye on?"**
- One URL input (46px, `edge-input`, placeholder `competitor.com`) beside a primary teal button **"Research them"** — the button names the magic, as onboarding's "Read my site" does. URL normalisation as in onboarding A.1 (prepend `https://`, validate).
- Quiet helper, 12.5px `text-faint`: *"About two minutes: I'll read their site, look for a changelog and help centre, mine reviews, and compare them against your own feature inventory. You'll review the profile before anything is saved."*
- A text alternative beneath: **"I only know the name"** — swaps the URL input for a name input; research proceeds from search instead of a crawl (requires a web-search key — see 5.3).

`Esc` or clicking elsewhere collapses the section without losing typed input (restored on reopen this session).

## 2.3 Researching — staged rows, real events

On submit, the input locks and staged progress rows appear beneath it — **the onboarding step-1 pattern exactly**: each row is 16px icon + 15px label + right-aligned status resolving to ✓ with a mono completion time. Rows appear as their pipeline stage actually starts; **stages are bound to real pipeline events, never simulated**. The stage set (rows skip silently when a stage has nothing to do):

1. *"Reading `amplitude.com`…"* → *"Read `amplitude.com`"* ✓
2. *"Looking for their changelog and help centre…"* → on success the row states the finding: *"Found changelog — `amplitude.com/changelog` · watching for changes"* ✓
3. *"Mining reviews…"* → *"Read `84` reviews · sentiment `61`"* ✓ *(requires a web-search-capable key; degrades per 5.3)*
4. *"Comparing against your `142` features…"* ✓
5. *"Drafting the profile…"* ✓

Beneath the rows, one quiet line: *"Everything found here is kept with its source — you can always see why Discoveree believes something."*

No percentage bar. Total wait typically under two minutes; the staged rows are the honesty mechanism.

## 2.4 Proposed profile — confirmation before saving

The staged rows collapse to a single mono summary line (*"Read `amplitude.com` · `5` findings · `84` reviews · `1 m 40 s`"*) and a proposal card renders in the column:

- **Header:** proposed name (inline-editable) + proposed relationship badge (`DIRECT`, tappable to switch to `ADJACENT`) + mono meta: `amplitude.com · suggested: big threat`.
- **Summary paragraph** (15px prose): the drafted positioning, one paragraph.
- **First read of the field:** the two capability columns, "They beat you on" / "You beat them on", exactly as the Object renders them — populated from the feature comparison, or absent if that stage was skipped.
- **EvidenceRow:** `4 sources` · `84 reviews` · `142 features` — every chip live.
- **Actions:** **"Track Amplitude"** (primary teal) · **"Discard"** (quiet outline). Nothing is saved until "Track" — the human accept is real, matching the write-governance rule everywhere else.

On accept: the card collapses, the new row materialises in the list in its threat position with the `NEW` tag, and the freshness stamp reads `verified just now`. The Overview lede does not rewrite mid-session; it acknowledges the addition on next visit.

## 2.5 Day one — module enabled, no competitors yet

When Competitive Intelligence is enabled but empty:

- **Rail:** the Competitors item renders dimmed (opacity .4, per the day-one shell frame in 2a and `ModuleState.populated`). It lights to full weight the moment the first competitor is saved — the module earning its place is visible in the chrome.
- **Overview page:** no kicker, no list, no toggle. The column centres vertically (the day-one Home pattern) with:
  - Lede, 23px/1.45: **"Who should Discoveree keep an eye on? Give me a competitor's site and I'll build the profile — then keep it current without being asked."**
  - The URL input + **"Research them"**, and the **"I only know the name"** alternative — the same controls as 2.2.
  - Helper line as in 2.2.
- **Proposals variant:** if onboarding step 1 proposed competitors that were deferred, the day-one page leads with them instead: lede **"Onboarding turned up `4` likely competitors. Keep the ones that matter."**, then a checklist card (all pre-ticked, each row: name · one-line reason in 13px `text-faint`, e.g. *"Named alongside you on comparison pages"*) with primary action **"Track `4` competitors"** and the URL input beneath for additions. Work already done is the best invitation.
- The first saved competitor swaps the page to the standard Overview with one row — one real row, not a lonely-looking grid. The footer's agents segment begins showing the module's schedule (*"next competitor check `Thu 09:00`"*).

---

# Part 3 — Completing the Object view

The implemented `CompetitorsPage.tsx` object (header · meta line · what-changed prose · capability columns · open Thread · filed-threads line) is correct and keeps its structure and order. **The inline Thread pattern is untouched.** Three sections from the SaaS content inventory are added, and the SaaS material not listed here is deliberately absorbed elsewhere (strategic analysis → the what-changed prose and Threads; news/announcements → change records feeding the digest; pricing, integrations, financial intelligence → deferred to Threads on demand rather than permanently rendered sections).

Sections materialise only when populated — a competitor without review data simply has no review section. Final visual order, top to bottom:

1. **Header + meta line** *(exists)* — name, `DIRECT` badge, "Explore this"; mono meta `mixpanel.com · sentiment 66 · 107 reviews · verified 4 h ago`. Addition: threat word joins the meta (`… · big threat · …`), and the verified stamp becomes the refresh affordance (part 4.1).
2. **What changed** *(exists)* — the two-or-three-sentence prose summary of movement since last look. Addition: an `EvidenceRow` beneath it (the change records' sources) — currently the prose is uncited, which breaks the evidence contract.
3. **They beat you on / You beat them on** *(exists)* — unchanged.
4. **Open deep dive** *(exists, unchanged)* — the Thread stays anchored here, directly after the judgment sections, before the evidence sections. Threads grow inside the column, teal-edged, as implemented.
5. **NEW — Feature coverage against your inventory.** Mono kicker: **"WHERE YOU OVERLAP"**. One summary sentence in prose: *"They cover `31` of the `142` features in your inventory, and `9` of theirs have no equivalent in yours."* (mono figures, both linked: the first to a filtered feature-inventory view, the second expanding inline). The expansion is a compact two-column list (13.5px, the capability-column treatment): **"They have, you don't"** / **"You have, they don't"**, up to six items each with a "Show all `9`" expander. This is the SaaS "Jobs to be done coverage" section rebuilt on the `product_features` inventory — the evidence base that stops roadmap suggestions duplicating existing capability, so it must be visibly connected: each listed capability chip links to its feature or gap record.
6. **NEW — What buyers say.** Mono kicker: **"WHAT BUYERS SAY"**. The sentiment figure explained, then evidence: one prose line — *"Sentiment `66` across `107` reviews, drifting down since May."* — followed by two or three short quoted excerpts (13.5px, hairline-left-ruled, `text-body`), each with a mono attribution line: `G2 · 28 Jul · ★★☆`. A quiet expander **"All review evidence →"** opens the full mined set. Quotes are verbatim excerpts with live source links — never paraphrases presented as quotes.
7. **NEW — Sources.** Mono kicker: **"WHAT THIS PROFILE IS BUILT ON"**. The provenance audit, rebuilt from the SaaS "Verified Sources": a compact mono-metered list, one row per source — favicon/icon · source name · what it feeds · last-checked stamp:
   - `mixpanel.com` · site crawl · `checked 4 h ago`
   - `mixpanel.com/changelog` · watching for changes · `confirmed 2 d ago` *(amber past its 7-day threshold: `not confirmed in 9 d`)*
   - `G2` · review mining · `84 reviews · 12 Jul`
   - `help.mixpanel.com` · feature inventory · `214 articles · 21 Jul`
   Each row links to its Source record. A trailing quiet action: **"Add a source"** (paste a URL the agents should also watch). Sources sit low because they are audit, not reading — but they are always present on a populated object; provenance is not optional.
8. **Filed deep dives** *(exists)* — the quiet "Filed here already:" line stays last, as implemented.

**Relationship and housekeeping edits** (SaaS card's pencil menu): an overflow action in the object header (ghost `…` beside "Explore this") offering **"Mark as adjacent"** / **"Mark as direct"**, **"Set threat"** (big threat / competitive / watch / quiet), and **"Stop tracking"** — the latter behind a confirm dialogue: title **"Stop tracking Mixpanel?"**, body *"The profile, its sources and its filed deep dives will be deleted. This cannot be undone."*, destructive confirm **"Stop tracking"**.

---

# Part 4 — Refresh affordances

## 4.1 The stamp is the control

`verified 4 h ago` in the meta line is not passive text. On hover it gains an underline and a trailing teal action **"· check now"**; clicking runs the refresh agent for that competitor immediately. The same affordance appears on the Overview row stamp. When the profile is stale, the row's amber invitation (*"worth a fresh look — Check now"*, 1.3) is the same action with more prominence. There is no toolbar refresh button and no page-level "Refresh all" in v1 — the scheduler owns the set; humans nudge individual objects. (The launch catch-up pass covers "everything is old because the app was closed".)

## 4.2 In progress — no spinners in the prose column

While a refresh agent runs, motion lives in text and the footer, never in a spinner glyph:

- **Meta stamp (Object and row):** the stamp segment swaps to teal mono: `checking now · 0:34` — a live elapsed counter, ticking each second. The counter *is* the progress indicator: honest, quiet, and in the idiom (mono figures do the work).
- **Overview lede:** prefixed live clause per 1.2: *"Checking Mixpanel now — "*. If the lede already renders, the clause is prepended without reflowing the rows.
- **Status footer:** the agents segment updates: `Agents · checking Mixpanel · 0:34` with the small pulsing green dot the footer already owns. The footer is the one place a pulse is permitted.
- The page stays fully readable and navigable throughout; nothing locks, dims, or skeletons.

## 4.3 Return — how a detected change is highlighted

When the run completes:

- **Something changed:** the stamp settles to `verified just now`; the change line (row) and what-changed prose (Object) rewrite with the new finding, led by the mono teal `NEW` tag. The tag persists across sessions until the Object is opened, then clears (per competitor, not per session — "unseen" means unseen). The same change record flows to the Home digest with its evidence chips, so the two surfaces cite identically.
- **Nothing changed:** the stamp settles to `verified just now` and, for one visit, carries a quiet suffix: `verified just now · nothing changed`. The row's change line updates its confirmation date. No toast, no celebration — confirmed stillness is a normal, valuable result (this is the freshness accounting the product is for).
- **If the user is on the page at completion:** the rewritten line gets a single 600ms background tint fade (teal at 5%) to draw the eye once; no persistent highlight beyond the `NEW` tag.

## 4.4 Scheduled runs

The fortnightly scheduled verification uses identical states — the only difference is the trigger. If the app was closed past a competitor's due date, the launch catch-up pass queues it; the footer shows `Agents · catching up · 2 of 6` and stamps go live one at a time. The Overview is never blocked by a catch-up.

---

# Part 5 — Empty and error states

## 5.1 Unreachable competitor site

**In the add flow (2.3):** the "Reading…" staged row resolves to a destructive-tinted state (`bg-destructive/5 border-destructive/20` inline row): *"We couldn't reach `amplitude.com` — the site didn't answer."* Two actions beneath: **"Try again"** (secondary) and **"Research by name instead"** (text button) — the latter re-runs from search using the domain's name, provided a web-search key exists (else 5.3 copy). If both routes fail, a final fallback: **"Add the basics myself"** — minimal inline form (name required, one-line description and URL optional); the competitor is saved unverified, stamp reads `added by hand · not yet verified` (amber), and agents retry silently in the background, merging what they later find. Manual entry is an escape hatch, never a dead end.

**On refresh (4.x):** the stamp shows the destructive-quiet failure state from 1.3 (`couldn't reach mixpanel.com · Tue 14:02` · **Try again** · **View log**). The staleness clock keeps running from the last *successful* verification. Repeated failures (3+ consecutive) escalate only as far as the Home attention row (*"Mixpanel checks are failing — view the log?"*, destructive per home spec §B.2); the Overview never shouts.

## 5.2 Agent found nothing new

Not an error — specified in 4.3 and 1.2.2. Named here to make the rule explicit for build: **"no changes" must never render as an empty state, a warning, or an apology.** It renders as verification: fresh stamps, confirmed dates, and a lede that says everything is current. The forbidden framings: "No updates found", "Nothing to show", any greyed or dimmed treatment of an up-to-date row.

## 5.3 Search providers unavailable (no web-search-capable key)

Review mining, research-by-name, and news discovery need a Perplexity, OpenAI or Gemini key (the router's web-search providers). Site crawling, changelog watching and the help-centre crawler are deterministic and keep working without one.

- **Overview:** a single amber notice bar above the kicker (`bg-amber-500/5 border-amber-500/20` — the one banner this page is allowed): *"Competitor research is running without web search — reviews and market news are paused. A Perplexity, OpenAI or Gemini key switches them on."* + button **"Add a key"** (→ Settings → LLM keys). Shown only while the gap exists; site-crawl-based freshness continues underneath it, and stamps stay honest about what was actually checked.
- **Add flow:** stages 2.3.3 (reviews) is skipped with a stated reason row (quiet, not destructive): *"Skipped reviews — needs a web-search key."* The proposal card renders from the crawl alone with a 12.5px note: *"Built from their site alone — add a web-search key and I'll mine reviews too."* "I only know the name" is disabled with inline explanation rather than hidden: *"Researching by name needs a web-search key."* (Visible-but-explained is correct here because the control is a mode of an enabled module, not a locked module — the no-teaser rule applies to modules, not to honestly explained prerequisites.)
- **No LLM key at all:** agents are paused globally; Home owns that message (home spec §B.1 amber notice). This page adds nothing — no duplicate nagging. Stamps age truthfully; stale rows invite as normal, and "Check now" routes to the Home notice's remedy via a small inline line: *"Agents are paused — add an LLM key first."*

## 5.4 Module empty (day one)

Specified in 2.5. The `EmptyState` component's current line for this page (*"Who should Discoveree keep an eye on? Add a competitor and agents will keep the profile current."*) is superseded by the full day-one layout in 2.5 — the invitation gets the real input, not just the sentence.

---

## Appendix A — Data contracts (extends `client/src/mock/types.ts`)

```ts
export type ThreatWord = "big threat" | "competitive" | "watch" | "quiet";

export interface CompetitorRow {
  id: string;                       // same stable ID the Object and MCP cite
  name: string;
  classification: "DIRECT" | "ADJACENT" | "ASPIRATIONAL";
  domain: string;
  threat: ThreatWord;
  sentiment?: number;               // absent ⇒ segment not rendered
  reviewCount?: number;
  verifiedAgo: string;              // display form; derived from last_verified_at
  stale: boolean;                   // now − last_verified_at > 14 d
  lastRunFailed?: { at: string; reason: string };
  change?: {                        // absent ⇒ "nothing new since …" line
    line: string;                   // one sentence
    evidence: readonly EvidenceRef[]; // ≥ 1, enforced
    unseen: boolean;                // renders the NEW tag
  };
  confirmedQuietSince?: string;     // e.g. "24 Jul", for the no-change line
}

export interface CompetitorsOverview {
  lede: RichText;                   // reuses "stale" tone for amber underline
  rows: readonly CompetitorRow[];   // pre-ordered by threat, staleness, name
  view: "cards" | "table";          // persisted preference
  checking?: readonly { id: string; name: string; elapsedS: number }[];
  searchKeyMissing: boolean;        // drives the amber notice (5.3)
}
```

New Object sections extend `CompetitorObject` with `featureCoverage`, `reviewEvidence` (quotes with source refs), and `sources` (provenance rows with per-source last-checked stamps) — each optional, each section absent when its field is.

## Appendix B — Review checklist

- Both themes: amber staleness, destructive failure rows, teal-tint chips and the `NEW` tag must pass in light and dark (use the `colour/5` + `colour/20` tinted-surface pattern).
- Every mono element (`tabular-nums`): counts, sentiment, stamps, elapsed counters, table numerics, staged-row timings.
- Grep implemented copy against the `design_guidelines.md` substitution table (organise, colour, licence-as-noun, dialogue, cancelled, help centre) before merge.
- Evidence contract: no change line, proposal card, digest item or thread answer without at least one live evidence chip.
- Grammar audit: no route reaches an Object except a direct link; no tab bars anywhere except the cards/table toggle; Threads spawn only from Objects.
