/**
 * Sanitize LLM response text before JSON parsing.
 * Ported verbatim from the SaaS gemini.ts:160–200 (`sanitizeJsonResponse`).
 * Removes control tokens like <ctrl42>, strips markdown fences, extracts
 * embedded JSON, and repairs truncated output.
 */
export function sanitizeJsonResponse(text: string | null | undefined): string {
  if (!text) return "{}";

  // Remove control tokens like <ctrl42>, <ctrl123>, etc.
  let sanitized = text.replace(/<ctrl\d+>/gi, "");

  // Remove other common control patterns that might break JSON
  sanitized = sanitized.replace(/<[a-z]+\d+[a-z]*>/gi, "");

  // Trim whitespace
  sanitized = sanitized.trim();

  // Strip markdown code blocks (```json ... ``` or ``` ... ```)
  // This handles when LLMs return JSON wrapped in markdown formatting
  const codeBlockMatch = sanitized.match(/^```(?:json)?\s*\n?([\s\S]*)\n?```\s*$/i);
  if (codeBlockMatch) {
    sanitized = codeBlockMatch[1]!.trim();
  }

  // Also handle cases where there's text before/after the code block
  const embeddedCodeBlock = sanitized.match(/```(?:json)?\s*\n?([\s\S]*)\n?```/i);
  if (embeddedCodeBlock && !sanitized.startsWith("{") && !sanitized.startsWith("[")) {
    sanitized = embeddedCodeBlock[1]!.trim();
  }

  // Handle truncated code blocks — opening fence present but no closing fence
  // This happens when LLM output is cut off mid-response (e.g. max_tokens exceeded)
  if (!sanitized.startsWith("{") && !sanitized.startsWith("[")) {
    const truncatedFenceMatch = sanitized.match(/^```(?:json)?\s*\n?([\s\S]*)$/i);
    if (truncatedFenceMatch) {
      // Strip the opening fence and try to extract JSON from what remains
      sanitized = truncatedFenceMatch[1]!.trim();
    }
  }

  // Handle preamble text before JSON (when model adds explanation before JSON)
  // Extract the first JSON object or array from the text
  if (!sanitized.startsWith("{") && !sanitized.startsWith("[")) {
    // Find the first { or [ that might be the start of JSON
    const firstBrace = sanitized.indexOf("{");
    const firstBracket = sanitized.indexOf("[");

    let jsonStart = -1;
    if (firstBrace >= 0 && firstBracket >= 0) {
      jsonStart = Math.min(firstBrace, firstBracket);
    } else if (firstBrace >= 0) {
      jsonStart = firstBrace;
    } else if (firstBracket >= 0) {
      jsonStart = firstBracket;
    }

    if (jsonStart > 0) {
      // Try to extract valid JSON from this point
      const potentialJson = sanitized.substring(jsonStart);
      try {
        // Verify it's valid JSON before using it
        JSON.parse(potentialJson);
        sanitized = potentialJson;
      } catch {
        // If the whole remaining string isn't valid JSON,
        // try to find a balanced JSON object/array
        let depth = 0;
        let endIndex = -1;
        for (let i = 0; i < potentialJson.length; i++) {
          const char = potentialJson[i];
          if (char === "{" || char === "[") depth++;
          if (char === "}" || char === "]") depth--;
          if (depth === 0) {
            endIndex = i + 1;
            break;
          }
        }
        if (endIndex > 0) {
          const extracted = potentialJson.substring(0, endIndex);
          try {
            JSON.parse(extracted);
            sanitized = extracted;
          } catch {
            // Keep original if extraction fails
          }
        }
      }
    }
  }

  // Handle truncated JSON - attempt to close unclosed brackets/braces
  try {
    JSON.parse(sanitized);
  } catch {
    // Count unmatched brackets/braces (simple heuristic, ignoring strings)
    let inString = false;
    let escapeNext = false;
    let openBraces = 0;
    let openBrackets = 0;
    for (let i = 0; i < sanitized.length; i++) {
      const c = sanitized[i];
      if (escapeNext) { escapeNext = false; continue; }
      if (c === "\\" && inString) { escapeNext = true; continue; }
      if (c === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (c === "{") openBraces++;
      else if (c === "}") openBraces--;
      else if (c === "[") openBrackets++;
      else if (c === "]") openBrackets--;
    }

    if (openBraces > 0 || openBrackets > 0) {
      let repaired = sanitized;

      // Remove trailing incomplete string value (e.g., "key": "some unterminated val)
      if (inString) {
        repaired = repaired.replace(/"[^"]*$/, '""');
      }

      // Remove trailing incomplete array items: , {"partial": "data
      // Try progressively more aggressive truncation patterns
      const truncationPatterns = [
        /,\s*\{[^}]*$/,                         // trailing incomplete object in array
        /,\s*"[^"]*"?\s*:?\s*[^}\]]*$/,         // trailing incomplete key-value pair
        /,\s*\[[^\]]*$/,                         // trailing incomplete nested array
        /,\s*"[^"]*$/,                           // trailing incomplete string in array
      ];

      for (const pattern of truncationPatterns) {
        const candidate = repaired.replace(pattern, "");
        // Recount brackets after removal
        let ob = 0, obrk = 0, inStr = false, esc = false;
        for (let i = 0; i < candidate.length; i++) {
          const ch = candidate[i];
          if (esc) { esc = false; continue; }
          if (ch === "\\" && inStr) { esc = true; continue; }
          if (ch === '"') { inStr = !inStr; continue; }
          if (inStr) continue;
          if (ch === "{") ob++; else if (ch === "}") ob--;
          if (ch === "[") obrk++; else if (ch === "]") obrk--;
        }
        if (ob >= 0 && obrk >= 0) {
          let closed = candidate;
          for (let i = 0; i < obrk; i++) closed += "]";
          for (let i = 0; i < ob; i++) closed += "}";
          try {
            JSON.parse(closed);
            sanitized = closed;
            break;
          } catch {
            // Try next pattern
          }
        }
      }

      // Fallback: simple close if no pattern worked
      if (sanitized === repaired) {
        repaired = sanitized.replace(/,\s*"[^"]*"?\s*:?\s*[^}\]]*$/, "");
        repaired = repaired.replace(/,\s*\{[^}]*$/, "");
        for (let i = 0; i < openBrackets; i++) repaired += "]";
        for (let i = 0; i < openBraces; i++) repaired += "}";
        try {
          JSON.parse(repaired);
          sanitized = repaired;
        } catch {
          // Repair failed, return as-is
        }
      }
    }
  }

  return sanitized || "{}";
}
