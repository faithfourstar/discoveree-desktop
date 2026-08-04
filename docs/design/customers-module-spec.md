# Discoveree Desktop — Customers Module

**UX specification · v1**
**Date:** 4 August 2026 · **Author:** Product design
**Basis:** `docs/design/layout-direction-2a.html` (the 2a "briefing in a shell" idiom), `docs/design/competitors-module-spec.md` (the sibling spec — conventions match it exactly), `docs/design/onboarding-and-home-spec.md` (staleness thresholds §B.2, evidence-cited contracts §B.3), `docs/design/003-multi-product-entities.md` §2.6 (org-level segment entities + personas with per-product facets), `docs/build-brief.md` §6 (layout grammar) and §4a (internal evidence source kinds), and the SaaS content inventory in `customer-insights.tsx`, `customer-segment-detail.tsx`, `customer-segment-profiles-summary.tsx`, `CustomerSegmentProfileView.tsx`, `ThemeListView.tsx`, `FeedbackTab.tsx`.
**Status:** Ready for build. Spec only — nothing here is implemented.
**Typography amendment (4 Aug 2026, owner-final):** mono usage in this spec is superseded by `docs/design/typography-ruling.md` §0 — everywhere this document says "mono" (kickers, meta/attribution/basis lines, stamps, counts, sentiment figures, chips, badges, fit/lifecycle/trend words), render Inter at the ruling's sizes/greys, with tabular-nums where digits align or tick. Mono survives only in the developer-artifact class defined there.

All copy is final British English unless marked *(placeholder)*. Layout terms refer to the implemented shell: dark 84px rail, 48px top bar with ⌘K, centred **720px** prose-first column, 30px mono status footer. Tokens as used in `HomePage.tsx` / `CompetitorObjectPage.tsx`: `text-ink` prose, `text-body` secondary, `text-faint`/`text-ghost` quiet, `text-label` mono kickers, `text-teal-deep` actions, `edge-hairline` dividers, `bg-chip` evidence chips.

---

## 0. Shared conventions for this module

### 0.1 Grammar position

- **This page is a Level-1 Overview** (brief §6): one scannable page for everything the product knows about its customers — themes and segments together, blocks materialise only when populated.
- Each **theme** and each **segment** is a **Level-2 Object**; a **persona** renders as a block inside its segment Object (it is addressable and citable by ID, but does not get its own page in v1 — a persona without its segment is a name without a context).
- Deep dives are **Level-3 Threads**, spawned from any Object via "Explore this", growing inline in the column. The Thread pattern is unchanged by this spec.
- Doors to this Overview: the rail item **Customers** and the Customer Insights health card on Home. Digest headlines, evidence chips, and attention rows go straight to Objects.

### 0.2 The two-level model, stated once

Per ADR 003 §2.6: a segment (and each of its personas) is an **org-level entity** — its name, description, type, and the persona's identity (title, traits, demographics, behaviours) are shared across every product in the organisation. Everything *relative to this product* lives on the **facet**: jobs-to-be-done, needs and pains, satisfaction, fit, and all feedback linkage. Feedback and themes are **entirely product-scoped** (§2.8) — they never have an org level.

Surface rule: **in a single-product organisation the two levels are invisible** — no "shared" labels, no hierarchy chrome, exactly as the product switcher stays hidden until a second product exists. The moment a second product holds a facet on the same entity, the sharing markers of 3.3 materialise. The grammar "blocks materialise only when populated" applies to org structure too.

### 0.3 Vocabulary (name things users recognise)

| Concept | Word used in UI | Notes |
|---|---|---|
| Fit | **strong fit** / **moderate fit** / **weak fit** | Lowercase, mono, in the meta line. Replaces the SaaS ICP-fit traffic-light badges ("High Fit" in green etc.) — fit is a judgment word, not a status light. Absent when unrated: no "unrated" badge, no gap. |
| Segment type | badge `VERTICAL` / `PARTNERSHIP` beside the name | Mono teal-tint chip, as `DIRECT` on competitors. A plain customer segment carries **no badge** — the default earns no chrome. The SaaS "primary persona" type does not return as a segment type; personas are children of segments now (ADR 003 §2.6). |
| Theme lifecycle | **forming** / **established** / **fading** | Lowercase, mono, in the theme meta line. Replaces the SaaS status machine (Needs Review / Watchlist / Opportunity Created / Inactive) — lifecycle is observed from the evidence, not set by hand (4.4). |
| Trend | **rising** / **steady** / **easing** | Lowercase mono in the meta line, with the mono movement figure where one exists (`↑ 9 this fortnight`). |
| Freshness | themes: **refreshed `2 d ago`**; segments/personas: **verified `12 d ago`** | Mono stamps. Thresholds (home spec §B.2): **theme 7 days**, **segment/persona 30 days**. "Refreshed" because a theme is re-aggregated; "verified" because a segment is confirmed. |
| A piece of feedback | **feedback item**, quoted text is **what they said** | Never "entry", "record", or "data point" in copy. |

The SaaS "uplift potential" badge (high/medium/low computed from mentions × sentiment) does not return as page furniture: that judgment is the Roadmap Review agent's job, delivered as an evidence-cited suggestion, not a permanent column.

### 0.4 Colour discipline

Identical to the sibling spec: **amber** = stale only, **destructive** = a run or source that failed (always with "couldn't"/"failed" + retry/log), **teal** = actions, links, live agent work, and the `NEW` marker. **No spinners anywhere in the prose column.** Sentiment figures are plain mono — sentiment is a number with evidence behind it, never a coloured pill (the SaaS five-band sentiment colouring does not return).

### 0.5 Evidence contract — and the evidence-basis rule

Every lede clause, change line, theme, and proposed segment carries an `EvidenceRow` (existing `EvidenceChip.tsx` contract): at least one chip, each a real link to a Source record or context Object. A theme's ultimate evidence is its feedback items; a feedback item's evidence is its provenance line (0.6). **No finding renders without provenance**, enforced at the component level.

This module extends the contract to the objects themselves, because the SaaS's worst failure lived here: personas and jobs-to-be-done populated from nothing but the model's imagination. The desktop rule, enforced at the surface as well as in the agents:

- **Every persona, JTBD section, and segment insight renders with its evidence basis visible** — a mono basis line in the provenance register: `built on 23 feedback items · 12 review quotes · your interview`. Each figure is a live link to the underlying evidence. **There is no unsourced-persona display state**: the component contract requires a non-empty basis, so an object without one cannot render — and therefore cannot exist on screen. Same enforcement level as competitor change lines.
- **Owner-provided knowledge is a legitimate, labelled basis** (0.6): what the user asserted in the interview or typed by hand renders with the *"added by you"* treatment — honest about its origin, never dressed as research.
- **No evidence is an invitation, never a fabrication**: where a basis would be empty, the surface shows the day-one-grammar invitation for that gap (3.5), not a drafted guess.
- **Thin evidence says so**: below the fixed thresholds in 3.5, the basis line takes the amber early treatment rather than presenting thin conclusions at full confidence.

This honesty is a product principle worth copy, not just a constraint — it is the visible difference between Discoveree and "Claude invented me three personas" (brief §10a).

### 0.6 Feedback provenance — source kinds (brief §4a)

Every feedback item carries exactly one provenance record, rendered as a mono attribution line wherever the verbatim appears: **source-kind chip · detail · date**. Source kinds in v1, with their chip copy:

- `manual` — *"logged by you"* (or the teammate's name in team mode)
- `review` — *"G2 review"* / *"Capterra review"*, with the star figure where mined: `★★☆`
- `import` — *"CSV import · support-export.csv"*
- Later kinds, joining without redesign (same chip slot): `mcp` — *"via Claude · #feedback on Slack"* (§4a MCP write surface), `crm` — *"HubSpot · closed-lost note"*, `call` — *"call transcript"*. They must **not** appear as options anywhere until shipped — the no-teaser rule.

Confidence follows kind: manual and import items are the user's own facts; review and MCP-proposed items keep a live link to their origin so the chip is always auditable.

**The "added by you" treatment.** Owner-provided knowledge (interview answers, hand-typed profile text, manual fit/type settings) is a first-class source kind with its own visual register: a quiet mono chip **`added by you`** (`bg-chip`, plain `text-muted` — deliberately *not* the teal-tint of researched evidence) wherever the content appears, and *"your interview"* / *"added by you"* as a segment of basis lines. Two registers, never mixed within one claim: **researched** (evidence chips, source links) and **asserted** (added by you). An agent may *extend* an asserted section with researched additions — each addition then carries its own chips alongside the owner chip — but may never silently convert assertion into apparent research.

---

# Part 1 — The Overview

## 1.1 Shape

Centred 720px column inside the standard shell. Top bar breadcrumb reads `Customers`. Structure, top to bottom:

1. **Kicker** — mono 11px uppercase: **"Customers · since you last looked"**. Right-aligned on the same baseline, the quiet action **"Log feedback"** (teal, 12.5px — this module's "Track another").
2. **Lede** — the module's own mini-briefing, 21px/1.5 prose (1.2).
3. **What you're hearing** — the themes band (1.3): mono kicker **"WHAT YOU'RE HEARING"**, one row per theme.
4. **Who you serve** — the segments band (1.4): mono kicker **"WHO YOU SERVE"**, one row per segment.
5. **Log feedback** — repeated as a full-width quiet row at the foot: *"Log a piece of feedback"* (teal). Opens the flow (part 2) inline in the column.

Themes sit above segments deliberately: the lede's job is *what moved*, and feedback moves weekly while segments move monthly (their thresholds say exactly that: 7 days vs 30). The slow band anchors the page; the fast band leads it.

**No view toggle in v1.** The one-sanctioned-tab rule (brief §6) permits a cards/table toggle over the *same data*; themes and segments are two object types sharing a page, so a toggle between the bands would be navigation dressed as a view — exactly what the rule forbids. And within a band, a table adds nothing: theme rows already carry their figures in mono meta lines, and the set sizes (8–15 themes, 3–8 segments) don't need sortable columns. If a real scanning need emerges at scale, a themes-band `Cards | Table` toggle in the competitors idiom is the sanctioned shape — not before.

The SaaS Overview tab's furniture does not return: the "Customer Segment Analysis" narrative (strategic segments, growth opportunities, priority needs, risks) is the lede's and the Roadmap module's job; the importance/satisfaction quadrant chart retires (its judgment job — "which segment is underserved?" — is a Thread: *"Explore this"* on any segment); "Product Recommendations" are evidence-cited Roadmap suggestions now; the create-opportunity dropdown forest on every row is replaced by the Roadmap module's single suggestion queue.

## 1.2 The lede — copy logic

Generated from the same records the rows show; it always says the most useful true sentence first. Priority order:

1. **A theme is forming:** *"A new theme is forming: CSV export limits — `9` mentions in a fortnight, most of them from Mid-market ops teams."* — theme and segment names are object links (teal). This outranks everything: a forming theme is the module's headline product.
2. **Sentiment moved:** *"Sentiment on Onboarding has slipped from `62` to `48` since June."* — only for movements past a fixed threshold (±10 across ≥5 new mentions), so the lede never narrates noise.
3. **Steady state:** *"Nothing new is forming across your `12` themes — `48` pieces of feedback arrived this month and all of them filed under existing themes."* — stillness as a verified fact; filing is the product working.
4. **Staleness (appended to any of the above):** *"The Ops leads persona hasn't been verified in `34` days."* — amber staleness underline (`RichText` tone `"stale"`), linking to the segment Object.
5. **Agents currently reading (prepended):** *"Reading `14` new feedback items now — "* followed by the rest. Live treatment per the sibling spec 4.2: text and footer, no spinner.

Never more than two sentences plus one staleness clause.

## 1.3 Theme row

Anatomy, matching the briefing-row rhythm (`py-5`, `border-t edge-hairline`, last row also `border-b`):

- **Name line:** theme name 15.5px/500 `text-ink` (the whole row is a door; the name is the visible link) · right-aligned freshness stamp: mono 12px `refreshed 2 d ago` (`text-faint`; amber past 7 days).
- **Meta line:** mono 12px `text-faint`: `18 mentions · sentiment 41 · rising · 3 source kinds · forming`. Sentiment renders only when computed from ≥3 mentions; trend only when there is movement history. Absent figures leave no gap, no dash, no zero.
- **Change line:** one sentence, 15px/1.6 `text-ink`: *"Nine of the eighteen mentions arrived this fortnight — the pace doubled after the June pricing change."* Followed by its `EvidenceRow` (e.g. `18 mentions` · `2 reviews`) and the row action **"Open →"** (teal 12.5px). Unseen movement leads with the mono teal `NEW` tag, cleared once the Object has been opened (per object, not per session).
- **No movement:** the change line reads, in `text-body`: *"No new mentions since `21 Jul` — holding at `18`."* Confirmed quiet is a finding.
- **Stale row (> 7 days without re-aggregation):** amber stamp; change line becomes the invitation: *"Not refreshed in `9` days — new feedback may be waiting to file."* with **"Refresh now"** (teal) — one click runs the theming agent, no navigation.
- **Mixed sentiment:** when the distribution is genuinely bimodal (fixed rule: ≥25% of mentions on each side of 50), the meta line reads `sentiment mixed` instead of the mean, and the change line says who sits where: *"Agencies praise it; ops teams report it as a blocker."* The mean never papers over a split — sentiment is displayed honestly or not at all.

**Ordering:** lifecycle (forming → established → fading), then mentions descending; stale rows rise within their lifecycle band; stable during a session — new movement gets the `NEW` tag, it does not reshuffle the page under the reader. **Fading themes compress** (name + meta line only) under a hairline mono label **"Fading"** at the foot of the band; a fading theme that receives a new mention re-expands with `NEW`. Beyond eight established themes, the ninth onwards compress the same way under **"Also filed"** — one scannable page at any set size.

## 1.4 Segment row

- **Name line:** segment name 15.5px/500 (door to the Object) · type badge only when not a plain segment (`VERTICAL` / `PARTNERSHIP`, mono teal-tint) · right-aligned stamp: mono 12px `verified 12 d ago` (amber past 30 days).
- **Meta line:** mono 12px `text-faint`: `strong fit · 2 personas · 21 feedback items · sentiment 58`. In a multi-product organisation, when another product holds a facet on this entity, the meta line ends `· also served by Payroll` (product name a link) — absent otherwise (0.2).
- **JTBD line** — the facet speaking, one sentence, 15px/1.6 `text-ink`: *"They hire you to close the month-end books faster; their top unmet need is bulk CSV export."* This sentence is always **this product's** jobs-to-be-done summary, never the shared description — the Overview is a per-product page, so the facet leads and the entity stays in the wings until the Object. It renders only when the Object's JTBD section has a basis (0.5); with none, the row shows the quiet invitation instead: *"No jobs-to-be-done yet — the profile is waiting for evidence."* An early basis (3.5) tints nothing at row level; the amber lives on the Object where the remedy is.
- **Stale row:** *"Not verified in `34` days — feedback since then may have moved who they are."* with **"Check now"**.
- Ordering: fit descending (strong → moderate → weak → unrated), then staleness, then name. Beyond six, compressed rows (name + meta) — segments are few by nature; this is a safety valve, not an expectation.

Personas do not get Overview rows: the meta line counts them, the Object shows them (3.2). Two lists of overlapping people on one page would blur exactly the entity/facet line ADR 003 draws.

---

# Part 2 — Log feedback (the day-one source)

## 2.1 Entry points

- **"Log feedback"** on the Overview (kicker line and foot of page).
- The Home card invitation routes here; a theme Object's "Log another mention" (4.2) opens the same flow with the theme pre-suggested.
- A reader's MCP tool attempting `log_feedback` is refused politely at the MCP surface (home spec §B.4 — the upgrade moment); a full seat's own AI proposing feedback lands in the review queue (part 6), never in this flow.

## 2.2 The flow — inline, in the column

Clicking "Log feedback" expands an inline section (the column is the flow; no modal):

- Prompt line, 15px `text-ink`: **"What did you hear?"**
- One textarea (the verbatim; placeholder *"Paste or type what the customer said — their words, not a summary."*). This field alone is enough to file.
- Beneath it, one quiet row of optional mono-labelled controls, none required: **Who** (segment/persona picker, type-ahead over existing entities, free text allowed), **Where** (source picker: `Customer call` / `Support ticket` / `Email` / `Sales conversation` / `Somewhere else` + free-text detail), **When** (defaults to today).
- Primary teal button: **"File it"**. Quiet helper, 12.5px `text-faint`: *"Kept word for word, with its source — I'll match it against your themes as it lands."*

`Esc` or clicking elsewhere collapses without losing typed input (restored on reopen this session).

## 2.3 Filing — immediate, honest feedback

On "File it" the section collapses to a single result line in the column (no spinner, no toast):

- **Matched:** teal-led prose: *"Filed under CSV export limits — its `12th` mention."* Theme name is a link; the theme row's meta updates in place. The result line fades after the next navigation, not on a timer mid-read.
- **New theme forming:** *"That's new — nothing like it in your `12` themes. Holding it with `2` other unfiled items; a theme forms when the pattern does."* Unfiled items are visible at the foot of the themes band as a quiet mono line: *"`3` items waiting for a pattern"* (a door to the raw items).
- **Agents paused (no LLM key):** the item files as unthemed with an honest note: *"Kept safe — matching runs when agents are back on."* Never blocked: capturing the verbatim must not depend on a key.
- Matching runs synchronously when fast (<2s), else the result line arrives when it does; the filed item is saved either way the moment "File it" is pressed. The user's write is never held hostage by the agent's classification.

## 2.4 Day one — module enabled, nothing yet

- **Rail:** the Customers item renders dimmed (opacity .4), lighting to full weight at the first feedback item, segment, or accepted proposal.
- **Overview page:** no kicker, no bands. The column centres vertically:
  - Lede, 23px/1.45: **"Where does customer feedback land today? Tell me one thing a customer said — or point me at your reviews — and I'll start finding the themes."**
  - The 2.2 controls, ready to type into, plus a secondary quiet action: **"Set up a feedback source"** (→ the source options from onboarding step 4: review platforms, CSV import — kept deliberately light there, configured properly here).
  - Beneath, the module's principle stated as a quiet helper line, 12.5px `text-faint`: *"Segments and personas here are built from real feedback, reviews and what you tell me — never guessed. Everything you'll see carries its evidence."* This line is the honesty differentiator made visible (0.5); it appears on the day-one page only.
- **Proposals variant:** if onboarding's interview or site-read proposed segments, the day-one page leads with them: lede **"Onboarding turned up `3` likely customer segments. Keep the ones that ring true."**, then the pre-ticked checklist card (name · one-line reason, 13px `text-faint`, e.g. *"Your pricing page speaks to mid-market ops teams"*) with primary action **"Add `3` segments"** — the competitors day-one proposals pattern exactly. The log-feedback controls sit beneath.
- The first filed item swaps the page to the standard Overview with one honest band — a themes band holding one unfiled item is real, not a lonely grid. The footer's agents segment begins showing the module's schedule (*"next theme pass `Thu 09:00`"*).

---

# Part 3 — Segment Objects (and personas within them)

## 3.1 Structure

Sections materialise only when populated. Final visual order:

1. **Header + meta line** — segment name, type badge (when not plain), **"Explore this"**, ghost `…` overflow. Mono meta: `strong fit · 21 feedback items · sentiment 58 · verified 12 d ago`. The verified stamp is the refresh control (stamp-as-control, sibling spec 4.1): hover adds **"· check now"**; while checking it reads `checking now · 0:34` in teal mono.
2. **What changed** — two or three sentences of movement since last look: *"Eight new feedback items this month, six of them about exports — this segment now drives the CSV export limits theme."* With `EvidenceRow` beneath (the evidence contract applies to prose).
3. **Jobs to be done** *(facet)* — mono kicker **"WHAT THEY HIRE YOU FOR"**. Short prose list, each job one line, and beneath the list its **basis line** (mono 11px `text-faint`): `built on 14 feedback items · 6 review quotes` with each figure a live link — or the `added by you` chip where the owner wrote them (0.6). A drafted job the agent cannot source does not render; the section without any basis renders as its invitation (3.5), never as unattributed prose.
4. **Needs and pains** *(facet)* — mono kicker **"NEEDS AND PAINS"**. Compact rows: need text 13.5px `text-body` · right-aligned mono satisfaction where scored (`satisfied 2 of 5`). Section basis line as in 3. No quadrant chart — the judgment view is a Thread away.
5. **Open deep dive** — the Thread anchor, unchanged from the competitor Object.
6. **Personas** — mono kicker **"WHO YOU'LL MEET"**. One block per persona: title 14.5px/500 + identity line (13px `text-faint`: the shared traits — demographics, behaviours), then this product's facet as two quiet labelled lines — **Goals:** …, **Pains:** … Every persona block ends with its **basis line**: `built on 23 feedback items · 12 review quotes · your interview` (figures linked; `added by you` chip where owner-asserted). **A persona with an empty basis cannot render — and cannot exist** (0.5); the SaaS's imagined personas have no display state to occupy here. A persona with no facet for this product does not render (ADR 003: no facet, not in this product's context).
7. **What they're telling you** — mono kicker **"WHAT THEY'RE TELLING YOU"**. The two or three most recent verbatims linked to this segment, hairline-left-ruled, each with its provenance line (0.6) and the theme it filed under as a chip. Quiet expander: **"All `21` items →"**. When no feedback links to this segment yet, the section renders as its invitation rather than vanishing — a segment claiming to describe customers with nothing from them is a gap worth showing: *"No feedback from this segment yet — log something they've said, or connect a source."* with the quiet actions **"Log feedback"** (opens part 2 with this segment pre-filled) and **"Set up a source"**. Day-one grammar, one line, no placeholder frame.
8. **Satisfaction figures** *(facet, only when known)* — mono kicker **"SATISFACTION"**: `CSAT 72 · NPS +18 · from 34 responses · Jun 2026` with source link. Absent entirely when unmeasured — never an empty gauge.
9. **Sources** — the provenance audit rows, competitors idiom: what fed this profile, per-source stamps, **"Add a source"**.
10. **Filed deep dives** — the quiet trailing line.

The SaaS segment-detail sections map as follows: Segment Insights → the what-changed prose and JTBD; Customer Analytics → satisfaction figures (charts retire); Personas → section 6; Customer Needs → section 4; CSAT/NPS → section 8; Call Recordings and Customer Research → Sources rows (and §4a call-transcript ingestion when it ships); Quotes & References → section 7, now with per-item provenance.

## 3.2 The two levels on screen

The page must express shared-vs-facet **without a diagram**:

- **Single-product org:** no markers anywhere (0.2). The page is simply the segment.
- **Multi-product org:** sections carrying **shared** content (header identity, persona identity lines) get one quiet mono suffix on their kicker: **"WHO YOU'LL MEET · shared across your products"**. Facet sections carry no marker — per-product is the default register of the whole app. The header meta's `also served by Payroll` link opens the same entity viewed from that product.
- The rule of thumb enforced in review: **shared says who they are; the facet says what they want from this product.** Any copy that mixes the registers (e.g. a persona identity line mentioning this product's features) fails review.

## 3.3 Editing and correcting — user facts

- All prose sections are inline-editable (click-to-edit, the register of the product profile card). Corrections are **user facts**: they survive agent refreshes (merge-don't-replace), and the section's source line records *"corrected by you · `4 Aug`"*.
- Editing a **shared** field in a multi-product org gets one quiet confirmation line under the field while editing: *"This changes the persona everywhere it's used."* No dialogue — it is the user's own entity; the line is information, not friction.
- The overflow `…` offers: **"Set fit"** (strong / moderate / weak / unrated), **"Change type"** (segment / industry vertical / partnership), **"Remove from this product"**, and — only when no other product holds a facet — **"Delete segment"**. Removal confirm: title **"Remove Mid-market ops teams from this product?"**, body *"Its jobs-to-be-done, needs and feedback links for this product will be deleted. `Payroll` keeps its own view of this segment."* (second sentence only when true). Delete confirm mirrors the competitor stop-tracking dialogue.

## 3.4 Adoption — a second product picks up an existing segment

Mirrors the competitor adoption card (ADR 003 §2.3.2). When an add or proposal matches an existing org entity:

- The proposal card renders **instantly** from the entity — no research wait: header **"Already known — Mid-market ops teams"**, quiet line *"Served by Ledger since `Mar 2026`. Reviewing for Payroll."*
- Body: the shared identity (description, personas' identity lines) shown as fact, followed by the facet-shaped gaps as invitations inside the card: *"What do they hire Payroll for? I'll draft it from your site and their feedback — you'll review it before it's saved."*
- **EvidenceRow:** the entity's existing sources.
- **Actions:** **"Add to Payroll"** (primary teal) · **"Not this product"** (quiet). Accept creates the facet and runs facet-scoped drafting only (JTBD, needs, per-persona goals/pains for this product); the shared identity is not re-researched. Adoption should *feel* like adoption: work already done is the invitation. The card's shared-identity content carries the entity's existing basis lines — adoption inherits evidence, it never invents any; the *facet* sections start as invitations (3.5) until drafting returns sourced content or the owner writes their own.

## 3.5 The evidence basis — invitations and the early treatment

The 0.5 rule, applied to this page:

- **Full basis:** the mono basis line renders in `text-faint`, every figure linked. Owner-asserted content carries `added by you` instead of, or alongside, the figures. This line is not decoration; it is the section's licence to exist.
- **Empty basis = invitation:** a facet section with nothing behind it renders its one-line invitation in the day-one grammar (section 7's pattern above; for JTBD: *"What do they hire this product for? Log some feedback or tell me yourself, and I'll draft it from what's real."* with **"Log feedback"** and **"Write it myself"**). Never a drafted guess, never a dimmed placeholder, never absent-and-silent where the gap is the story.
- **Thin basis = the early treatment:** below fixed thresholds — fewer than `5` evidence items, or a single source kind, and no owner assertion — the basis line takes the amber staleness idiom: *`early — built on 3 feedback items from one source`* (amber, same tint discipline as stale stamps) and the section's prose register stays tentative (*"Early signs suggest…"*). The remedy is always attached: the quiet action **"Add evidence"** (opens part 2 pre-filled). Amber here means *thin*, exactly as it means *stale* elsewhere: an invitation to firm up, never an alarm. Full-confidence prose over a thin basis fails review.
- Thresholds are fixed and documented (the completeness-popover discipline, home spec §B.2) — never a vibe. The same thresholds gate the agents' willingness to draft at all (architecture, in parallel); the surface rule exists so that even a mis-behaving agent has nowhere to put an unsourced claim.

---

# Part 4 — Theme Objects

## 4.1 Structure — evidence first

A theme is an agent-made claim about a pattern; its page leads with the pattern's raw material. Final order:

1. **Header + meta line** — theme name (inline-renamable, 4.5) · **"Explore this"** · ghost `…` overflow. Mono meta: `18 mentions · sentiment 41 · rising · forming · first heard 12 Jun · refreshed 2 d ago`. Stamp-as-control as everywhere.
2. **What changed** — the movement prose with `EvidenceRow`: *"Nine mentions in a fortnight, from three source kinds — the pace doubled after the June pricing change."*
3. **What people said** — mono kicker **"WHAT PEOPLE SAID"**. The verbatims, newest first, hairline-left-ruled 13.5px `text-body`, each with its provenance line (0.6): `customer call · logged by you · 28 Jul` / `G2 review · ★★☆ · 12 Jul` / `CSV import · support-export.csv · 3 Jul`. Where the speaker's segment is known, a segment chip trails the attribution. First five shown; **"All `18` mentions →"** expands inline. Quotes are verbatim with live source links — never paraphrases presented as quotes (the sibling rule, verbatim).
4. **Who it comes from** — mono kicker **"WHO IT COMES FROM"**, only when segment linkage exists: one line per segment, mono figures: `Mid-market ops teams · 11 mentions · sentiment 38` — each a link. This is the join the Roadmap agent will cite; humans get to see it too.
5. **Sentiment, honestly** — folded into the meta and prose, never a gauge. A mixed theme's what-changed prose names the split (1.3). The mean renders only beside its count.
6. **Open deep dive** — the Thread anchor.
7. **Sources** — which sources feed this theme (the poller, review mining, manual entries as a class), per-source stamps.
8. **Filed deep dives** — trailing line.
9. Foot action: **"Log another mention"** (quiet teal) — opens the part-2 flow with this theme pre-suggested.

## 4.2 Lifecycle — observed, not set

Lifecycle is computed from fixed, documented rules — never a vibe, never a hand-set status:

- **forming** — fewer than `5` mentions, or first heard within the last `14` days. Copy register: tentative (*"a theme may be forming"*).
- **established** — `5+` mentions across `2+` source kinds or `2+` segments.
- **fading** — no new mention in `45` days. Fading is not deletion: the theme compresses on the Overview (1.3) and keeps its evidence. A new mention revives it with `NEW`.
- Transitions are digest-worthy findings (*"CSV export limits is now established — `5` mentions across reviews and calls"*) and carry the evidence that crossed the threshold.
- Humans can **retire** a theme (overflow: **"Retire this theme"**) — confirm dialogue states that its mentions return to the unfiled pool and the name is remembered so agents don't recreate it. Retire is the only manual lifecycle act.

## 4.3 Sentiment displayed honestly

Three rules, enforceable in review: the mean never renders without its mention count; a bimodal split (1.3 rule) renders as `mixed` plus prose naming the sides; a sentiment built on fewer than `3` mentions doesn't render at all. Colour never encodes sentiment.

## 4.4 Merge and rename — merge-don't-replace for humans too

Themes are agent-derived; humans correct them with the same discipline agents obey:

- **Rename:** inline on the header. The old name is recorded as an alias (the `normalizedName` discipline), so future agent passes file to the renamed theme rather than recreating the old one. The change line notes it quietly for one visit: *"Renamed from Export caps."*
- **Merge:** overflow **"Merge into…"** opens a picker of other themes (type-ahead). Confirm dialogue: title **"Merge Export file size caps into CSV export limits?"**, body *"Its `4` mentions move across with their sources kept intact. The name is remembered so agents don't rebuild it. This cannot be undone."*, primary **"Merge themes"**. Post-merge, the surviving theme's what-changed prose records the merge with its evidence. Nothing is re-summarised destructively — mentions keep their provenance, the merged name becomes an alias.
- **Split** is deliberately absent in v1: the correction for an overbroad theme is a Thread (*"Explore this — is this one theme or two?"*) whose conclusion the agent proposes as new themes over the same evidence. Do not build a manual split tool speculatively.

---

# Part 5 — Review evidence crossover

Review mining serves two modules from one pipeline. The rule that prevents duplication confusion: **a verbatim is stored once, with one provenance record, and every surface cites the same ID.**

- **Reviews of your product** are feedback. They appear here as feedback items with `review` provenance (0.6), file into themes like anything else, and count in the module's figures. They do **not** appear on any competitor page.
- **Reviews of a competitor's product** are competitive evidence. They appear on that competitor's Object under "What buyers say" (sibling spec 3.6) and never enter your themes, your feedback counts, or this module at all. Whose product the review is about decides the module — not where the miner found it.
- **The crossover case** — a review of *your* product that names a tracked competitor (*"we switched from Mixpanel because the exports kept failing"*): it is filed **once, here**, as your feedback with `review` provenance, and gains a competitor chip in its attribution line. The competitor's Object may cite it (a switching-evidence chip in "What buyers say", clearly labelled *"from your own reviews"*) — a citation of the same record, opening the same evidence view from either door. One record, two doors, zero copies.
- First-time review mining for your own product is source-gated, not item-gated (part 6): the agent proposes the source once (*"I found `84` reviews of your product on G2 — file them as feedback?"* with sample quotes and the evidence row); on accept, mined items flow continuously from that source with per-item provenance. Individual reviews are never individually accepted — that would be governance theatre over public data the user asked for.

---

# Part 6 — The proposal gate in this module

Write governance follows the competitors spec's accept discipline; what differs is *which* writes are claims needing an accept and which are the user's own facts. The dividing line: **new external claims enter context only through an accept; the user's own words and corrections, and agent organisation of already-accepted evidence, write directly.**

| Write | Path | Rationale |
|---|---|---|
| User logs feedback (2.2), edits a profile, sets fit, renames/merges/retires a theme | **Direct** (with confirm dialogues where destructive) | The user is the authority on their own facts; the gate is not for them. |
| Agent creates/updates a **theme**, recomputes sentiment, moves lifecycle | **Direct, with `NEW`** | A theme adds no new claim to the context — it organises evidence the user already owns or accepted. Gating every aggregation would make the module nag; the `NEW` tag plus rename/merge/retire affordances are the human control. |
| Agent proposes a **segment or persona** (from site-read, interview, or feedback patterns) | **Proposal → accept** | A new entity is a claim about the world. Proposal card in the competitors idiom: drafted identity + facet, evidence row, **"Add this segment"** / **"Discard"**. Nothing saved until accept. The card obeys 0.5 at component level: **a proposal with an empty evidence row cannot be constructed** — an agent with nothing behind a persona has no card to show, which is the surface half of the anti-hallucination gate (the agent half is architecture). Interview-derived proposals cite the interview: `your interview · 4 Aug` is a legitimate chip. |
| A second product adopting an existing segment (3.4) | **Proposal → accept** (facet-level) | Per ADR 003 §2.3: tracking is a per-product judgment; adoption never auto-writes into another product's context. |
| First-time review mining of your product (part 5) | **Source-level proposal → accept**, then items flow | Accept the source once; each item keeps provenance. |
| MCP-proposed feedback/intel (`log_feedback` from the user's own AI, §4a) | **Review queue → per-item accept** | Third-party AI pushing claims is exactly what the queue exists for; provenance records who/where/via. Reader tools are refused before this point. |
| Uploaded-document extraction (§4a, Sources sprint) | **Proposal → accept** | Same queue, `internal_document` provenance. Named for completeness; not built in this sprint. |

Nothing in this module writes to any external tool, so the outbound accept rule has no application here — it lives in Roadmap Review, which *reads* this module's themes as evidence.

---

# Part 7 — States

## 7.1 Loading and live

No skeletons, no spinners in the column (0.4). While the theming agent runs: the lede's prepended clause (1.2.5), the footer's `Agents · reading feedback · 0:41` with its permitted pulse, and any affected theme stamp in teal mono `refreshing · 0:12`. The page stays readable and navigable throughout. On completion: stamps settle to `refreshed just now`; changed rows rewrite with `NEW` and, if the user is present, the single 600ms teal tint fade. "Nothing new filed" settles as `refreshed just now · nothing new` for one visit — confirmed quiet, never an apology.

## 7.2 Empty

Day one is 2.4. Within a populated module: a segment with no feedback linkage simply lacks sections 7–8 (no "no feedback yet" placeholders); a themes band with no established themes shows forming ones honestly; the unfiled pool line (2.3) renders only when items wait. Forbidden framings, as in the sibling spec: "No feedback found", "Nothing to show", any dimmed treatment of an up-to-date row.

## 7.3 Errors

- **Feedback source failing** (review poll or import error): the Sources row for that source shows destructive-quiet `couldn't reach G2 · Tue 14:02` · **"Try again"** · **"View log"**. Theme stamps keep counting from the last successful pass — a failed gather never masquerades as a fresh one. Three consecutive failures escalate to the Home attention row only; this page never shouts.
- **No web-search key:** review mining pauses; the single amber notice bar above the kicker (the one banner this page is allowed): *"Customer research is running without web search — review mining is paused. A Perplexity, OpenAI or Gemini key switches it on."* + **"Add a key"**. Manual logging, imports, and theming of held items continue underneath it.
- **No LLM key at all:** Home owns the message (its amber banner); here, filing still works (2.3's "kept safe" path), stamps age truthfully, and refresh affordances carry the quiet inline line *"Agents are paused — add an LLM key first."* No duplicate nagging.

## 7.4 Stale

Amber invitations only, per object type: theme > 7 days → *"Not refreshed in `9` days — new feedback may be waiting to file."* (**"Refresh now"**); segment/persona > 30 days → *"Not verified in `34` days — feedback since then may have moved who they are."* (**"Check now"**). Both actions run the relevant agent directly. The launch catch-up pass covers "everything is old because the app was closed"; the footer's `Agents · catching up · 2 of 6` narrates it without blocking the page.

---

## Appendix A — Data contracts (extends `client/src/mock/types.ts`)

```ts
export type FitWord = "strong fit" | "moderate fit" | "weak fit";
export type ThemeLifecycle = "forming" | "established" | "fading";
export type TrendWord = "rising" | "steady" | "easing";
export type FeedbackSourceKind =
  | "manual" | "review" | "import"      // v1
  | "mcp" | "crm" | "call";             // later; never rendered until shipped

export interface FeedbackProvenance {
  kind: FeedbackSourceKind;
  label: string;                    // "logged by you", "G2 review", "CSV import · support-export.csv"
  detail?: string;                  // "★★☆", channel, filename
  date: string;                     // display form
  sourceUrl?: string;               // live link where the kind has one
}

export interface FeedbackItemRef {
  id: string;                       // the one stored record both modules cite (part 5)
  text: string;                     // verbatim, never paraphrased
  provenance: FeedbackProvenance;
  segmentId?: string;
  themeId?: string;                 // absent ⇒ unfiled pool
  competitorId?: string;            // the crossover chip (part 5)
}

export interface ThemeRow {
  id: string;                       // stable ID the Object and MCP cite
  name: string;
  lifecycle: ThemeLifecycle;
  mentionCount: number;             // ≥ 1 always (a theme with 0 mentions does not exist)
  sentiment?: number;               // absent under 3 mentions (4.3)
  sentimentMixed?: boolean;         // renders "mixed" instead of the mean
  trend?: TrendWord;
  sourceKindCount?: number;
  refreshedAgo: string;
  stale: boolean;                   // now − last refresh > 7 d
  change?: {
    line: string;
    evidence: readonly EvidenceRef[];   // ≥ 1, enforced
    unseen: boolean;                    // renders NEW
  };
  quietSince?: string;              // "21 Jul", for the no-movement line
}

export interface SegmentRow {
  id: string;                       // facet id — the per-product object (ADR 003 §2.5)
  entityId: string;
  name: string;                     // entity name
  type?: "vertical" | "partnership"; // absent ⇒ plain segment, no badge
  fit?: FitWord;                    // absent ⇒ unrated, nothing renders
  personaCount?: number;
  feedbackCount?: number;
  sentiment?: number;
  jtbdLine?: string;                // the facet's one-sentence summary
  alsoServedBy?: readonly ProductRef[]; // non-empty only in multi-product orgs
  verifiedAgo: string;
  stale: boolean;                   // now − last verify > 30 d
}

export interface CustomersOverview {
  lede: RichText;                   // "stale" tone for amber clauses
  themes: readonly ThemeRow[];      // pre-ordered: lifecycle, mentions, staleness
  segments: readonly SegmentRow[];  // pre-ordered: fit, staleness, name
  unfiledCount?: number;            // the "waiting for a pattern" line (2.3)
  reading?: { itemCount: number; elapsedS: number };  // live clause (1.2.5)
  searchKeyMissing: boolean;        // amber notice (7.3)
}

/**
 * The evidence-basis contract (0.5, 3.5). Non-empty by construction:
 * at least one counted evidence kind or ownerProvided — there is no
 * unsourced display state, so the type forbids one.
 */
export interface EvidenceBasis {
  feedbackCount?: number;           // each figure a live link to the items
  reviewCount?: number;
  ownerProvided?: "interview" | "manual";  // renders the "added by you" register
  extraRefs?: readonly EvidenceRef[];      // e.g. a filed deep dive
  thin: boolean;                    // fixed rule: <5 items or 1 source kind, and no owner assertion
}
// Enforced at component level: a section/persona receiving an EvidenceBasis
// with all counts absent and no ownerProvided must throw in dev, render
// nothing in production — mirroring the digest's no-evidence rule.

export interface PersonaBlock {
  id: string;
  title: string;                    // shared identity
  identityLine: string;             // shared traits, one line
  goals?: string;                   // facet — this product only
  pains?: string;                   // facet — this product only
  basis: EvidenceBasis;             // REQUIRED — no basis, no persona (0.5)
}

export interface SegmentAdoptionProposal {
  entityId: string;
  name: string;
  servedBy: ProductRef;             // "Served by Ledger since Mar 2026"
  sharedIdentity: string;
  personas: readonly PersonaBlock[]; // identity only; facets are the drafting work
  evidence: readonly EvidenceRef[];
}
```

`ThemeObject` and `SegmentObject` extend their rows with the part-3/part-4 sections (`whatChanged` + evidence, `jobsToBeDone`, `needs`, `personas: PersonaBlock[]`, `recentItems: FeedbackItemRef[]`, `satisfaction?`, `sources`, `filedThreads`) — each optional, each section absent when its field is, **except** that `jobsToBeDone` and `needs`, when present, each carry a required `basis: EvidenceBasis`, and an absent facet section renders its 3.5 invitation where the gap is the story (JTBD, section 7). The `FeedbackItemRef.id` is the cross-module citation key (part 5).

## Appendix B — Review checklist

- Both themes: amber staleness, destructive source-failure rows, teal-tint chips, `NEW` tag, and the merge/retire dialogues pass in light and dark (`colour/5` + `colour/20` tinted surfaces).
- Every mono element (`tabular-nums`): mention counts, sentiment, fit/lifecycle/trend words, stamps, elapsed counters, persona counts, CSAT/NPS figures.
- Sentiment honesty: no mean without a count; `mixed` where the split rule fires; nothing under 3 mentions; no sentiment colour-coding anywhere.
- Evidence contract: no lede clause, change line, theme, proposal card, or thread answer without at least one live evidence chip; every verbatim carries a provenance line; every provenance chip opens a real Source record or Object.
- **Evidence-basis audit (the anti-hallucination rules, 0.5/3.5):** every rendered persona, JTBD section, needs section, and segment insight carries a visible basis line with live links; there is no code path that renders any of them with an empty basis (dev-mode throw verified); owner-provided content renders the `added by you` register and is never styled as researched evidence; empty-basis gaps render invitations (never drafted guesses, never silent absence where specified); thin-basis sections show the amber early treatment with tentative prose and an "Add evidence" remedy; proposal cards for segments/personas cannot be constructed without evidence.
- Two-level audit: in a single-product org, zero sharing chrome renders; in multi-product, shared kickers carry the suffix and facet sections carry none; no copy mixes the registers (shared = who they are; facet = what they want from this product).
- One-record rule: the crossover verbatim (part 5) resolves to the same ID from the theme page and the competitor page; no duplicated feedback rows in mocks or fixtures.
- Gate audit: agent-proposed segments/personas and adoptions render proposal cards and save nothing until accept; themes write directly but always carry `NEW` + correct affordances; MCP-pushed items appear only in the review queue.
- Grammar audit: no route reaches an Object except a direct link; no tab bars anywhere (this page ships with **no** view toggle); Threads spawn only from Objects; personas render only inside their segment.
- Grep implemented copy against the `design_guidelines.md` substitution table (organise, colour, licence-as-noun, dialogue, cancelled, help centre) before merge.
