import { createContext, useContext, type ReactNode } from "react";
import { briefingState } from "@/mock/data";
import type {
  AgentFrequency,
  AppState,
  ModuleId,
  ProviderId,
  ThreatWord,
} from "@/mock/types";

/**
 * The provider seam: one state shape + one actions interface, served by two
 * interchangeable providers — the mock harness (`?state=` dev switch) and the
 * live API provider. Components only ever see these contexts.
 */

export interface AppActions {
  // Overview
  setCompetitorsView(view: "cards" | "table"): void;
  toggleCompetitorsView(): void;
  checkCompetitor(id: string): void;
  markCompetitorSeen(id: string): void;
  /** Live mode fetches the detail projection on demand; mock is a no-op. */
  ensureCompetitorDetail(id: string): void;
  // Object housekeeping
  setCompetitorClassification(id: string, value: "DIRECT" | "ADJACENT"): void;
  setCompetitorThreat(id: string, value: ThreatWord): void;
  stopTracking(id: string): void;
  // Add flow
  openAddFlow(): void;
  closeAddFlow(): void;
  setAddFlowMode(mode: "url" | "name"): void;
  setAddFlowDraft(draft: string): void;
  researchCompetitor(): void;
  retryResearch(): void;
  researchByNameInstead(): void;
  startManualEntry(): void;
  saveManualCompetitor(input: {
    name: string;
    description?: string;
    url?: string;
  }): void;
  setProposalName(name: string): void;
  /** Persist the inline rename when the edit commits (blur/Enter). */
  commitProposalName(): void;
  toggleProposalClassification(): void;
  acceptProposal(): void;
  discardProposal(): void;
  /** Live mode: resume an orphaned proposed row surfaced on flow open. */
  resumeProposal(): void;
  trackOnboardingProposals(ids: readonly string[]): void;
  // Products (ADR 003)
  /**
   * "Add another product" — day-one-style URL prompt. Creates the product
   * and navigates into it; progress and errors surface via
   * `state.productCreate`.
   */
  createProduct(input: { url: string }): void;
  // Settings — LLM keys (settings-spec part 2)
  /** "Save and test": stores the key, then runs the same live test. */
  saveLlmKey(provider: ProviderId, key: string): void;
  /** "Test" on a saved key — one lightweight live call, elapsed counter. */
  testLlmKey(provider: ProviderId): void;
  removeLlmKey(provider: ProviderId): void;
  /** Clears an in-row test verdict (e.g. when Replace opens the entry). */
  clearKeyTestResult(provider: ProviderId): void;
  // Settings — agent schedules (settings-spec part 3)
  setAgentFrequency(id: string, frequency: AgentFrequency): void;
  setAgentWeeklyAt(id: string, weeklyAt: { day: string; time: string }): void;
  setAllAgentsPaused(paused: boolean): void;
  setAgentPaused(id: string, paused: boolean): void;
  /** Set-level agents only; also serves "Try again" on a failed run. */
  runAgentNow(id: string): void;
  // Settings — add capabilities, licence, about
  enableModule(id: ModuleId): void;
  activateLicenceKey(key: string): void;
  clearLicenceNotice(): void;
  checkForUpdates(): void;
}

const noop = () => undefined;

export const defaultActions: AppActions = {
  setCompetitorsView: noop,
  toggleCompetitorsView: noop,
  checkCompetitor: noop,
  markCompetitorSeen: noop,
  ensureCompetitorDetail: noop,
  setCompetitorClassification: noop,
  setCompetitorThreat: noop,
  stopTracking: noop,
  openAddFlow: noop,
  closeAddFlow: noop,
  setAddFlowMode: noop,
  setAddFlowDraft: noop,
  researchCompetitor: noop,
  retryResearch: noop,
  researchByNameInstead: noop,
  startManualEntry: noop,
  saveManualCompetitor: noop,
  setProposalName: noop,
  commitProposalName: noop,
  toggleProposalClassification: noop,
  acceptProposal: noop,
  discardProposal: noop,
  resumeProposal: noop,
  trackOnboardingProposals: noop,
  createProduct: noop,
  saveLlmKey: noop,
  testLlmKey: noop,
  removeLlmKey: noop,
  clearKeyTestResult: noop,
  setAgentFrequency: noop,
  setAgentWeeklyAt: noop,
  setAllAgentsPaused: noop,
  setAgentPaused: noop,
  runAgentNow: noop,
  enableModule: noop,
  activateLicenceKey: noop,
  clearLicenceNotice: noop,
  checkForUpdates: noop,
};

const AppStateContext = createContext<AppState>(briefingState);
const AppActionsContext = createContext<AppActions>(defaultActions);

/** Renders both context providers — used by each provider implementation. */
export function AppStateBridge({
  state,
  actions,
  children,
}: {
  state: AppState;
  actions: AppActions;
  children: ReactNode;
}) {
  return (
    <AppStateContext.Provider value={state}>
      <AppActionsContext.Provider value={actions}>
        {children}
      </AppActionsContext.Provider>
    </AppStateContext.Provider>
  );
}

export function useAppState(): AppState {
  return useContext(AppStateContext);
}

export function useAppActions(): AppActions {
  return useContext(AppActionsContext);
}
