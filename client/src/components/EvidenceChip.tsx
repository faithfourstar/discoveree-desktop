import type { ReactNode } from "react";
import { ExternalLink } from "@/components/ExternalLink";
import type { EvidenceRef } from "@/mock/types";

/** A single evidence citation chip — mono, quiet, always present. */
export function EvidenceChip({ evidence }: { evidence: EvidenceRef }) {
  const className =
    "whitespace-nowrap rounded-[5px] bg-chip px-[7px] py-1 text-[11px] font-medium tabular-nums text-muted";
  if (evidence.href) {
    return (
      <ExternalLink
        href={evidence.href}
        className={`${className} hover:text-teal-deep hover:underline`}
      >
        {evidence.label}
      </ExternalLink>
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
