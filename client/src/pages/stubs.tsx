import { EmptyState } from "@/components/EmptyState";

/**
 * Placeholder routes for modules not yet built. One line each, phrased as
 * an invitation — the first step of a job, never an apology.
 */

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

export function SourcesPage() {
  return (
    <EmptyState line="Everything agents believe, and why — sources land here as agents cite them." />
  );
}

export function NotFoundPage() {
  return (
    <EmptyState line="Nothing lives at this address — head back home and try again." />
  );
}
