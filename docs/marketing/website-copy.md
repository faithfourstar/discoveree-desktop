# Discoveree — Website Copy, Desktop Edition

**Positioning:** A local, agent-maintained context layer for your product that any AI tool can connect to.

---

## Notes on this draft (not website copy)

What changed from the current site and why:

- **The product is the context layer, not the assistant.** All copy that positioned Discoveree as "the AI analyst" doing the thinking has been reframed: your AI tools do the thinking; Discoveree is what makes them good at *your* product.
- **Slack-native section removed** — the Slack bot is deferred in the desktop edition. The "embedded where your team works" job is now done by the MCP section (Claude, Cursor, ChatGPT, custom agents).
- **Integration list trimmed** to what v1 actually ships: Jira/Linear (roadmap in/out), plus "any MCP-compatible tool". The old HubSpot/Salesforce/Pendo/Mixpanel list over-promises for v1 — restore names only as connections land.
- **Internal-source intel is now a headline theme** (added Aug 2026): a dedicated section covers competitor intel from Slack, CRM win/loss records, call recordings and uploaded documents, flowing in over MCP behind the human accept gate (build brief §4a). The hero, diagram and security sections reference it; "MCP in both directions" is the framing.
- **Microsoft ecosystem added** (not yet built): Teams appears alongside Slack as an internal source, Copilot alongside Claude/Cursor/ChatGPT as an MCP consumer. See open question 7 before publishing.
- **Growth mechanics added:** site-wide launch-offer announcement bar, launch-offer callout in pricing (first 100 organisations, first seat free for a year), a dedicated referral section, and "Recommend to a colleague" as the secondary bottom CTA.
- **Commercial Model module added** (brief §4b, decided 4 Aug 2026): new use case 4 ("Context that knows where the money is"), a diagram line, revenue-weighted scoring folded into the roadmap-review use case, and the security section now leads with pricing/margin/revenue data as the thing you'd never upload to SaaS.
- **Go-live rule:** this copy publishes only when everything described is built and downloadable. Present tense throughout is therefore intentional — the pre-publish check in the open questions is a launch-day verification, not a hedging exercise.
- **Static quotes → user reviews** (decided 4 Aug 2026): the social-proof section is now a review wall with a write-a-review flow, seeded with the four existing quotes so it never looks empty. Includes submission-form copy and the legally required incentive-disclosure line. Launch-offer recipients will be asked to review in exchange for the free seat — see open questions 8–9 for the compliance and mechanics decisions.
- **Comparison page + "Ask an AI" section added** (4 Aug 2026, patterns from pathmode.io): a dedicated "Discoveree vs. the rest" page with concede-first framings and one-line antithesis headings; and an "Ask an AI" homepage section with pre-filled Claude/ChatGPT/Copilot/Perplexity query links. The homepage keeps the short "Why not just a Claude project?" section as the flagship, linking to the full page. Comparison targets rebuilt 4 Aug around Faith's actual competitive set (see her tracked competitors + Pathmode/Brief) rather than Klue/Crayon-class CI SaaS, which stay only as the price anchor.
- **Humans + agents reframe** (4 Aug 2026, Faith): the context layer informs *both* humans and agents — shared understanding was already broken in human-only orgs; agents amplified it. Problem section rewritten around this ("misalignment now ships at machine speed"), use-case heading and team headline updated, and copy avoids over-rotating to "informed AI".
- **Build-doc sweep folded in (4 Aug 2026, 11 items + fixes** — see docs/marketing/messaging-log.md in the desktop repo for the itemised log): "no evidence, no assertion" (use case 2 + a new Claude-project bullet), reader-state expiry story in pricing (replacing the WRONG "includes a year of updates", which contradicted the decided trial/expiry model), 14-day trial, no-phone-home + one-folder-backup in security, accept-gate-covers-our-own-agents + thin-public-data + no-connectors lines in internal sources, multi-product research-once in the team section, confirmed-stillness in the Claude-project section, MCP consumption visibility in the diagram, stable themes + switching-review join in use case 2, release-response and iteration-suggestions in use case 3, and "works when closed" scoped to stdio tools (was an overclaim for HTTP-connected tools).
- **Comparison page restructured into two halves** (4 Aug 2026, per Faith's adjacents list): "vs" for tools a buyer might pick *instead* (AI-assistant projects, ChatPRD, PM suites now incl. Productboard/Aha!/ProdPad, research repositories incl. Dovetail, CI SaaS, wikis, DIY) and "with" for the traditional stack Discoveree connects — a to/from table covering Jira/Linear + roadmap tools, HubSpot/Salesforce, Slack/Teams, Pendo/analytics, Dovetail, call recording. Traditional tools from the adjacents list are framed as sources/destinations, not competitors. (Mesmer and Respondent from the list weren't profiled/named — verify what job they'd map to before adding.)
- **Review workflow self-built in Lovable** (4 Aug 2026): logo-permission checkbox added as a separate opt-in on the form; trust section gains an organisation counter (licence-issuance-driven, no app telemetry) and opted-in logos.
- **New sections:** "Why not just a Claude project?", "Your data stays yours" (local/secure/BYO-keys), Pricing ($199/seat/yr + free readers), and the team upgrade story.
- **Quotes kept as-is** — they're about judgment quality and still fit, but worth re-confirming with each person since the product surface they saw has changed.
- **Enterprise-grade security / SOC2 line removed** — the desktop pitch is stronger and true: the data never leaves the machine. Don't claim SOC2 for a desktop app.
- Screenshots marked `<Screenshot>` where the old doc had them. British English throughout.

---

# WEBSITE COPY

## ANNOUNCEMENT BAR (site-wide, above nav)

**Launch offer** — the first 100 organisations get their first seat free for a year. → Claim yours

---

## HERO SECTION

**H1 Headline**
Your AI tools are brilliant. They just don't know your product.

**Subheadline**
Discoveree is a local, agent-maintained context layer for your product — strategy, competitors, customer feedback, and your own feature inventory. It joins up intel from the web and from your internal tools — Slack or Teams, your CRM, customer calls — and serves it to Claude, Copilot, Cursor, ChatGPT, or any AI tool your team already uses.

**Supporting line**
Runs on your desktop. Your data never leaves your machine. Bring your own API keys.

**CTA**
Download &nbsp;|&nbsp; View the source on GitHub

---

## TRUST SECTION

**Trusted by**

**Supporting line**
For AI-native businesses and product teams transforming to AI-driven ways of working.

Bondaval · Semble · AutoGen · Floto.ai · Semaverse.ai
*(+ logos of reviewers who've opted in via the review form)*

**Live counter**
**[XXX] organisations** are building their context layer with Discoveree
*(Implementation note: counter driven by licence issuance — paid seats + launch-offer keys from the merchant-of-record webhook, deduplicated by organisation. NOT app telemetry: the licence check is offline by design and "your data never leaves your machine" is the headline claim. See build brief §2a.)*

---

## PROBLEM SECTION

**Headline**
Every AI conversation about your product starts from zero.

**Content**
You paste the same context into Claude every morning. Your teammate's ChatGPT gives different answers because it's working from different documents. Cursor writes code with no idea what your customers are asking for. And the docs you did upload? Quietly going stale.

This isn't a new problem — teams have never truly shared an understanding of their strategy, their customers, or their market. It lived in heads, scattered docs, and a dozen SaaS silos, and every person worked from a slightly different version. Agents didn't create the problem; they amplified it. Now the misalignment ships at machine speed.

Discoveree fixes the underlying thing: one maintained, shared understanding of your product — for every human and every agent on the team.

---

## HOW IT WORKS — DIAGRAM SECTION

**Headline**
Agents maintain the context. Your AI tools consume it.

**Left column — What Discoveree maintains**
- Competitor profiles, changelogs and review mining — refreshed automatically
- Internal intel joined in: Slack mentions, CRM win/loss records, call transcripts, uploaded research
- Customer feedback clustered into themes, with sentiment and evidence
- Your strategy as structured context: vision, ambitions, pillars, goals
- Your commercial model: pricing, channels, margins, revenue concentration
- Your own product's feature inventory — from your docs, changelog and repo
- Every fact carries its source, confidence, and when it was last verified

**Middle column — Connected over MCP, in both directions**
- One connection, generated for you at setup
- Claude, Copilot, Claude Code, Cursor, ChatGPT, custom agents
- Context flows out to your AI tools — and intel they spot flows back in, behind a human accept gate
- Claude and Claude Code connect even when the app is closed (stdio); other tools connect while it runs
- Teammates' AI tools read your context free, over your local network
- And you can watch it being used: "Claude — 118 queries this week, mostly Competitors and Feedback themes"

**Right column — What your AI can suddenly do**
- Answer "what's changed with competitor X?" with today's answer, not training data
- Pressure-test an idea against real feedback themes and strategy
- Judge whether the roadmap matches the evidence
- Write PRDs, battlecards and launch content grounded in the same shared truth

---

## USE CASES SECTION

**Section heading**
Everything your team — human and AI — needs to decide well and move fast.

**Use case 1 — Competitive intelligence, joined up**
Agents watch your competitors' changelogs, releases, pricing pages and reviews — and detect what *changed*, rather than re-guessing from scratch. Then Discoveree joins the public record with what your company already knows: competitor mentions in Slack, win/loss reasons in your CRM, what buyers said on sales calls. Ask any of your AI tools about a competitor and get one joined-up answer with sources and dates, not a hallucination.

`<Screenshot>`

**Use case 2 — Customer feedback that becomes evidence, never invention**
Feedback flows in and gets clustered into themes with sentiment, linked to segments and personas. When you (or your AI) claim "customers are asking for this", the receipts are attached — a review of your product that names a competitor is even stored once and cited from both sides, in your feedback themes and on that competitor's profile.

Two rules make this trustworthy. **Themes are stable objects:** agents file new feedback into them and never rename, merge or re-invent them — only you do. And **no evidence means no assertion:** a persona or insight without cited evidence structurally cannot exist in Discoveree — the schema refuses it. Where other AI tools would helpfully invent you three personas, Discoveree shows a gap and says what it would take to fill it. Never guessed.

`<Screenshot>`

**Use case 3 — A roadmap review that checks you're building the most valuable things**
Discoveree scores your Jira or Linear roadmap against your strategy, feedback themes, competitor moves, what you've already shipped — and your commercial model, so an initiative serving the segment that drives 60% of your revenue outranks one serving a vocal minority. It reports weekly on what's over-invested, under-supported by evidence, or missing, and suggests items for the gaps. Every suggestion cites its evidence, and nothing reaches your planning tool without a human accepting it.

And because every piece of feedback carries a source date, "fixed" isn't the end of the story. Discoveree shows you what's been heard *since* a release ("since the v2.4 export release: 12 mentions, sentiment improving") — and if complaints keep arriving after you shipped the fix, the theme re-escalates instead of staying buried under "addressed". Suggestions include the next iteration, too: "you shipped X; the customers using it are asking for Y." Ship → hear → judge → suggest the next iteration → ship. Each decision compounds into the next — which is what a coherent product feels like.

`<Screenshot>`

**Use case 4 — Context that knows where the money is**
Your pricing model, distribution channels, margin structure, and which accounts and segments actually drive revenue — captured as structured context alongside strategy and feedback. Ask your AI a pricing, packaging or deal question and it answers from your real commercial model, not generic advice. It's the most confidential context in the product — which is exactly why it lives on your machine and nowhere else.

`<Screenshot>`

**Use case 5 — A thought partner with the full picture**
Pressure-test any product idea against everything Discoveree knows — strategy fit, competitor overlap, customer demand, and whether you've quietly already built it. Like talking to the best PM you've worked with, if they'd also read everything.

`<Screenshot>`

**Bridging line**
Discoveree is the missing layer in your AI stack — the system of record for product context that every tool, agent and teammate works from.

---

## INTERNAL SOURCES SECTION

**Headline**
Your best competitive intel isn't on the web. It's scattered across your company.

**Content**
The deal your sales team lost last week. The competitor mention in this morning's customer call. The win/loss notes buried in your CRM. The market research deck nobody has opened since the offsite. This is your richest intelligence — and today it evaporates.

Discoveree's MCP connectivity works in both directions. It doesn't just serve context to your AI tools — it gathers intel from the tools where your company already talks:

- **Slack or Microsoft Teams** — when your AI (Claude in Slack, Copilot in Teams) reads a competitor mention in a channel, it can propose it straight into Discoveree over MCP.
- **Your CRM** — Salesforce and HubSpot opportunities carry who you were up against and why you won or lost. Those win/loss patterns become competitor evidence — and feed the roadmap review ("we lose on SSO" is a theme with revenue attached).
- **Call recordings** — sales and customer call transcripts, mined for competitor mentions and buying criteria.
- **Documents** — drop in research decks, battlecards or analyst reports; an agent extracts the facts and proposes them into the right profiles.

Because the path in is your own AI over MCP, there are no connectors to build or maintain — if your assistant can read the tool, it can propose the intel.

And for enterprise and niche products whose market barely exists on the public web — no G2 page, no review chatter — this isn't enrichment, it's the primary source. Discoveree is built to work when the web knows nothing about your market: the add-a-competitor flow degrades gracefully into "upload what you have," and internal evidence carries its own provenance and confidence handling.

**Governance line**
Nothing writes itself into the record — and that includes Discoveree's own agents. Everything context-shaping is a proposal until a human accepts it: intel from Slack, a CRM record, or a competitor our own research agent found. Every accepted fact carries its provenance — *"shared by Sam in #sales, via Claude"* — so you always know why Discoveree believes what it believes. (Once you've accepted something, agents maintain it freely; and your own words file directly — no ceremony about your own facts.)

**Punchline**
One layer that joins what the web knows with what your company knows — and every AI tool you use gets both.

---

## "WHY NOT JUST A CLAUDE PROJECT?" SECTION

**Headline**
Couldn't I just put my docs in a Claude project?

**Content**
You could — and for light use, that works for a while. Here's what you'd be giving up:

- **Structure, not prose.** Discoveree's context is typed and validated — stable IDs, provenance, confidence scores. Documents rewritten by prompts silently accumulate duplicates and drift. A schema can't.
- **Detection, not re-derivation.** Deterministic crawling and hash-diff monitoring mean agents notice what changed since last week — instead of expensively re-reading everything and hoping.
- **Freshness you can audit.** Discoveree knows what it knows and when each fact was last verified — and "nothing changed" is itself a finding: agents confirm stillness rather than going silent. With a docs folder, quiet means stale; with Discoveree, quiet means checked.
- **Refusal to guess.** Discoveree's schema requires evidence behind every persona, theme and claim — uncited output cannot be stored, full stop. A project will cheerfully hallucinate the customer insight you asked for.
- **Every tool, not one.** One context layer serves Claude, Copilot, Cursor, ChatGPT, custom agents — and your teammates' tools too. A project is locked to one tool and one account, and a Copilot-shop colleague can never read it at all.
- **Repeatable judgment.** The weekly roadmap review is a consistent, comparable, auditable process over stable data — with accepted suggestions written back to Jira. Not a one-off chat you'll phrase differently next time.

**Punchline**
You could run sales from a Claude project too. Nobody does. Discoveree is the system of record for product context.

---

## SECURITY SECTION

**Headline**
Your competitive strategy shouldn't live on someone else's server.

**Content**
Discoveree is a desktop app with an embedded database. Your strategy, roadmap, competitive intelligence — and your pricing, margins and revenue numbers — stay on your machine, full stop. This is context you would never upload to a SaaS tool, and with Discoveree you never have to.

- **Local by default.** All context is stored in a local database on your computer. There is no Discoveree cloud holding your data. It all lives in one folder — back that folder up and you've backed up Discoveree.
- **No phone-home. At all.** Your licence key is checked on this machine, offline, with a signed key — the app never calls our servers, not even to count you. (Even the organisation counter on this website comes from licence sales, not from the app.) Source-available means you can verify that claim in the code, not take it on trust.
- **Your keys, your calls.** Bring your own API keys — AI calls go directly from your machine to your chosen provider under your agreements. We never see your data and have zero visibility into your usage.
- **Behind your firewall.** Local MCP connections reach the internal tools no SaaS product could ever touch — your Slack, your CRM, your call recordings — and the intel gathered from them stays exactly as private as it was.
- **Source-available.** The full source code is public on GitHub. Don't take our word for any of this — read it.

---

## TEAM SECTION

**Headline**
One shared understanding — for every teammate and every agent.

**Content**
Your machine owns the context and runs the agents. Teammates connect their own AI tools to it over your local network — free, read-only, no licence key, no friction.

That means when an engineer asks Cursor "what do customers say about onboarding?", or a founder asks Claude "what did competitor X ship this quarter?", they get the same maintained, sourced answer you would — without opening another app.

**Connect a teammate** is built in: share a snippet, they paste it into their AI tool, done. Whether they use Claude, Copilot, Cursor or ChatGPT — one context, every tool.

**More than one product?** Competitors and segments are researched once and shared across your portfolio — with per-product judgment. You compete with Xero Payroll, not all of Xero; the threat level differs per product, but the research happens once, and your org's AI is never served five contradictory versions of the same competitor. When a second product adds a competitor the first already tracks, the profile is simply there.

**Growing into a team?** The team tier runs the same Discoveree as a shared server — multiple writers, agents running centrally, web access included, and your solo context migrates up with you.

---

## REFERRAL SECTION

**Headline**
Know a product leader who's still pasting context into ChatGPT?

**Content**
Discoveree spreads the way good tools always have — one product person shows another. If Discoveree has changed how you work, send it on: every recommendation helps us stay independent, source-available, and priced for individuals rather than procurement departments.

**Recommend Discoveree** — share your link with a colleague, a founder friend, or your product community.

**CTA**
Get your referral link

*(Design note: this card should also appear in-app — after a "moment of value" like a first accepted roadmap suggestion — not just on the site.)*

---

## PRICING SECTION

**Headline**
Simple pricing. Free readers.

**Launch offer callout (prominent box at top of section)**
🎉 **Launch offer — first year free for the first 100 organisations.**
Be one of the first 100 organisations to download Discoveree and your first seat is free for a year. One free seat per organisation; additional seats at the standard price. *[Live counter: XX of 100 remaining]*

**Full seat — $199 per user, per year**
For anyone who owns context: runs agents, edits strategy, accepts roadmap suggestions, spawns deep dives. Try everything free for 14 days — no licence needed to start.

**Reader seats — Free, unlimited**
Teammates whose AI tools read your team's context over MCP. No licence, no limit, forever.

**And if you stop paying?** You keep everything. An expired Discoveree becomes a free reader seat of your own context: everything stays readable, MCP keeps serving it to your AI tools — the agents and the pen are what a licence buys. No lockouts, no data ransom, no nag banners. (No upsell chrome inside the product either: modules you didn't choose don't appear as locked teasers — they don't appear at all.)

**You bring the AI.** Discoveree uses your own API keys, so your total cost is $199 per full seat plus your own AI usage — typically a few dollars a month. Compare that with competitive-intelligence platforms at $12,000–60,000 a year.

**CTA**
Buy a licence &nbsp;|&nbsp; Download and try it

---

## "ASK AN AI" SECTION (homepage, after reviews)

**Headline**
Don't take our word for it. Ask your AI.

**Content**
Discoveree exists to make your AI tools smarter about your product — so it would be odd to ask you to trust a marketing page. Ask the tools themselves:

**Buttons (pre-filled query links):**
Ask Claude · Ask ChatGPT · Ask Copilot · Ask Perplexity

*Pre-filled query:* "Is Discoveree (discoveree.com) a good fit for product teams who want their AI tools to know their product? What does it do, and who is it for?"

*(Implementation note: `claude.ai/new?q=…`, `chatgpt.com/?q=…&hints=search`, `copilot.microsoft.com/?q=…`, `perplexity.ai/search?q=…` — all support pre-filled queries. Borrowed pattern from pathmode.io; unusually on-brand for us since the product's whole pitch is AI-tool-native.)*

---

## COMPARISON PAGE — "Discoveree vs. the rest" (separate page, linked from nav/footer)

**Page intro**
Discoveree overlaps with a lot of categories and belongs to none of them. Here's an honest map, in two halves: the tools you might choose *instead* (and when you should), and the tools Discoveree plugs *into*.

**Formula per comparison:** what the other tool is genuinely good at → what it structurally can't do → what Discoveree does instead → a short table (philosophy · where data lives · kept current by · serves your AI tools · price). Concede first, differentiate second — product people can smell a rigged comparison.

---

**1. vs. "just use a Claude project" — *"A project is not a system of record."***
The homepage section, expanded: projects (and their cousins — ChatGPT memory, Copilot notebooks, and the "AI PM operating system" kits that are really folders of markdown files inside one AI tool) are genuinely good for light, single-person use. The five structural gaps: schema vs prose, change-detection vs re-reading, freshness accounting, every-tool-and-every-teammate access, repeatable judgment. Punchline: *you could run sales from a Claude project too — nobody does.*

**2. vs. AI PRD generators (ChatPRD and co.) — *"The document is downstream of the context."***
Concede: ChatPRD is the best-known AI tool in product management for a reason — it drafts PRDs, specs and stories brilliantly, and 100,000+ PMs use it.
Differ: a generator produces artifacts from whatever you tell it in the moment. Discoveree maintains the thing you'd tell it — the strategy, the competitor picture, the feedback evidence, the commercial model — with agents keeping it current and provenance on every fact. Not either/or: point your PRD tool at Discoveree over MCP and its drafts get grounded in your maintained context. ChatPRD writes the doc; Discoveree maintains what the doc is written *from*.

**3. vs. product management suites (Jira Product Discovery, Productboard, Aha!, ProdPad, Craft.io) — *"A roadmap tool ranks what you already believe."***
Concede: these are mature, capable platforms — idea capture, prioritisation frameworks, roadmap views, delivery hand-off. If your team lives in one, keep living in it.
Differ: their context is what humans type into their cloud — nothing maintains it, no agents watch your market or cluster your feedback, and it exists first to serve their own suite. Discoveree doesn't compete with your roadmap tool at all: it reads your roadmap *from* it, checks it against maintained evidence — including what the roadmap might be missing — and writes accepted suggestions back. A roadmap tool ranks what you already believe; a context layer checks whether you should believe it.

**4. vs. research repositories (Dovetail and co.) — *"Stored insight is not served context."***
Concede: purpose-built research repositories are excellent at ingesting, tagging and archiving research at scale.
Differ: a repository's job ends at retrieval — insight you have to go and look for is insight neither your teammates nor their AI actually use. Discoveree clusters feedback into themes with sentiment and provenance, joins them to competitors, strategy and revenue, scores your roadmap against them — and serves the result to every human and every agent on the team.

**5. vs. enterprise competitive-intelligence platforms — *"Knowing your market shouldn't need an enterprise contract."***
Category-framed (the Klue/Crayon class): built for large orgs with a full-time CI function and $12,000–60,000/yr budgets, ending in battlecards and sales-enablement decks for humans to read.
Differ: Discoveree is $199 a year; the intel lives on your machine, not their cloud; it joins up with your strategy, feedback and commercial model instead of sitting in a silo; and it serves humans and agents alike — the same maintained, sourced intel whether it's a teammate asking or their AI.

**6. vs. Notion, Confluence & the strategy wiki — *"A page is not a fact."***
Concede: wikis are where strategy docs live today, and they're fine at being documents.
Differ: nothing maintains a wiki. No freshness accounting, no provenance, no schema — your AI can read the page but can't know whether it's still true. Discoveree's context knows what it knows, where it came from, and when it was last verified.

**7. vs. building it yourself — *"A pipeline is not a product."***
Concede: a good engineer can wire a RAG stack or an MCP server over a folder of docs in a weekend. If you enjoy maintaining it, genuinely, go well.
Differ: the weekend version has no maintenance agents, no change-detection, no accept gates, no freshness model — and it's you who gets paged when it drifts. Discoveree is that stack, productised, for $199 a year. (And it's source-available, so you can still read every line.)

---

**PART TWO OF THE PAGE — "With, not vs: the tools Discoveree connects"**

**Intro line**
Most of your stack isn't competition — it's where your context lives today, scattered. Discoveree plugs into these tools and joins up what they each hold a piece of:

| Your tool | What flows into Discoveree | What flows back |
|---|---|---|
| **Jira / Linear** (and roadmap tools like Aha!, Productboard, ProdPad, Airfocus) | Roadmap items and initiatives, for the weekly evidence review | Accepted, evidence-cited suggestions — created in your tool, never without a human yes |
| **HubSpot / Salesforce** | Win/loss reasons, competitor fields, deal notes → competitor evidence with revenue attached | Deal-relevant context to your AI for pricing, packaging and competitive questions |
| **Slack / Teams** | Competitor mentions and customer feedback, proposed in by your AI | Answers grounded in team context, wherever the question was asked |
| **Pendo / analytics** | Usage signals behind feedback themes | Evidence for what's actually used vs merely requested |
| **Dovetail & research tools** | Interviews and research findings → themes with provenance | Research served to every teammate's AI, not archived |
| **Call recording tools** | Competitor mentions and buying criteria from transcripts | — |

*(Design note: render as an integration grid with logos where a connection ships at launch; the table rows are the copy source. Connections are either direct (Jira/Linear polling) or via the customer's own AI + MCP write surface — don't imply a native connector that doesn't exist yet; the go-live rule applies here hardest.)*

**Closing line**
So the honest comparison map: a handful of tools do a slice of this, none do the whole; most of your stack are sources and destinations, not alternatives. The comparison that matters isn't Discoveree vs any tool — it's a team that shares one understanding of its product, humans and agents alike, versus a team where everyone works from a slightly different one.

---

## REVIEWS SECTION (replaces static quotes)

**Headline**
What product people say about Discoveree

**Sub-line**
Real reviews from real users — unedited, with names and roles.

**Layout**
Review wall (cards with name, role/company, star rating, review text, date). Seeded at launch with the four existing quotes below, clearly labelled ("Early access user" / "Industry voice"), so the wall is never empty; launch-offer reviews fill in behind them.

**Seed content (existing quotes — re-confirm permission before relaunch):**

- "This feels very different to other AI tools, it acts like a thought partner… It's saying 'This is what you need to do to get to the best outcome', which is mimicking how the best PMs I have seen operate."
  — Rags Vadali, CPO & Co-Founder of Floto.ai
- "Gathering the understanding needed to inform great product decisions is one of the hardest parts of the job. Discoveree acts as a true partner to the team, enhancing our existing capabilities and sharpening the quality of the decisions we make."
  — Aine McKay, CPO of Autogen
- "Discoveree is helping us really understand our customers, whilst also transitioning to AI driven ways of working."
  — Sandy Forster, CPO of Bondaval
- "Product is a hard job. Who wouldn't want a senior advisor on call for your hardest decisions?"
  — Bruce McCarthy, Author of *Aligned: Stakeholder Management for Product Managers*

**Write-a-review card (last card in the wall)**
Using Discoveree? Tell the next product person what you think — the good and the honest.
**CTA:** Write a review

**Disclosure microcopy (small print under the wall — legally required, see open question 8)**
Some reviewers received Discoveree free as part of our launch offer. Reviews are the writer's own words; we publish them unedited and never make a positive review a condition of anything.

---

## REVIEW SUBMISSION FORM (copy for the collection form)

**Heading:** Review Discoveree

**Intro line:** Two minutes, your own words. Honest beats glowing — product people can smell astroturf a mile off.

**Fields:** Name · Role & company (shown with your review) · Star rating · Your review · What do you use Discoveree for? (optional) · Which AI tools do you connect? (optional — Claude / Copilot / Cursor / ChatGPT / other)

**Consent checkboxes (two, separate — logo permission must not be bundled into publication consent):**
- ☐ I'm happy for this review to be published on discoveree.com with my name and role.
- ☐ You're welcome to show my organisation's logo on discoveree.com alongside reviews and customer logos. *(optional)*

**Post-submit message:** Thank you — your review will appear once we've checked it's not spam. We don't edit reviews.

---

## BOTTOM CTA

**Headline**
Ready to find out what your AI tools can do when they actually know your product?

**Subhead**
Point Discoveree at your product's URL. Agents draft your profile, propose your competitors, and build your context layer — then connect it to the AI tools you already use. First 100 organisations: your first year is on us.

**CTA**
Download for macOS &nbsp;|&nbsp; Recommend to a colleague

---

## FOOTER

**Descriptor line**
Discoveree. The context layer for product teams — local, agent-maintained, connected to every AI tool you use.

---

## Open questions for Faith

*(Superseded by the go-live rule — kept as the launch-day checklist: since the site only publishes once everything is built and downloadable, the old "hedge or verify?" questions collapse into a single pre-publish verification: every capability named in the copy — internal-source ingestion, Teams/Copilot over MCP, the commercial module — works in the shipping build.)*

1. **Platforms** — copy says "Download for macOS"; add Windows when signing is sorted, or say "macOS and Windows" if both ship at launch.
2. **Quotes** — all four were given about the SaaS product. Worth a quick permission/re-confirm pass, especially if the relaunch is loud.
3. **Nav** — old nav had Podcast and How it's Built. Both can stay; "How it's Built" becomes a genuinely good page for a source-available product (schema, provenance, the MCP surface).
4. **Pricing display** — $199 is decided; decide whether the site shows the team tier as "coming soon" with no price, or hides it entirely until it exists.
5. **Referral incentive** — the section currently asks for recommendations without offering a reward. Decide: goodwill-only, or an incentive (e.g. a free month per converted referral, or "give a month, get a month"). Check what Paddle/Lemon Squeezy support for referral codes/coupons before promising mechanics.
6. **Launch offer mechanics** — decide before the banner goes up: how "one per organisation" is verified (email domain?), whether a card is required and the seat auto-converts to paid at year end (say so explicitly if yes — silence here erodes trust), whether the live counter is real or manually updated, and what the offer's licence key looks like in the merchant-of-record flow.
7. **Commercial context and free readers** — the module's design doc still has to answer whether commercial context is excluded from the reader surface by default (brief §4b sensitivity note). The website copy deliberately doesn't promise either way yet; once decided, add a line to the team section — "you control which modules readers can see" is a selling point worth stating if it ships.
8. **Incentivised-review compliance** — asking for a review in exchange for the free seat is legal in the UK/US *if*: the incentive is disclosed wherever the reviews appear (the microcopy line does this — don't delete it), the ask is for an *honest* review with no steer towards positive, and you don't cherry-pick (define a moderation policy: spam/abuse removal only, not sentiment filtering). Under the UK DMCC Act 2024 undisclosed incentivised reviews are a banned practice, so this line is load-bearing. Also: keep this on your own site — Trustpilot/G2 prohibit incentivised reviews outright.
9. ~~Review mechanics~~ **DECIDED (4 Aug 2026):** review workflow built into the Lovable site (no third-party service); free seat granted on download with the review requested in-app after a value moment. The in-app ask, trigger candidates, logo-permission checkbox and the no-telemetry counter are now specified in the desktop build brief §2a. Remaining sub-decision: which value-moment trigger (first accepted suggestion vs ~14 days active use vs first accepted competitor).
10. **Named competitors on the comparison page** — research (4 Aug 2026) says name only the widely known: **ChatPRD** (100k+ users, best-known AI-PM tool), **Jira Product Discovery** (Atlassian), **Craft.io** (funded, enterprise logos). Klue/Crayon stay category-framed as the price anchor. The rest of your tracked set (Zentrik, Brief, Velociti, Stilla, AI PM OS, Fygurs, Pathmode) are too obscure to name on a marketing site — a named comparison just gives them exposure; the category framings cover them without free advertising. Named claims must stay accurate and current: keep them verifiable (public pricing, dated) and dogfood — track these companies in Discoveree and let changelog monitoring flag stale comparisons.
11. **Competitive watchlist (from the 4 Aug research — track in Discoveree, don't name on the site):** *Zentrik* (zentrik.ai — closest functional substitute: evidence-backed context, MCP delivery to Cursor/Claude, human-governed Jira writes; SaaS, feedback-centric, $750/mo team pricing); *Brief* (briefhq.ai — closest on architecture: an MCP server/CLI serving decision context to coding agents, but no strategy/competitor/feedback layer and no agent maintenance); *Velociti* (velocitipm.com — literally markets a "Continuous Context Layer" but keeps it for its own UI, no MCP); *Stilla* (stilla.ai — "shared memory" language, $5M from General Catalyst, engineering-team focused); *AI PM OS* (prodmgmt.world — $99 markdown-file kit inside Claude/Cursor; the productised version of the "just use a Claude project" objection); *Pathmode* (intent specs for solo AI builders). **Key strategic finding: MCP serving is now table stakes — Atlassian, Craft.io, ChatPRD, Zentrik, Brief and Stilla all ship or advertise it. Nobody combines agent-maintained competitor+strategy+feedback+commercial context, local-first data, and tool-agnostic serving — that combination, not "we have MCP", is the differentiation, and the copy should never lead with MCP alone.**
