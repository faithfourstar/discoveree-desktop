/**
 * Typography ruling §4/§7 for PRE-ASSEMBLED strings: some lines (the status
 * footer's segments, stamp values) arrive as single strings composed by the
 * state providers, with data already embedded — "Local · 42 MB on disk",
 * "Agents idle · next run 21:00", "Licence to 14 Mar 2027". This renderer
 * wraps the value tokens in the `.data` utility (Inter, tabular figures —
 * the owner's amended scope keeps mono for developer artifacts only) so
 * digit alignment survives, without touching how the strings are assembled.
 *
 * The token grammar is deliberately conservative — recognised VALUE shapes
 * only, never words: sizes (42 MB), times/elapsed (21:00, 0:34), dates
 * (12 Aug, 14 Mar 2027), day counts (9 days), IPs and ports (127.0.0.1:7317,
 * :7317), and bare figures. Tokens never split mid-value (ruling §4).
 */

import type { ReactNode } from "react";

const MONTHS = "Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec";

const DATA_TOKEN = new RegExp(
  [
    // IPv4 with optional port — 127.0.0.1:7317
    String.raw`\d{1,3}(?:\.\d{1,3}){3}(?::\d{1,5})?`,
    // Dates — 14 Mar 2027 · 12 Aug
    String.raw`\d{1,2}\s(?:${MONTHS})(?:\s\d{4})?`,
    // Sizes — 42 MB · 1.3 GB
    String.raw`\d+(?:\.\d+)?\s?(?:KB|MB|GB|TB)`,
    // Durations/relative — 9 days · 4 h ago · 12 m ago · 3 d ago
    String.raw`\d+\s(?:days?|h|m|s|d)(?:\sago)?`,
    // Times and elapsed counters — 21:00 · 0:34
    String.raw`\d{1,2}:\d{2}`,
    // Bare ports — :7317
    String.raw`:\d{2,5}`,
    // Bare figures
    String.raw`\d+(?:\.\d+)?`,
  ].join("|"),
  "g",
);

/** Inter line with `.data` spans around the recognised value tokens. */
export function DataText({ text }: { text: string }) {
  const nodes: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(DATA_TOKEN)) {
    const start = match.index ?? 0;
    if (start > last) {
      nodes.push(text.slice(last, start));
    }
    nodes.push(
      <span key={start} className="data">
        {match[0]}
      </span>,
    );
    last = start + match[0].length;
  }
  if (last < text.length) {
    nodes.push(text.slice(last));
  }
  return <>{nodes}</>;
}
