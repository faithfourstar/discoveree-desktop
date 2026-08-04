/**
 * Centralized Sentiment Utilities
 * Single source of truth for all sentiment scoring across the application.
 * 
 * Scale: 0-100 (higher = more positive)
 * - 0-20: Very Negative
 * - 21-40: Negative
 * - 41-60: Neutral
 * - 61-80: Positive
 * - 81-100: Very Positive
 */

export const SENTIMENT_SCALE = {
  MIN: 0,
  MAX: 100,
  VERY_NEGATIVE_MAX: 20,
  NEGATIVE_MAX: 40,
  NEUTRAL_MAX: 60,
  POSITIVE_MAX: 80,
} as const;

export type SentimentColor = "pastel_red" | "pastel_orange" | "pastel_yellow" | "pastel_green" | "pastel_blue";

export type EntityType = "product" | "competitor" | "adjacent_product" | "feature" | "other";

export interface EntitySentiment {
  name: string;
  type: EntityType;
  score: number;
  evidence?: string[];
}

export interface TopicSentiment {
  topic: string;
  score: number;
  evidence?: string[];
}

export interface StructuredSentiment {
  overallScore: number;
  color: SentimentColor;
  confidence: "high" | "low";
  reason?: string;
  entities: EntitySentiment[];
  topics: TopicSentiment[];
}

export interface SentimentAnalysisResult {
  topics: string[];
  entities: Array<{
    name: string;
    type: EntityType;
  }>;
  sentiment: {
    topic_scores: Array<{ topic: string; score: number }>;
    entity_scores: Array<{ entity: string; score: number }>;
    overall_score: number;
    color: SentimentColor;
  };
  confidence: "high" | "low";
  reason: string;
}

/**
 * Clamp a sentiment score to the valid 0-100 range
 */
export function clampSentiment(score: number): number {
  return Math.max(SENTIMENT_SCALE.MIN, Math.min(SENTIMENT_SCALE.MAX, Math.round(score)));
}

/**
 * Convert a -100 to +100 scale value to the 0-100 scale
 */
export function convertFromLegacyScale(legacyScore: number): number {
  const converted = (legacyScore + 100) / 2;
  return clampSentiment(converted);
}

/**
 * Validate if a score is in the valid 0-100 range
 */
export function isValidSentimentScore(score: number): boolean {
  return typeof score === 'number' && 
         !isNaN(score) && 
         score >= SENTIMENT_SCALE.MIN && 
         score <= SENTIMENT_SCALE.MAX;
}

/**
 * Get the color category based on sentiment score
 */
export function getColorFromScore(score: number): SentimentColor {
  const clampedScore = clampSentiment(score);
  if (clampedScore <= SENTIMENT_SCALE.VERY_NEGATIVE_MAX) return "pastel_red";
  if (clampedScore <= SENTIMENT_SCALE.NEGATIVE_MAX) return "pastel_orange";
  if (clampedScore <= SENTIMENT_SCALE.NEUTRAL_MAX) return "pastel_yellow";
  if (clampedScore <= SENTIMENT_SCALE.POSITIVE_MAX) return "pastel_green";
  return "pastel_blue";
}

/**
 * Get human-readable label for sentiment score
 */
export function getSentimentLabel(score: number): string {
  const clampedScore = clampSentiment(score);
  if (clampedScore <= SENTIMENT_SCALE.VERY_NEGATIVE_MAX) return "Very Negative";
  if (clampedScore <= SENTIMENT_SCALE.NEGATIVE_MAX) return "Negative";
  if (clampedScore <= SENTIMENT_SCALE.NEUTRAL_MAX) return "Neutral";
  if (clampedScore <= SENTIMENT_SCALE.POSITIVE_MAX) return "Positive";
  return "Very Positive";
}

/**
 * Color styles for UI rendering
 * Updated for high visibility with brand-aligned teal/rose palette
 */
export const SENTIMENT_COLOR_STYLES: Record<SentimentColor, { 
  bg: string; 
  text: string; 
  label: string;
  bgLight: string;
  bgDark: string;
}> = {
  pastel_red: { 
    bg: "bg-rose-100 dark:bg-rose-900/40", 
    text: "text-rose-800 dark:text-rose-200",
    label: "Very Negative",
    bgLight: "bg-rose-100",
    bgDark: "bg-rose-900/40"
  },
  pastel_orange: { 
    bg: "bg-amber-100 dark:bg-amber-900/40", 
    text: "text-amber-900 dark:text-amber-200",
    label: "Negative",
    bgLight: "bg-amber-100",
    bgDark: "bg-amber-900/40"
  },
  pastel_yellow: { 
    bg: "bg-slate-100 dark:bg-slate-700/50", 
    text: "text-slate-700 dark:text-slate-200",
    label: "Neutral",
    bgLight: "bg-slate-100",
    bgDark: "bg-slate-700/50"
  },
  pastel_green: { 
    bg: "bg-emerald-100 dark:bg-emerald-900/40", 
    text: "text-emerald-800 dark:text-emerald-200",
    label: "Positive",
    bgLight: "bg-emerald-100",
    bgDark: "bg-emerald-900/40"
  },
  pastel_blue: { 
    bg: "bg-teal-100 dark:bg-teal-900/40", 
    text: "text-teal-800 dark:text-teal-200",
    label: "Very Positive",
    bgLight: "bg-teal-100",
    bgDark: "bg-teal-900/40"
  },
};

/**
 * Get color styles for a given sentiment score
 */
export function getColorStyles(score: number) {
  const color = getColorFromScore(score);
  return SENTIMENT_COLOR_STYLES[color];
}

/**
 * Create a default neutral sentiment result
 */
export function createDefaultSentiment(): StructuredSentiment {
  return {
    overallScore: 50,
    color: "pastel_yellow",
    confidence: "low",
    reason: "No sentiment data available",
    entities: [],
    topics: []
  };
}

/**
 * Sanitize and validate sentiment data from AI responses
 */
export function sanitizeSentimentScore(score: unknown, defaultValue: number = 50): number {
  if (typeof score !== 'number' || isNaN(score)) {
    return defaultValue;
  }
  
  // Check if the score is in legacy -100 to +100 range
  if (score < 0) {
    return convertFromLegacyScale(score);
  }
  
  return clampSentiment(score);
}

/**
 * AI Prompt instructions for consistent sentiment scoring
 * Use this in AI prompts to ensure consistent 0-100 scale usage
 */
export const SENTIMENT_PROMPT_INSTRUCTIONS = `
SENTIMENT SCORING GUIDELINES:
- Use a scale from 0 to 100 (NOT -100 to +100)
- 0-20: Very Negative (severe complaints, critical issues, strong dissatisfaction)
- 21-40: Negative (complaints, problems, frustration)
- 41-60: Neutral (mixed feedback, no strong sentiment, factual observations)
- 61-80: Positive (satisfaction, praise, good experiences)
- 81-100: Very Positive (exceptional praise, strong endorsement, delight)

ENTITY ATTRIBUTION:
When feedback compares products or features, assign SEPARATE scores to each entity:
- "Product A is better than Product B" → Product A: higher score, Product B: lower score
- "Feature X is frustrating but Feature Y works well" → Feature X: lower score, Feature Y: higher score
- Always identify which product/feature the sentiment applies to before scoring
`;
