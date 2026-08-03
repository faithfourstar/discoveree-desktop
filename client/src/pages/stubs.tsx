import { EmptyState } from "@/components/EmptyState";

/**
 * Placeholder routes for modules not yet built. One line each, phrased as
 * an invitation — the first step of a job, never an apology.
 */

export function CustomersPage() {
  return (
    <EmptyState line="Point Discoveree at your feedback and it will gather the themes here." />
  );
}

export function StrategyPage() {
  return (
    <EmptyState line="Define your vision — everything else hangs off it." />
  );
}

export function RoadmapPage() {
  return (
    <EmptyState line="Connect Jira or Linear — or paste a list — and your weekly review will land here." />
  );
}

export function ConnectionsPage() {
  return (
    <EmptyState line="Your AI tools and data tools connect here — most take under a minute." />
  );
}

export function SettingsPage() {
  return (
    <EmptyState line="LLM keys, connections, agent schedules and your licence live here." />
  );
}

export function NotFoundPage() {
  return (
    <EmptyState line="Nothing lives at this address — head back home and try again." />
  );
}
