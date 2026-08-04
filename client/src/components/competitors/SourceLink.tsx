import { ExternalLink } from "@/components/ExternalLink";

/** A small provenance link for live-API items — each bullet cites its source. */
export function SourceLink({ href }: { href: string | null }) {
  if (!href) {
    return null;
  }
  return (
    <ExternalLink
      href={href}
      className="ml-2 whitespace-nowrap text-[11px] font-medium tabular-nums text-faint hover:text-teal-deep hover:underline"
    >
      source
    </ExternalLink>
  );
}
