/**
 * localStorage keys for per-product client preferences. Keyed by product id
 * (ADR 003) so switching products never bleeds view state or seen-change
 * (NEW-tag) state across datasets.
 */

export function competitorsViewKey(productId: string): string {
  return `discoveree.${productId}.competitors.view`;
}

export function competitorsSeenChangesKey(productId: string): string {
  return `discoveree.${productId}.competitors.seenChanges`;
}

export function customersSeenEntriesKey(productId: string): string {
  return `discoveree.${productId}.customers.seenEntries`;
}
