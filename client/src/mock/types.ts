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
}

export interface ServingSummary {
  consumers: readonly ServingConsumer[];
  teammatesReading: number;
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
  offline: string;
  /** e.g. "Licence to 14 Mar 2027". Absent on day one. */
  licence?: string;
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
  | "no-llm-key";

export interface AppState {
  productName: string;
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
  /** No LLM key at all — agents paused globally (spec 5.3). */
  agentsPaused: boolean;
  /** Row/object whose stamp just settled — drives the 600 ms tint fade. */
  justVerifiedId: string | null;
}
