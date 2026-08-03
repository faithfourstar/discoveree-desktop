import { createContext, useContext, type ReactNode } from "react";
import { briefingState } from "@/mock/data";
import type { AppState, ThreatWord } from "@/mock/types";

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
