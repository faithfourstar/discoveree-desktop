import { describe, it, expect } from 'vitest';
import {
  clampSentiment,
  convertFromLegacyScale,
  isValidSentimentScore,
  getColorFromScore,
  getSentimentLabel,
  sanitizeSentimentScore,
  createDefaultSentiment,
} from './sentiment.js';

describe('clampSentiment', () => {
  it('Given a score within 0-100, When clamping, Then it returns the same score', () => {
    expect(clampSentiment(50)).toBe(50);
    expect(clampSentiment(0)).toBe(0);
    expect(clampSentiment(100)).toBe(100);
  });

  it('Given a score below 0, When clamping, Then it returns 0', () => {
    expect(clampSentiment(-10)).toBe(0);
    expect(clampSentiment(-100)).toBe(0);
  });

  it('Given a score above 100, When clamping, Then it returns 100', () => {
    expect(clampSentiment(150)).toBe(100);
    expect(clampSentiment(101)).toBe(100);
  });

  it('Given a fractional score, When clamping, Then it rounds to the nearest integer', () => {
    expect(clampSentiment(50.4)).toBe(50);
    expect(clampSentiment(50.6)).toBe(51);
  });
});

describe('convertFromLegacyScale', () => {
  it('Given a legacy score of -100, When converting, Then it returns 0', () => {
    expect(convertFromLegacyScale(-100)).toBe(0);
  });

  it('Given a legacy score of 0, When converting, Then it returns 50', () => {
    expect(convertFromLegacyScale(0)).toBe(50);
  });

  it('Given a legacy score of +100, When converting, Then it returns 100', () => {
    expect(convertFromLegacyScale(100)).toBe(100);
  });

  it('Given a legacy score of -50, When converting, Then it returns 25', () => {
    expect(convertFromLegacyScale(-50)).toBe(25);
  });

  it('Given a legacy score of +50, When converting, Then it returns 75', () => {
    expect(convertFromLegacyScale(50)).toBe(75);
  });
});

describe('isValidSentimentScore', () => {
  it('Given scores within 0-100, When validating, Then it returns true', () => {
    expect(isValidSentimentScore(0)).toBe(true);
    expect(isValidSentimentScore(50)).toBe(true);
    expect(isValidSentimentScore(100)).toBe(true);
  });

  it('Given scores outside 0-100, When validating, Then it returns false', () => {
    expect(isValidSentimentScore(-1)).toBe(false);
    expect(isValidSentimentScore(101)).toBe(false);
  });

  it('Given non-number types, When validating, Then it returns false', () => {
    expect(isValidSentimentScore(NaN)).toBe(false);
    expect(isValidSentimentScore('50' as any)).toBe(false);
  });
});

describe('getColorFromScore', () => {
  it('Given a score 0-20, When getting color, Then it returns pastel_red', () => {
    expect(getColorFromScore(0)).toBe('pastel_red');
    expect(getColorFromScore(20)).toBe('pastel_red');
  });

  it('Given a score 21-40, When getting color, Then it returns pastel_orange', () => {
    expect(getColorFromScore(21)).toBe('pastel_orange');
    expect(getColorFromScore(40)).toBe('pastel_orange');
  });

  it('Given a score 41-60, When getting color, Then it returns pastel_yellow', () => {
    expect(getColorFromScore(41)).toBe('pastel_yellow');
    expect(getColorFromScore(60)).toBe('pastel_yellow');
  });

  it('Given a score 61-80, When getting color, Then it returns pastel_green', () => {
    expect(getColorFromScore(61)).toBe('pastel_green');
    expect(getColorFromScore(80)).toBe('pastel_green');
  });

  it('Given a score 81-100, When getting color, Then it returns pastel_blue', () => {
    expect(getColorFromScore(81)).toBe('pastel_blue');
    expect(getColorFromScore(100)).toBe('pastel_blue');
  });
});

describe('getSentimentLabel', () => {
  it('Given various scores, When getting labels, Then it returns the correct label for each range', () => {
    expect(getSentimentLabel(10)).toBe('Very Negative');
    expect(getSentimentLabel(30)).toBe('Negative');
    expect(getSentimentLabel(50)).toBe('Neutral');
    expect(getSentimentLabel(70)).toBe('Positive');
    expect(getSentimentLabel(90)).toBe('Very Positive');
  });
});

describe('sanitizeSentimentScore', () => {
  it('Given a valid in-range score, When sanitizing, Then it returns the score unchanged', () => {
    expect(sanitizeSentimentScore(75)).toBe(75);
  });

  it('Given non-number input, When sanitizing, Then it returns the default value', () => {
    expect(sanitizeSentimentScore('bad')).toBe(50);
    expect(sanitizeSentimentScore(null)).toBe(50);
    expect(sanitizeSentimentScore(undefined)).toBe(50);
  });

  it('Given a negative score, When sanitizing, Then it converts from legacy scale', () => {
    expect(sanitizeSentimentScore(-50)).toBe(25);
  });

  it('Given a score above 100, When sanitizing, Then it clamps to 100', () => {
    expect(sanitizeSentimentScore(150)).toBe(100);
  });

  it('Given non-number input and a custom default, When sanitizing, Then it returns the custom default', () => {
    expect(sanitizeSentimentScore('bad', 30)).toBe(30);
  });
});

describe('createDefaultSentiment', () => {
  it('Given no input, When creating default sentiment, Then it returns neutral values with empty arrays', () => {
    const result = createDefaultSentiment();
    expect(result.overallScore).toBe(50);
    expect(result.color).toBe('pastel_yellow');
    expect(result.confidence).toBe('low');
    expect(result.entities).toEqual([]);
    expect(result.topics).toEqual([]);
  });
});
