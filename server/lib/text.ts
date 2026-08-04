/**
 * Shared free-text near-duplicate helpers — re-homed from the SaaS
 * segmentNormalization.ts:266–297 (ADR 004 §4/§5; this fulfils the
 * ADR 002 §5 `TODO(sprint-3)` — the competitors service's inlined copy is
 * deleted in favour of this module).
 */

/**
 * True when two free-text bullet points (e.g. key differentiators) make the same
 * point in different words. Compares token overlap after stripping citation
 * markers ([1][5]) and punctuation; 70%+ overlap of the smaller set counts as a
 * duplicate ("All-in-one spend management incl. cards, travel, reimbursements"
 * vs "Broader all-in-one spend management suite with travel and cards").
 */
export function isNearDuplicateText(a: string, b: string): boolean {
  const tokens = (t: string) => new Set(
    t.toLowerCase()
      .replace(/\[\d+\]/g, " ")
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(w => w.length > 2),
  );
  const ta = tokens(a), tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return a.toLowerCase().trim() === b.toLowerCase().trim();
  let shared = 0;
  ta.forEach(w => { if (tb.has(w)) shared++; });
  return shared / Math.min(ta.size, tb.size) >= 0.7;
}

/**
 * Merge new differentiator bullets into an existing list, dropping near-duplicate
 * paraphrases. Also self-heals: duplicates already present in `existing` collapse.
 */
export function mergeDifferentiators(existing: string[], incoming: string[]): string[] {
  const merged: string[] = [];
  for (const d of [...existing, ...incoming]) {
    if (d && !merged.some(kept => isNearDuplicateText(kept, d))) merged.push(d);
  }
  return merged;
}
