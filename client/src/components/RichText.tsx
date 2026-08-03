import type { RichText as RichTextValue } from "@/mock/types";

/**
 * Renders prose segments with inline object links (teal) and staleness
 * highlights (amber underline — an invitation, never an error).
 */
export function RichText({ value }: { value: RichTextValue }) {
  return (
    <>
      {value.map((segment, index) => {
        if (segment.tone === "stale") {
          return (
            <span
              key={index}
              className="border-b-2 border-amberflag"
            >
              {segment.text}
            </span>
          );
        }
        if (segment.tone === "link") {
          return (
            <span key={index} className="text-teal-deep">
              {segment.text}
            </span>
          );
        }
        return <span key={index}>{segment.text}</span>;
      })}
    </>
  );
}
