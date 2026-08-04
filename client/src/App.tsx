import { useEffect } from "react";
import { Route, Switch, useLocation, useSearch } from "wouter";
import { AppShell } from "@/components/shell/AppShell";
import { parseProductId, productBase } from "@/lib/productUrl";
import { AddProductPage } from "@/pages/AddProductPage";
import { CompetitorObjectPage } from "@/pages/CompetitorObjectPage";
import { CompetitorsOverviewPage } from "@/pages/CompetitorsOverviewPage";
import { HomePage } from "@/pages/HomePage";
import { SettingsPage } from "@/pages/SettingsPage";
import {
  ConnectionsPage,
  CustomersPage,
  NotFoundPage,
  RoadmapPage,
  SourcesPage,
  StrategyPage,
} from "@/pages/stubs";
import { AppStateProvider, useAppState } from "@/state/AppStateContext";

/**
 * URL guard for the product dimension (ADR 003 §1.2): module routes live
 * under /p/:productId. Bare paths are prefixed with the first product, and
 * a stale product id falls back to the first product. The query string is
 * preserved (it carries the mock harness's ?state= switch).
 */
function ProductUrlGuard() {
  const { products } = useAppState();
  const [location, navigate] = useLocation();
  const search = useSearch();

  useEffect(() => {
    const first = products[0];
    if (!first || location.startsWith("/products/new")) {
      return;
    }
    const qs = search ? `?${search}` : "";
    const productId = parseProductId(location);
    if (!productId) {
      const target =
        location === "/"
          ? productBase(first.id)
          : `${productBase(first.id)}${location}`;
      navigate(`${target}${qs}`, { replace: true });
      return;
    }
    if (!products.some((product) => product.id === productId)) {
      navigate(`${productBase(first.id)}${qs}`, { replace: true });
    }
  }, [products, location, search, navigate]);

  return null;
}

export function App() {
  return (
    <AppStateProvider>
      <ProductUrlGuard />
      <AppShell>
        <Switch>
          <Route path="/" component={HomePage} />
          <Route path="/products/new" component={AddProductPage} />
          <Route path="/p/:productId" component={HomePage} />
          <Route
            path="/p/:productId/competitors"
            component={CompetitorsOverviewPage}
          />
          <Route
            path="/p/:productId/competitors/:id"
            component={CompetitorObjectPage}
          />
          <Route path="/p/:productId/customers" component={CustomersPage} />
          <Route path="/p/:productId/strategy" component={StrategyPage} />
          <Route path="/p/:productId/roadmap" component={RoadmapPage} />
          <Route
            path="/p/:productId/connections"
            component={ConnectionsPage}
          />
          <Route path="/p/:productId/settings" component={SettingsPage} />
          <Route path="/p/:productId/sources" component={SourcesPage} />
          <Route component={NotFoundPage} />
        </Switch>
      </AppShell>
    </AppStateProvider>
  );
}
