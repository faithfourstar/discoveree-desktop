import type { RichSegment, RichText as RichTextValue } from "@/mock/types";
import { useT } from "@/state/locale";

/**
 * Renders prose segments with inline object links (teal) and staleness
 * highlights (amber underline — an invitation, never an error).
 *
 * Display-locale boundary: copy segments flow through the locale transform;
 * DATA segments — anything with an objectId (object names), tone "mono"
 * (figures) or the explicit `data` flag — render exactly as stored.
 */
function isDataSegment(segment: RichSegment): boolean {
  return (
    segment.data === true ||
    segment.objectId !== undefined ||
    segment.tone === "mono"
  );
}

export function RichText({ value }: { value: RichTextValue }) {
  const t = useT();
  return (
    <>
      {value.map((segment, index) => {
        const text = isDataSegment(segment) ? segment.text : t(segment.text);
        if (segment.tone === "stale") {
          return (
            <span
              key={index}
              className="border-b-2 border-amberflag"
            >
              {text}
            </span>
          );
        }
        if (segment.tone === "link") {
          return (
            <span key={index} className="text-teal-deep">
              {text}
            </span>
          );
        }
        if (segment.tone === "mono") {
          return (
            <span
              key={index}
              className="font-mono text-[0.88em] tabular-nums"
            >
              {text}
            </span>
          );
        }
        return <span key={index}>{text}</span>;
      })}
    </>
  );
}
