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
  /** "link" renders teal; "stale" renders the amber staleness underline. */
  tone?: "link" | "stale";
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

export interface CompetitorObject {
  id: string;
  name: string;
  classification: "DIRECT" | "ADJACENT" | "ASPIRATIONAL";
  domain: string;
  sentiment: number;
  reviewCount: number;
  verifiedAgo: string;
  summary: string;
  theyBeatYouOn: readonly string[];
  youBeatThemOn: readonly string[];
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

export interface AppState {
  productName: string;
  scenario: Scenario;
  modules: Record<ModuleId, ModuleState>;
  footer: FooterStatus;
  home: HomeBriefing | null;
  dayOne: DayOnePrompt | null;
  competitor: CompetitorObject | null;
}
