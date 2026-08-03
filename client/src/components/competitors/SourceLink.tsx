/** A small provenance link for live-API items — each bullet cites its source. */
export function SourceLink({ href }: { href: string | null }) {
  if (!href) {
    return null;
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={(event) => event.stopPropagation()}
      className="ml-2 whitespace-nowrap font-mono text-[10.5px] font-medium text-faint hover:text-teal-deep hover:underline"
    >
      source
    </a>
  );
}
