/**
 * Product-release source discovery — ported from the SaaS gemini.ts
 * 8661–8889 (`buildProductReleaseSources` + `probeProductReleaseSources`).
 *
 * Deterministic maintenance (brief §10a.2): candidate changelog/release URLs
 * are probed once and cached on the profile (`validReleaseSources`) so
 * scheduled re-runs are cheap.
 */
import { validateUrlWithSoft404Detection } from "../../../lib/web/fetch.js";

export interface ReleaseSourceCompetitor {
  name: string;
  url?: string;
  helpCenterUrl?: string;
}

/**
 * Builds a list of structured product-release source URLs to probe before falling
 * back to open web search. Covers changelog, release notes, blog/product pages,
 * GitHub releases (if a github.com URL is known), and help-centre "what's new"
 * patterns. Returns an empty array when no domain can be derived.
 */
export function buildProductReleaseSources(competitor: ReleaseSourceCompetitor): string[] {
  const sources: string[] = [];
  let baseDomain = "";

  if (competitor.url) {
    try {
      baseDomain = new URL(competitor.url.startsWith("http") ? competitor.url : `https://${competitor.url}`).hostname;
    } catch { /* noop */ }
  }

  if (baseDomain) {
    // Canonical release paths — checked in priority order
    const releasePaths = [
      "/changelog",
      "/release-notes",
      "/releases",
      "/blog/product",
      "/blog/product-updates",
      "/whats-new",
      "/what-s-new",
      "/updates",
      "/product-updates",
    ];
    for (const p of releasePaths) {
      sources.push(`https://${baseDomain}${p}`);
    }
    // Also suggest site: search
    sources.push(`site:${baseDomain} changelog OR "release notes" OR "product update" OR "what's new"`);
  }

  // GitHub releases — either the domain IS github.com/... or we search for it
  if (competitor.url && competitor.url.includes("github.com")) {
    try {
      const ghUrl = new URL(competitor.url.startsWith("http") ? competitor.url : `https://${competitor.url}`);
      // e.g. github.com/org/repo → github.com/org/repo/releases
      sources.push(`${ghUrl.origin}${ghUrl.pathname.replace(/\/$/, "")}/releases`);
    } catch { /* noop */ }
  } else if (baseDomain) {
    sources.push(`site:github.com "${competitor.name}" releases`);
  }

  // Help centre "what's new" patterns
  if (competitor.helpCenterUrl) {
    try {
      const hcDomain = new URL(competitor.helpCenterUrl).hostname;
      sources.push(`site:${hcDomain} "what's new" OR "new features" OR "release" OR "changelog"`);
    } catch { /* noop */ }
  } else if (baseDomain) {
    const hcPaths = ["/help", "/docs", "/support", "/knowledge-base"];
    for (const p of hcPaths) {
      sources.push(`site:${baseDomain}${p} "what's new" OR "new features" OR "release"`);
    }
  }

  return sources;
}

/**
 * Probes candidate product-release source URLs for a single competitor and returns
 * only the ones that actually respond (no soft-404, no timeout).
 *
 * Exported so the scheduler can call it before a product-signals scan run and
 * persist the results to competitor_profiles.validReleaseSources.
 */
export async function probeProductReleaseSources(
  competitor: ReleaseSourceCompetitor,
  timeoutMs = 4000,
): Promise<string[]> {
  const candidates = buildProductReleaseSources(competitor)
    // Only probe actual https:// URLs — skip site: search strings
    .filter(s => s.startsWith("https://"));

  if (candidates.length === 0) return [];

  console.log(`[ReleaseSourceProbe] Probing ${candidates.length} candidate URLs for ${competitor.name}`);

  const results = await Promise.allSettled(
    candidates.map(async url => {
      const valid = await validateUrlWithSoft404Detection(url, timeoutMs);
      return valid ? url : null;
    }),
  );

  const confirmed = results
    .filter((r): r is PromiseFulfilledResult<string> => r.status === "fulfilled" && r.value !== null)
    .map(r => r.value);

  console.log(`[ReleaseSourceProbe] ${competitor.name}: ${confirmed.length}/${candidates.length} URLs confirmed valid`);
  return confirmed;
}
