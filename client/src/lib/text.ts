/**
 * Copy helpers. Unit words agree with their counts everywhere — "1 review",
 * "2 reviews" — the same singular/plural discipline as the lede ladder.
 */
export function countNoun(
  count: number,
  singular: string,
  plural = `${singular}s`,
): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
