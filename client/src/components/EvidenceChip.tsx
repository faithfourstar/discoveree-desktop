import type { ReactNode } from "react";
import type { EvidenceRef } from "@/mock/types";

/** A single evidence citation chip — mono, quiet, always present. */
export function EvidenceChip({ evidence }: { evidence: EvidenceRef }) {
  return (
    <span className="whitespace-nowrap rounded-[5px] bg-chip px-[7px] py-1 font-mono text-[10.5px] font-medium text-muted">
      {evidence.label}
    </span>
  );
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
