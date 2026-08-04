import { ExternalLink } from "@/components/ExternalLink";

/** A small provenance link for live-API items — each bullet cites its source. */
export function SourceLink({ href }: { href: string | null }) {
  if (!href) {
    return null;
  }
  return (
    <ExternalLink
      href={href}
      className="ml-2 whitespace-nowrap font-mono text-[10.5px] font-medium text-faint hover:text-teal-deep hover:underline"
    >
      source
    </ExternalLink>
  );
}
