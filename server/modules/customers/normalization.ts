/**
 * Segment name normalisation — ported WHOLE from the SaaS
 * segmentNormalization.ts (314 lines) per ADR 004 §5, minus
 * isNearDuplicateText/mergeDifferentiators (→ lib/text.ts, the ADR 002 §5
 * TODO fulfilled). `normalizeSegmentName` is the `segment_entities`
 * normalizedName dedup key ADR 003 §2.6 reserved it for.
 */

const SYNONYM_MAP: Record<string, string> = {
  'businesses': 'companies',
  'business': 'company',
  'firms': 'companies',
  'firm': 'company',
  'organizations': 'companies',
  'organisation': 'company',
  'organisations': 'companies',
  'smbs': 'small companies',
  'smb': 'small companies',
  'smes': 'small companies',
  'sme': 'small companies',
  'startups': 'startup companies',
  'start ups': 'startup companies',
  'start-ups': 'startup companies',
  'mid market': 'midmarket',
  'mid-market': 'midmarket',
  'ecommerce': 'e commerce',
  'e-commerce': 'e commerce',
  'saas': 'software as a service',
  'b2b': 'business to business',
  'b2c': 'business to consumer',
  'devops': 'development operations',
  'dev ops': 'development operations',
  'it': 'information technology',
  'hr': 'human resources',
  'fintech': 'financial technology',
  'edtech': 'education technology',
  'healthtech': 'health technology',
  'medtech': 'medical technology',
  'martech': 'marketing technology',
  'proptech': 'property technology',
  'ai native': 'ai first',
  'ai-native': 'ai first',
};

export function normalizeSegmentName(name: string): string {
  let normalized = name.toLowerCase().trim();

  normalized = normalized.replace(/[-_/\\]/g, ' ');

  normalized = normalized.replace(/[^a-z0-9\s]/g, '');

  normalized = normalized.replace(/\s+/g, ' ').trim();

  const sortedKeys = Object.keys(SYNONYM_MAP).sort((a, b) => b.length - a.length);
  for (const key of sortedKeys) {
    const regex = new RegExp(`\\b${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
    normalized = normalized.replace(regex, SYNONYM_MAP[key]!);
  }

  normalized = normalized.replace(/\s+/g, ' ').trim();

  return normalized;
}

/**
 * Stem a single lowercase word by stripping common English suffixes.
 * Applied after normalizeSegmentName so input is already lowercased and clean.
 */
function stemWord(word: string): string {
  if (word.length <= 4) return word;
  // Longer suffixes first to avoid partial stripping
  if (word.endsWith('ionals')) return word.slice(0, -6);
  if (word.endsWith('ional')) return word.slice(0, -5);
  if (word.endsWith('ances')) return word.slice(0, -5);
  if (word.endsWith('ences')) return word.slice(0, -5);
  if (word.endsWith('ance')) return word.slice(0, -4);
  if (word.endsWith('ence')) return word.slice(0, -4);
  if (word.endsWith('ians')) return word.slice(0, -4);
  if (word.endsWith('ists')) return word.slice(0, -4);
  if (word.endsWith('ing')) return word.slice(0, -3);
  if (word.endsWith('ers')) return word.slice(0, -3);
  if (word.endsWith('ors')) return word.slice(0, -3);
  if (word.endsWith('ian')) return word.slice(0, -3);
  if (word.endsWith('ist')) return word.slice(0, -3);
  if (word.endsWith('ies') && word.length > 5) return word.slice(0, -3) + 'y';
  if (word.endsWith('es') && word.length > 5) return word.slice(0, -2);
  if (word.endsWith('s') && word.length > 4) return word.slice(0, -1);
  return word;
}

/**
 * Return the stemmed word tokens for a segment name, used for fuzzy matching.
 */
function stemmedTokens(name: string): string[] {
  return normalizeSegmentName(name).split(' ').filter(Boolean).map(stemWord);
}

/**
 * Returns true when two segment names match after stemming.
 * Catches variants like "Health Insurance" ↔ "Health Insurers",
 * "Healthcare Provider" ↔ "Healthcare Providers".
 */
function stemmedNamesMatch(a: string, b: string): boolean {
  const tokA = stemmedTokens(a);
  const tokB = stemmedTokens(b);
  if (tokA.length === 0 || tokB.length === 0) return false;

  const setA = new Set(tokA);
  const setB = new Set(tokB);

  // Jaccard-like: intersection / union >= 0.8 counts as a match
  const intersectionCount = tokA.filter(w => setB.has(w)).length;
  const unionCount = new Set([...tokA, ...tokB]).size;
  if (unionCount > 0 && intersectionCount / unionCount >= 0.8) return true;

  // All tokens from the shorter name appear in the longer name (subset match)
  const shorter = tokA.length <= tokB.length ? tokA : tokB;
  const longerSet = tokA.length <= tokB.length ? setB : setA;
  if (shorter.length >= 1 && shorter.every(w => longerSet.has(w))) return true;

  return false;
}

export function segmentNamesMatch(a: string, b: string): boolean {
  const normA = normalizeSegmentName(a);
  const normB = normalizeSegmentName(b);

  if (normA === normB) return true;

  const wordsA = normA.split(' ').sort();
  const wordsB = normB.split(' ').sort();
  if (wordsA.length > 1 && wordsB.length > 1 && wordsA.join(' ') === wordsB.join(' ')) return true;

  const shorter = normA.length <= normB.length ? normA : normB;
  const longer = normA.length <= normB.length ? normB : normA;
  const shorterWords = shorter.split(' ');
  const longerWords = longer.split(' ');

  if (shorterWords.length >= 1 && longerWords.length >= 1) {
    const allShorterWordsInLonger = shorterWords.every(w => longerWords.includes(w));
    if (allShorterWordsInLonger) return true;
  }

  // Stemming-aware comparison catches plural/suffix variants
  if (stemmedNamesMatch(a, b)) return true;

  return false;
}

export function findMatchingSegment<T extends { segmentName: string }>(
  newName: string,
  existingSegments: T[],
): T | undefined {
  for (const existing of existingSegments) {
    if (segmentNamesMatch(newName, existing.segmentName)) {
      return existing;
    }
  }
  return undefined;
}

export function groupDuplicateSegments<T extends { segmentName: string; id: string }>(
  segments: T[],
): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  const assigned = new Set<string>();

  for (let i = 0; i < segments.length; i++) {
    if (assigned.has(segments[i]!.id)) continue;

    const group: T[] = [segments[i]!];
    assigned.add(segments[i]!.id);

    for (let j = i + 1; j < segments.length; j++) {
      if (assigned.has(segments[j]!.id)) continue;
      if (segmentNamesMatch(segments[i]!.segmentName, segments[j]!.segmentName)) {
        group.push(segments[j]!);
        assigned.add(segments[j]!.id);
      }
    }

    const canonical = normalizeSegmentName(segments[i]!.segmentName);
    const existingGroup = groups.get(canonical);
    if (existingGroup) {
      existingGroup.push(...group);
    } else {
      groups.set(canonical, group);
    }
  }

  return groups;
}

/**
 * Maximum number of customer segments stored per product.
 */
export const MAX_SEGMENTS = 15;
