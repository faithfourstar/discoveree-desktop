import type { ReactNode } from "react";
import type { EvidenceRef } from "@/mock/types";

/** A single evidence citation chip — mono, quiet, always present. */
export function EvidenceChip({ evidence }: { evidence: EvidenceRef }) {
  const className =
    "whitespace-nowrap rounded-[5px] bg-chip px-[7px] py-1 font-mono text-[10.5px] font-medium text-muted";
  if (evidence.href) {
    return (
      <a
        href={evidence.href}
        target="_blank"
        rel="noreferrer"
        onClick={(event) => event.stopPropagation()}
        className={`${className} hover:text-teal-deep hover:underline`}
      >
        {evidence.label}
      </a>
    );
  }
  return <span className={className}>{evidence.label}</span>;
}

/** The evidence row a briefing item or thread carries beneath its prose. */
export function EvidenceRow({
  evidence,
  children,
}: {
  evidence: readonly EvidenceRef[];
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-[9px]">
      {evidence.map((item) => (
        <EvidenceChip key={item.id} evidence={item} />
      ))}
      {children}
    </div>
  );
}
