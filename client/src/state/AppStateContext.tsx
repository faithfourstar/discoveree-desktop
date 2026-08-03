import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useSearch } from "wouter";
import { briefingState, dayOneState } from "@/mock/data";
import type { AppState } from "@/mock/types";

/**
 * Serves the current app state to the shell and pages. Today it selects
 * between mock datasets; the server wiring later replaces this provider's
 * data source without touching any component.
 *
 * Dev affordance: `?state=day-one` switches to the day-one dataset,
 * `?state=briefing` switches back. The choice is sticky across navigation.
 */

const AppStateContext = createContext<AppState>(briefingState);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const search = useSearch();
  const requested = new URLSearchParams(search).get("state");
  const [state, setState] = useState<AppState>(briefingState);

  useEffect(() => {
    if (requested === "day-one") {
      setState(dayOneState);
    } else if (requested === "briefing") {
      setState(briefingState);
    }
  }, [requested]);

  return (
    <AppStateContext.Provider value={state}>
      {children}
    </AppStateContext.Provider>
  );
}

export function useAppState(): AppState {
  return useContext(AppStateContext);
}
