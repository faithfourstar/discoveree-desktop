/**
 * Mock-data contracts for the Discoveree Desktop client shell.
 *
 * These are shaped like real context objects (stable IDs, evidence arrays
 * with source counts, provenance-ish metadata) so that the future server
 * wiring swaps the data source, not the components.
 */

// ---------------------------------------------------------------------------
// Modules
// ---------------------------------------------------------------------------

export type ModuleId =
  | "home"
  | "competitors"
  | "customers"
  | "strategy"
  | "roadmap"
  | "connections"
  | "settings";

export interface ModuleState {
  /** Chosen during onboarding — unchosen modules are absent everywhere. */
  enabled: boolean;
  /** Chosen but not yet populated modules render dimmed in the rail. */
  populated: boolean;
  /** Optional count badge (e.g. suggestions awaiting review on Roadmap). */
  badge?: number;
}

// ---------------------------------------------------------------------------
// Products — the org's own products (ADR 003 §1.2: multi-product shell)
// ---------------------------------------------------------------------------

/** One of the organisation's products, as the shell needs it. */
export interface ProductRef {
  id: string;
  name: string;
}

/** The "add another product" prompt's transient submit state. */
export interface ProductCreateState {
  pending: boolean;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Rich text — prose with inline object links and staleness highlights
// ---------------------------------------------------------------------------

export interface RichSegment {
  text: string;
  /**
   * "link" renders teal; "stale" renders the amber staleness underline;
   * "mono" renders inline mono figures (counts, day counts) in prose.
   */
  tone?: "link" | "stale" | "mono";
  /** Stable context-object ID the segment points at, when it is a link. */
  objectId?: string;
  /**
   * Display-locale boundary (lib/locale.ts): true marks the segment as DATA
   * (mined verbatims, agent-stored prose, object names) — never run through
   * the copy transform. Segments with an objectId or tone "mono" are treated
   * as data automatically.
   */
  data?: boolean;
}

export type RichText = readonly RichSegment[];

// ---------------------------------------------------------------------------
// Evidence — every briefing item and thread carries its citations
// ---------------------------------------------------------------------------

export type EvidenceKind =
  | "source"
  | "feature-inventory"
  | "feedback"
  | "connection"
  | "theme"
  | "pillar";

export interface EvidenceRef {
  id: string;
  kind: EvidenceKind;
  /** Display label, e.g. "2 sources" or "Jira · 27 initiatives". */
  label: string;
  /** Count backing the label, where one exists. */
  count?: number;
  /** Stable ID of the cited context object or source record. */
  objectId?: string;
  /** External provenance URL — the chip renders as a live link when set. */
  href?: string;
}

// ---------------------------------------------------------------------------
// Home — briefing state
// ---------------------------------------------------------------------------

export interface BriefingAction {
  label: string;
  objectId?: string;
  href?: string;
}

export interface BriefingItem {
  id: string;
  body: RichText;
  evidence: readonly EvidenceRef[];
  action: BriefingAction;
}

export interface ServingConsumer {
  tool: string;
  queriesThisWeek: number;
  /** Door target on Connections (connections-spec 6.2). */
  anchor?: McpToolId;
}

/**
 * The home Serving line — a summary of the Connections page, never a second
 * source of truth (connections-spec 6.2): every figure here is a figure there.
 */
export interface ServingSummary {
  consumers: readonly ServingConsumer[];
  teammatesReading: number;
  /** Variant: a tool is set up but silent — "Claude set up, waiting…". */
  waitingToolName?: string;
  /** Variant: job 5 on, nothing configured — the invitation line. */
  invitation?: boolean;
  /** Quiet upgrade fact: "Maya's Claude tried to write — full seats". */
  writeAttemptFragment?: string;
}

export interface HomeBriefing {
  kicker: string;
  lede: RichText;
  items: readonly BriefingItem[];
  ideaPlaceholder: string;
  serving: ServingSummary;
}

// ---------------------------------------------------------------------------
// Home — day-one state
// ---------------------------------------------------------------------------

export interface DayOnePrompt {
  lede: string;
  inputPlaceholder: string;
  cta: string;
  helper: string;
}

// ---------------------------------------------------------------------------
// Competitors — Overview (competitors-module-spec Appendix A)
// ---------------------------------------------------------------------------

export type ThreatWord = "big threat" | "competitive" | "watch" | "quiet";

export interface CompetitorChange {
  /** One sentence — the one thing that changed since the user last looked. */
  line: string;
  /** ≥ 1, enforced — no finding renders without provenance. */
  evidence: readonly EvidenceRef[];
  /** Renders the NEW tag; cleared once the Object has been opened. */
  unseen: boolean;
}

export interface CompetitorRow {
  /** Same stable ID the Object and MCP cite. */
  id: string;
  name: string;
  /**
   * The server API knows "DIRECT" | "ADJACENT" only. "ASPIRATIONAL" is
   * mock-only — a design-harness value with no pipeline behind it.
   */
  classification: "DIRECT" | "ADJACENT" | "ASPIRATIONAL";
  domain: string;
  threat: ThreatWord;
  /** Absent ⇒ segment not rendered (no gap, no dash, no zero). */
  sentiment?: number;
  reviewCount?: number;
  /** Display form; derived from last_verified_at. */
  verifiedAgo: string;
  /** now − last_verified_at > 14 d. */
  stale: boolean;
  /** Day count backing the stale invitation copy ("Not verified in 16 days"). */
  staleDays?: number;
  lastRunFailed?: { at: string; reason: string };
  /** Absent ⇒ "nothing new since …" line. */
  change?: CompetitorChange;
  /** e.g. "24 Jul", for the no-change line. */
  confirmedQuietSince?: string;
  /** Hours since last successful verification — table sort key for Verified. */
  verifiedOrder?: number;
  /** Saved by hand via the 5.1 escape hatch; stamp reads "added by hand · not yet verified". */
  unverified?: boolean;
  /** Overrides the unverified stamp copy (live: "profile being drafted · not yet verified"). */
  unverifiedLabel?: string;
}

export interface CompetitorChecking {
  id: string;
  name: string;
  elapsedS: number;
}

export interface CompetitorsOverview {
  /** Reuses the "stale" tone for the amber underline. */
  lede: RichText;
  /** Pre-ordered by threat, staleness, name — stable during a session. */
  rows: readonly CompetitorRow[];
  /** Persisted preference. */
  view: "cards" | "table";
  checking?: readonly CompetitorChecking[];
  /** Drives the amber notice (spec 5.3). */
  searchKeyMissing: boolean;
}

// ---------------------------------------------------------------------------
// Competitors — add flow ("Track another", spec part 2)
// ---------------------------------------------------------------------------

export type AddStageStatus = "running" | "done" | "skipped" | "failed";

export interface AddStage {
  id: string;
  /** Current display label — mock/server rewrites it as the stage resolves. */
  label: string;
  status: AddStageStatus;
  /** Mono completion time, e.g. "12 s". */
  completedIn?: string;
}

export interface CompetitorProposal {
  /** Live mode: the proposed competitor's stable server id. */
  id?: string;
  name: string;
  domain: string;
  classification: "DIRECT" | "ADJACENT";
  suggestedThreat: ThreatWord;
  /** Collapsed mono summary of the run, e.g. "Read amplitude.com · 5 findings · 84 reviews · 1 m 40 s". */
  summaryLine: string;
  /** The drafted positioning, one paragraph. */
  summary: string;
  theyBeatYouOn: readonly string[];
  youBeatThemOn: readonly string[];
  /** Live drafts carry provenance-cited differentiators instead of columns. */
  differentiators?: readonly { text: string; sourceUrl: string | null }[];
  /** ≥ 1, every chip live. */
  evidence: readonly EvidenceRef[];
  sentiment?: number;
  reviewCount?: number;
  /** Present when review mining was skipped (no web-search key). */
  crawlOnlyNote?: string;
  /**
   * Present when enrichment failed on the draft (spec 5.1): the card offers
   * accept-unverified alongside Try again and Discard.
   */
  failureNote?: string;
  /**
   * Quiet inline error under the name field when persisting a rename failed
   * (live mode), e.g. "You’re already tracking a competitor called Amplitude."
   */
  nameError?: string;
  /**
   * ADR 003 §2.3/§2.9: the entity already exists in the organisation —
   * another product tracks it — so this proposal is an adoption: the
   * profile renders instantly from the shared entity, nothing is
   * re-researched, and the card says so.
   */
  adoption?: {
    /** Names of the other products already tracking this entity. */
    otherProductNames: readonly string[];
  };
}

export interface AddFlowFailure {
  domain: string;
  /** e.g. "We couldn't reach amplitude.com — the site didn't answer." */
  line: string;
}

export interface AddFlowState {
  /** The inline section at the foot of the list is expanded. */
  open: boolean;
  /** URL input, or the "I only know the name" alternative. */
  mode: "url" | "name";
  /** Typed input survives collapse this session. */
  draft: string;
  phase: "input" | "researching" | "failed" | "proposal" | "manual";
  stages: readonly AddStage[];
  proposal?: CompetitorProposal;
  failure?: AddFlowFailure;
  /**
   * A proposed row left over from a previous session (live mode): surfaced
   * when the flow opens — "You were reviewing X — continue or discard".
   */
  orphan?: { id: string; name: string };
}

/** A competitor proposed by onboarding step 1 and deferred (spec 2.5). */
export interface OnboardingCompetitorProposal {
  id: string;
  name: string;
  /** One-line reason, e.g. "Named alongside you on comparison pages". */
  reason: string;
}

// ---------------------------------------------------------------------------
// Connections (connections-spec Appendix A)
// ---------------------------------------------------------------------------

/**
 * "copilot" (GitHub Copilot in VS Code) is an owner addition to the spec's
 * four ids — first-class named block, same snippet mechanics as Cursor.
 */
export type McpToolId = "claude" | "cursor" | "chatgpt" | "copilot" | "custom";

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
  | { kind: "waiting"; setUpAgo: string; agedDays?: number } // agedDays ⇒ amber
  | { kind: "connected"; stats: ConsumptionStats; justConnected?: boolean };

export interface McpToolRow {
  id: McpToolId;
  name: string; // "Claude", "Custom or my own agents"
  description: string; // the one-line 2.4 description
  transport: "stdio" | "http" | "both";
  state: ToolRowState;
  /** Teal meta fragment + lede priority 1; door to the owning module's queue. */
  pendingProposals?: number;
  /** Config snippet(s) as rendered — already resolved against ServingStatus. */
  snippets: readonly {
    filename?: string; // "claude_desktop_config.json"
    body: string; // mono block content, copy-ready
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
  readerLabel: string; // "Maya's Claude"
  action: "add-competitor" | "log-feedback" | "other";
  /** Name only — metadata, not the claim's content. */
  objectName?: string;
  at: string; // "Tue 14:02"
  /** Collapsed repeats: "has tried to write 3 times this week". */
  countThisWeek?: number;
}

/** 4.2 — the arrival card, rendered inside the owning module's queue. */
export interface McpArrivalCard {
  id: string;
  kind: "competitor-intel" | "feedback";
  title: string; // "Competitor intel — Harvey"
  /** The words as shared — verbatim, hairline-ruled, never paraphrased. */
  verbatim: string;
  attribution: {
    via: string; // "Claude" — from MCP client info
    sharedBy?: string; // asserted, tool-reported (ADR 005)
    channel?: string; // "#sales-eu"
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
  name: string; // "Jira"
  meta: string; // "jira.acme.com · 27 roadmap items · checked 2 h ago · daily"
  testing?: { elapsedS: number };
  testResult?:
    | { kind: "works"; line: string }
    | { kind: "failed"; line: string };
  pollFailed?: { at: string; reason: string };
  /** The Feedback-sources door row renders from this variant. */
  door?: { line: string; href: string };
}

/**
 * The "Set up automatically" outcome (never-aspirational: the button claims
 * success only when the server reports the file actually written).
 */
export type ClaudeSetupResult =
  | { kind: "pending" }
  | { kind: "written"; configPath: string }
  | { kind: "failed"; message: string };

export interface ConnectionsOverview {
  lede: RichText;
  serving: ServingStatus | null; // null ⇒ job 5 off (block + tools absent)
  tools: readonly McpToolRow[];
  readers: readonly ReaderRow[];
  writeAttempts: readonly WriteAttempt[];
  checking: readonly CheckingRow[] | null; // null ⇒ no data-tool job
  /** Sum surfaced in the lede; per-tool splits live on the rows. */
  pendingProposalsTotal?: number;
}

// ---------------------------------------------------------------------------
// Customers — Overview (customers-module-spec Appendix A)
// ---------------------------------------------------------------------------

export type FitWord = "strong fit" | "moderate fit" | "weak fit";
export type ThemeLifecycle = "forming" | "established" | "fading";
export type TrendWord = "rising" | "steady" | "easing";
export type FeedbackSourceKind =
  | "manual"
  | "review"
  | "import" // v1
  | "mcp"
  | "crm"
  | "call"; // later; never rendered until shipped

export interface FeedbackProvenance {
  kind: FeedbackSourceKind;
  /** "logged by you", "G2 review", "CSV import · support-export.csv". */
  label: string;
  /** "★★☆", channel, filename. */
  detail?: string;
  /**
   * When it was SAID (sourceCreatedAt), display form. Absent ⇒ the item is
   * undated and renders "date unknown" — the collection date is never
   * dressed as the feedback date.
   */
  date?: string;
  /** When we gathered it — a separate fact, rendered as "mined 4 Aug". */
  minedOn?: string;
  /** Live link where the kind has one. */
  sourceUrl?: string;
}

export interface FeedbackItemRef {
  /** The one stored record both modules cite (spec part 5). */
  id: string;
  /** Verbatim, never paraphrased. */
  text: string;
  provenance: FeedbackProvenance;
  segmentId?: string;
  /** Absent ⇒ unfiled pool. */
  themeId?: string;
  /** The crossover chip (spec part 5). */
  competitorId?: string;
  /** Display name for the theme chip on segment pages. */
  themeName?: string;
  /** Display name for the segment chip on theme pages. */
  segmentName?: string;
  competitorName?: string;
}

/** One-sentence movement line + its citations (shared row shape). */
export interface ChangeLine {
  line: string;
  /** ≥ 1, enforced. */
  evidence: readonly EvidenceRef[];
  /** Renders NEW; cleared once the Object has been opened. */
  unseen: boolean;
}

export interface ThemeRow {
  /** Stable ID the Object and MCP cite. */
  id: string;
  name: string;
  lifecycle: ThemeLifecycle;
  /** ≥ 1 always (a theme with 0 mentions does not exist). */
  mentionCount: number;
  /** Absent under 3 mentions (spec 4.3). */
  sentiment?: number;
  /** Renders "mixed" instead of the mean. */
  sentimentMixed?: boolean;
  trend?: TrendWord;
  sourceKindCount?: number;
  refreshedAgo: string;
  /** now − last refresh > 7 d. */
  stale: boolean;
  staleDays?: number;
  change?: ChangeLine;
  /** "21 Jul", for the no-movement line. */
  quietSince?: string;
}

export interface SegmentRow {
  /** Facet id — the per-product object (ADR 003 §2.5). */
  id: string;
  entityId: string;
  /** Entity name. */
  name: string;
  /** Absent ⇒ plain segment, no badge. */
  type?: "vertical" | "partnership";
  /** Absent ⇒ unrated, nothing renders. */
  fit?: FitWord;
  personaCount?: number;
  feedbackCount?: number;
  sentiment?: number;
  /** The facet's one-sentence summary. */
  jtbdLine?: string;
  /** Non-empty only in multi-product orgs. */
  alsoServedBy?: readonly ProductRef[];
  verifiedAgo: string;
  /** now − last verify > 30 d. */
  stale: boolean;
  staleDays?: number;
}

export interface CustomersOverview {
  /** "stale" tone for amber clauses. */
  lede: RichText;
  /** Pre-ordered: lifecycle, mentions, staleness. */
  themes: readonly ThemeRow[];
  /** Pre-ordered: fit, staleness, name. */
  segments: readonly SegmentRow[];
  /** The "waiting for a pattern" line (spec 2.3). */
  unfiledCount?: number;
  /** Live clause (spec 1.2.5). */
  reading?: { itemCount: number; elapsedS: number };
  /** Amber notice (spec 7.3). */
  searchKeyMissing: boolean;
}

/**
 * The evidence-basis contract (spec 0.5, 3.5). Non-empty by construction:
 * at least one counted evidence kind or ownerProvided — there is no
 * unsourced display state, so the type forbids one. Enforced at component
 * level: an empty basis throws in dev and renders nothing in production.
 */
export interface EvidenceBasis {
  /** Each figure a live link to the items. */
  feedbackCount?: number;
  reviewCount?: number;
  /** Renders the "added by you" register. */
  ownerProvided?: "interview" | "manual";
  /** e.g. a filed deep dive. */
  extraRefs?: readonly EvidenceRef[];
  /** Fixed rule: <5 items or 1 source kind, and no owner assertion. */
  thin: boolean;
  /** Single source kind backing the thin copy ("from one source"). */
  singleSourceKind?: boolean;
  /** "corrected by you · 4 Aug" — user facts survive refreshes (3.3). */
  correctedOn?: string;
}

export interface PersonaBlock {
  id: string;
  /** Shared identity. */
  title: string;
  /** Shared traits, one line. */
  identityLine: string;
  /** Facet — this product only. */
  goals?: string;
  /** Facet — this product only. */
  pains?: string;
  /** REQUIRED — no basis, no persona (spec 0.5). */
  basis: EvidenceBasis;
}

export interface SegmentAdoptionProposal {
  entityId: string;
  name: string;
  /** "Served by Ledger since Mar 2026". */
  servedBy: ProductRef & { since: string };
  sharedIdentity: string;
  /** Identity only; facets are the drafting work. */
  personas: readonly PersonaBlock[];
  evidence: readonly EvidenceRef[];
}

// ---------------------------------------------------------------------------
// Customers — Objects (spec parts 3 and 4)
// ---------------------------------------------------------------------------

export interface SegmentBreakdownRow {
  segmentId: string;
  name: string;
  mentions: number;
  sentiment?: number;
}

export interface ThemeObject {
  id: string;
  name: string;
  lifecycle: ThemeLifecycle;
  mentionCount: number;
  sentiment?: number;
  sentimentMixed?: boolean;
  trend?: TrendWord;
  /** "first heard 12 Jun". */
  firstHeard?: string;
  refreshedAgo: string;
  stale?: boolean;
  staleDays?: number;
  /** The what-changed prose (movement since last look). */
  summary: string;
  /** ≥ 1 — the prose never renders uncited. */
  changeEvidence: readonly EvidenceRef[];
  changeUnseen?: boolean;
  /** "Renamed from Export caps." — quiet note for one visit (4.4). */
  renamedFrom?: string;
  /** What people said — newest first. */
  items: readonly FeedbackItemRef[];
  /** Who it comes from — only when segment linkage exists. */
  segmentBreakdown?: readonly SegmentBreakdownRow[];
  sources?: readonly SourceRow[];
  openThread: DeepDiveThread | null;
  filedThreads: readonly FiledThreadRef[];
}

export interface NeedRow {
  id: string;
  text: string;
  /** Right-aligned mono where scored, e.g. "satisfied 2 of 5". */
  satisfied?: string;
}

export interface SegmentSatisfaction {
  csat?: number;
  nps?: number;
  responses?: number;
  /** "Jun 2026". */
  period?: string;
  sourceUrl?: string;
}

export interface SegmentObject {
  /** Facet id. */
  id: string;
  entityId: string;
  name: string;
  type?: "vertical" | "partnership";
  fit?: FitWord;
  feedbackCount?: number;
  sentiment?: number;
  verifiedAgo: string;
  stale?: boolean;
  staleDays?: number;
  /** What changed — absent on a fresh profile. */
  summary?: string;
  changeEvidence?: readonly EvidenceRef[];
  changeUnseen?: boolean;
  /**
   * Live 422 insufficient_evidence rendering (ADR 004 §3.3): the honest
   * amber line explaining why enrichment cannot run yet.
   */
  enrichNotice?: string;
  /** Facet sections: absent ⇒ the 3.5 invitation renders in their place. */
  jobsToBeDone?: { items: readonly string[]; basis: EvidenceBasis };
  needs?: { items: readonly NeedRow[]; basis: EvidenceBasis };
  personas: readonly PersonaBlock[];
  /** What they're telling you; empty ⇒ the section-7 invitation. */
  recentItems: readonly FeedbackItemRef[];
  /** Absent entirely when unmeasured — never an empty gauge. */
  satisfaction?: SegmentSatisfaction;
  sources?: readonly SourceRow[];
  /** Multi-product markers (0.2/3.2): absent in single-product orgs. */
  sharedAcrossProducts?: boolean;
  alsoServedBy?: readonly ProductRef[];
  openThread: DeepDiveThread | null;
  filedThreads: readonly FiledThreadRef[];
}

// ---------------------------------------------------------------------------
// Customers — log-feedback flow (spec part 2)
// ---------------------------------------------------------------------------

export type FeedbackFilingResult =
  | { kind: "matched"; themeId: string; themeName: string; ordinal: string }
  | { kind: "unfiled"; totalThemes: number; unfiledCount: number }
  | { kind: "held" } // agents paused — kept safe, matched later
  | { kind: "filed" }; // saved; matching still running (live mode)

export interface LogFeedbackState {
  open: boolean;
  /** The verbatim. This field alone is enough to file. */
  draft: string;
  who?: string;
  where?: string;
  when?: string;
  /** Opened from a theme Object ("Log another mention"). */
  presetThemeId?: string;
  /** Opened from a segment Object (section-7 invitation). */
  presetSegmentId?: string;
  /** The 2.3 result line; fades after the next navigation. */
  result?: FeedbackFilingResult;
  /** A save failure — the draft is restored, nothing is lost. */
  error?: string;
}

// ---------------------------------------------------------------------------
// Competitors — Object view with an open deep-dive Thread
// ---------------------------------------------------------------------------

export interface DeepDiveThread {
  id: string;
  status: "open" | "filed";
  question: string;
  answer: string;
  evidence: readonly EvidenceRef[];
  fileUnderLabel: string;
  keepAskingLabel: string;
}

export interface FiledThreadRef {
  id: string;
  title: string;
  /** Absolute date, e.g. "28 Jul". */
  filedOn: string;
}

/** A capability listed in the feature-coverage columns; chips link to feature or gap records. */
export interface CapabilityRef {
  id: string;
  label: string;
  objectId?: string;
}

export interface FeatureCoverage {
  /** "They cover `31` of the `142` features in your inventory…" */
  covered: number;
  inventoryTotal: number;
  /** "…and `9` of theirs have no equivalent in yours." */
  uniqueToThem: number;
  theyHaveYouDont: readonly CapabilityRef[];
  youHaveTheyDont: readonly CapabilityRef[];
}

export interface ReviewQuote {
  id: string;
  /** Verbatim excerpt with a live source link — never a paraphrase. */
  text: string;
  /** Mono attribution, e.g. "G2 · 28 Jul · ★★☆". */
  attribution: string;
  sourceId?: string;
}

export interface ReviewEvidence {
  /** e.g. "Sentiment `66` across `107` reviews, drifting down since May." */
  line: RichText;
  quotes: readonly ReviewQuote[];
}

/** One provenance row in "What this profile is built on". */
export interface SourceRow {
  id: string;
  /** e.g. "mixpanel.com/changelog". */
  name: string;
  /** What it feeds, e.g. "site crawl", "watching for changes". */
  feeds: string;
  /** Mono stamp, e.g. "checked 4 h ago" or "84 reviews · 12 Jul". */
  stamp: string;
  /** Amber past its threshold (changelog watch: 7 days). */
  stale?: boolean;
}

/** A provenance-carrying differentiator bullet (live API detail view). */
export interface CitedDifferentiator {
  text: string;
  sourceUrl: string | null;
}

export interface CitedFeature {
  feature: string;
  sourceUrl: string | null;
}

export interface CitedMarket {
  market: string;
  sourceUrl: string | null;
}

/** One change record on the Object view (live API: 20 newest). */
export interface ObjectChange {
  id: string;
  changeType: string;
  title: string;
  description: string;
  sourceUrl: string | null;
  /** Formatted client-side, e.g. "12 Jul". */
  detectedOn: string;
}

export interface CompetitorObject {
  id: string;
  name: string;
  /** "ASPIRATIONAL" is mock-only — the server API knows DIRECT | ADJACENT. */
  classification: "DIRECT" | "ADJACENT" | "ASPIRATIONAL";
  domain: string;
  threat: ThreatWord;
  /** Absent ⇒ segment not rendered in the meta line. */
  sentiment?: number;
  reviewCount?: number;
  verifiedAgo: string;
  stale?: boolean;
  staleDays?: number;
  lastRunFailed?: { at: string; reason: string };
  /** The what-changed prose. */
  summary: string;
  /** Leads the what-changed prose with the NEW tag until the Object is opened. */
  changeUnseen?: boolean;
  /** ≥ 1 — the change records' sources; the prose never renders uncited. */
  changeEvidence: readonly EvidenceRef[];
  theyBeatYouOn: readonly string[];
  youBeatThemOn: readonly string[];
  /** Sections materialise only when populated — each absent when its field is. */
  featureCoverage?: FeatureCoverage;
  reviewEvidence?: ReviewEvidence;
  sources?: readonly SourceRow[];
  /**
   * Live-API sections (server detail view). The server sends no
   * theyBeatYouOn/youBeatThemOn — differentiators carry provenance instead.
   */
  differentiators?: readonly CitedDifferentiator[];
  keyFeatureList?: readonly CitedFeature[];
  marketList?: readonly CitedMarket[];
  changes?: readonly ObjectChange[];
  openThread: DeepDiveThread | null;
  filedThreads: readonly FiledThreadRef[];
}

// ---------------------------------------------------------------------------
// Status footer
// ---------------------------------------------------------------------------

export interface FooterStatus {
  /** e.g. "Local · 42 MB on disk" or "Local · nothing sent anywhere". */
  local: string;
  /** e.g. "Agents idle · next run 21:00". Absent on day one. */
  agents?: string;
  /** Agents are working right now — the segment gains the pulsing green dot. */
  agentsLive?: boolean;
  /** e.g. "MCP serving :7317". Absent on day one. */
  mcp?: string;
  /** "MCP · not serving" — destructive-quiet tone (connections-spec 6.3). */
  mcpFailed?: boolean;
  offline: string;
  /** e.g. "Licence to 14 Mar 2027" or "Trial · 9 days left". Absent on day one. */
  licence?: string;
  /** Trial at ≤ 3 days or licence expiry ≤ 30 days away (settings spec 6.1/6.2). */
  licenceAmber?: boolean;
}

// ---------------------------------------------------------------------------
// Settings — LLM keys (settings-spec Appendix A)
// ---------------------------------------------------------------------------

export type ProviderId =
  | "anthropic"
  | "openai"
  | "google"
  | "perplexity"
  | "openrouter";

export interface LlmKeyRow {
  provider: ProviderId;
  /** Renders the WEB SEARCH tag. */
  webSearch: boolean;
  saved?: {
    /** e.g. "sk-ant-…R4kQ" — the ONLY form the server ever returns. */
    mask: string;
    /** Absent when the server holds no added-on record (live contract gap). */
    addedAt?: string;
    /** Absent ⇒ segment not rendered — no dash, no "never". */
    lastUsedAgo?: string;
    /** false ⇒ key line reads "saved · not yet verified". */
    verified: boolean;
  };
  testing?: { elapsedS: number };
  /**
   * Honesty rule (spec 2.4): "couldn't reach / wasn't checked" is ONLY for
   * network/timeout. A provider that answered with an error was reached —
   * that is "provider-error", never "unreachable".
   */
  testResult?:
    | { kind: "works"; answeredInS: number }
    | { kind: "invalid" } // the provider rejected the key
    | { kind: "unreachable" } // network/timeout — NO verdict on the key
    // Reached; answered with an error. `detail` is the sanitised provider
    // snippet (mono); `line` the server's full sentence when no detail.
    | { kind: "provider-error"; detail?: string; line?: string }
    | { kind: "rate-limited"; line?: string }; // reached; check refused for now
}

// ---------------------------------------------------------------------------
// Settings — agent schedules (settings-spec part 3)
// ---------------------------------------------------------------------------

/**
 * The server contract's frequency vocabulary (authoritative over the spec's
 * Appendix-A type): per-agent pause is expressed as "off". "after-gathering"
 * is a client-side rendering of the theme-aggregation row's coupling and is
 * never editable.
 */
export type AgentFrequency =
  | "daily"
  | "every-3-days"
  | "weekly"
  | "fortnightly"
  | "monthly"
  | "off"
  | "after-gathering";

export interface AgentScheduleRow {
  /** The server slug — stable identity for PUT round-trips. */
  id: string;
  /** Named by the job, never the slug. */
  name: string;
  /** Gates the row: only rows of enabled modules render ("always" always does). */
  module: ModuleId | "always";
  description: string;
  /** "off" ⇒ this row alone is paused (block-level pause lives on `pausedAll`). */
  frequency: AgentFrequency;
  /** What "Resume" restores after a per-agent pause set frequency "off". */
  pausedFrom?: Exclude<AgentFrequency, "off">;
  /** Roadmap review only — weekly day + time. */
  weeklyAt?: { day: string; time: string };
  /** Display stamp, e.g. "Thu 09:00", "21:00", "12 Aug". Absent ⇒ no stamp. */
  nextRun?: string;
  /** Epoch ms behind nextRun — lets the lede/footer pick the earliest run. */
  nextRunSortKey?: number;
  running?: { elapsedS: number };
  lastRun?: {
    at: string;
    /** Absent ⇒ no findings fragment; 0 renders "nothing changed". */
    findings?: number;
    failed?: { reason: string };
  };
  /** false for per-object agents — the scheduler owns the set (spec 3.2). */
  runNow: boolean;
}

// ---------------------------------------------------------------------------
// Settings — licence (settings-spec part 6)
// ---------------------------------------------------------------------------

export type LicenceState =
  | { kind: "trial"; daysLeft: number }
  | {
      kind: "licensed";
      email: string;
      expires: string;
      keyMask: string;
      /** e.g. "3 Aug 2026" — the key row's provenance stamp. */
      enteredOn?: string;
      /** Expiry ≤ 30 days away — amber date + renew clause. */
      renewalDue: boolean;
    }
  | { kind: "readingOnly"; endedOn: string; reason: "trial" | "expired" };

/** Inline result of a key-entry attempt (settings-spec 6.4). */
export type LicenceNotice =
  | { kind: "valid"; expires: string }
  | { kind: "malformed" }
  | { kind: "invalid" }
  | { kind: "expired"; expiredOn: string };

// ---------------------------------------------------------------------------
// Settings — about & your data (settings-spec part 7)
// ---------------------------------------------------------------------------

export interface AboutInfo {
  dataDir: string;
  /** Same source of truth as the footer's "Local · 42 MB on disk" segment. */
  dbSizeOnDisk: string;
  version: string;
  /** Absent ⇒ no update machinery on this seam yet: version renders alone. */
  updateState?: "current" | "ready" | { failedAt: string };
  /** The reveal-in-file-manager seam exists (mock harness only, for now). */
  canReveal?: boolean;
}

// ---------------------------------------------------------------------------
// Settings — page state (settings-spec parts 1–7)
// ---------------------------------------------------------------------------

/** The Connections block's live summary (settings-spec part 4 — stub). */
export interface SettingsConnectionsSummary {
  /** AI tools consuming context over MCP. Empty ⇒ invitation line. */
  serving: readonly { name: string; queriesThisWeek: number }[];
  /** Data tools being polled. */
  checking: readonly { name: string; cadence: string; polledAgo: string }[];
}

export interface SettingsState {
  llmKeys: readonly LlmKeyRow[];
  schedules: {
    pausedAll: boolean;
    /** All known rows — the page filters by enabled modules (gating §0.2). */
    rows: readonly AgentScheduleRow[];
  };
  /**
   * Seams the fixed live contract does not carry yet. Controls render only
   * where their seam exists — no dead controls (mock: all true).
   */
  capabilities: {
    runNow: boolean;
    perAgentPause: boolean;
    editWeeklyAt: boolean;
  };
  connections: SettingsConnectionsSummary;
  licence: LicenceState;
  licenceNotice?: LicenceNotice;
  about: AboutInfo | null;
}

// ---------------------------------------------------------------------------
// Top-level app state
// ---------------------------------------------------------------------------

export type Scenario = "briefing" | "day-one";

/**
 * Dev mock scenarios reachable via `?state=` — each makes a spec state
 * inspectable without server wiring.
 */
export type MockScenarioKey =
  | "briefing"
  | "day-one"
  | "proposals"
  | "many"
  | "quiet"
  | "checking"
  | "no-search-key"
  | "no-llm-key"
  | "multi-product"
  | "settings-trial"
  | "settings-trial-ending"
  | "settings-reading-only"
  | "settings-paused"
  | "settings-minimal"
  // Customers module scenarios. The populated dataset already carries the
  // rich/forming/fading themes, unfiled pool, thin-evidence persona,
  // owner-provided segment, undated mined item and old-dated review states.
  | "customers-day-one"
  | "customers-proposals"
  | "customers-adoption"
  // Connections scenarios (connections-spec Part 7): the populated state
  // carries connected/waiting/unconfigured rows, readers, a write attempt
  // and the checking block; the rest make each state inspectable.
  | "connections-day-one"
  | "connections-aged"
  | "connections-degraded"
  | "connections-arrivals";

export interface AppState {
  productName: string;
  /**
   * The organisation's products. The top-bar switcher renders only when
   * there is more than one — single-product stays the common case and its
   * chrome is untouched.
   */
  products: readonly ProductRef[];
  /** Submit state of the "add another product" prompt. */
  productCreate: ProductCreateState;
  scenario: Scenario;
  /** Which mock dataset produced this state (dev affordance only). */
  mockScenario: MockScenarioKey;
  modules: Record<ModuleId, ModuleState>;
  footer: FooterStatus;
  home: HomeBriefing | null;
  dayOne: DayOnePrompt | null;
  competitorsOverview: CompetitorsOverview | null;
  /** Objects by stable ID. */
  competitors: Readonly<Record<string, CompetitorObject>>;
  competitorAddFlow: AddFlowState;
  /** Onboarding-deferred proposals for the day-one variant (spec 2.5). */
  onboardingProposals: readonly OnboardingCompetitorProposal[] | null;
  // Customers module (customers-module-spec)
  customersOverview: CustomersOverview | null;
  /** Theme Objects by stable ID. */
  themes: Readonly<Record<string, ThemeObject>>;
  /** Segment Objects by facet ID. */
  segments: Readonly<Record<string, SegmentObject>>;
  feedbackFlow: LogFeedbackState;
  /** Theme/segment ids with a live refresh run — drives the elapsed stamps. */
  customersChecking: readonly { id: string; elapsedS: number }[];
  /** Onboarding-proposed segments for the day-one variant (spec 2.4). */
  segmentProposals: readonly OnboardingCompetitorProposal[] | null;
  /** An adoption card awaiting review (spec 3.4). */
  segmentAdoption: SegmentAdoptionProposal | null;
  // Connections (connections-spec)
  connections: ConnectionsOverview | null;
  /** §4a arrivals awaiting review — surfaced in their owning modules. */
  arrivals: readonly McpArrivalCard[];
  /** Transient "Set up automatically" outcome for the Claude row. */
  claudeSetup: ClaudeSetupResult | null;
  /** Settings page state — null until the live provider has loaded it. */
  settings: SettingsState | null;
  /** No LLM key at all — agents paused globally (spec 5.3). */
  agentsPaused: boolean;
  /** Row/object whose stamp just settled — drives the 600 ms tint fade. */
  justVerifiedId: string | null;
}
