import { Route, Switch } from "wouter";
import { AppShell } from "@/components/shell/AppShell";
import { CompetitorObjectPage } from "@/pages/CompetitorObjectPage";
import { CompetitorsOverviewPage } from "@/pages/CompetitorsOverviewPage";
import { HomePage } from "@/pages/HomePage";
import {
  ConnectionsPage,
  CustomersPage,
  NotFoundPage,
  RoadmapPage,
  SettingsPage,
  StrategyPage,
} from "@/pages/stubs";
import { AppStateProvider } from "@/state/AppStateContext";

export function App() {
  return (
    <AppStateProvider>
      <AppShell>
        <Switch>
          <Route path="/" component={HomePage} />
          <Route path="/competitors" component={CompetitorsOverviewPage} />
          <Route path="/competitors/:id" component={CompetitorObjectPage} />
          <Route path="/customers" component={CustomersPage} />
          <Route path="/strategy" component={StrategyPage} />
          <Route path="/roadmap" component={RoadmapPage} />
          <Route path="/connections" component={ConnectionsPage} />
          <Route path="/settings" component={SettingsPage} />
          <Route component={NotFoundPage} />
        </Switch>
      </AppShell>
    </AppStateProvider>
  );
}
