import { Link } from "wouter";
import { useProductHref } from "@/lib/productUrl";
import type { FeedbackItemRef } from "@/mock/types";

/**
 * The mono attribution every verbatim carries (customers spec 0.6):
 * source-kind chip · detail · when it was SAID. An undated mined item reads
 * "date unknown" — the gathered date renders separately as "mined 4 Aug",
 * never dressed as the feedback date.
 */
export function ProvenanceLine({
  item,
  showThemeChip,
  showSegmentChip,
}: {
  item: FeedbackItemRef;
  showThemeChip?: boolean | undefined;
  showSegmentChip?: boolean | undefined;
}) {
  const productHref = useProductHref();
  const { provenance } = item;

  const label = provenance.sourceUrl ? (
    <a
      href={provenance.sourceUrl}
      target="_blank"
      rel="noreferrer"
      onClick={(event) => event.stopPropagation()}
      className="hover:text-teal-deep hover:underline"
    >
      {provenance.label}
    </a>
  ) : (
    <span>{provenance.label}</span>
  );

  return (
    <div className="mt-1 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 font-mono text-[11px] tabular-nums text-faint">
      <span>
        {label}
        {provenance.detail ? ` · ${provenance.detail}` : ""}
        {` · ${provenance.date ?? "date unknown"}`}
        {provenance.minedOn ? ` · mined ${provenance.minedOn}` : ""}
      </span>
      {showThemeChip && item.themeId && item.themeName ? (
        <Link
          href={productHref(`/customers/themes/${item.themeId.split(":").pop() ?? ""}`)}
          onClick={(event) => event.stopPropagation()}
          className="whitespace-nowrap rounded-[5px] bg-chip px-[7px] py-0.5 font-medium text-muted hover:text-teal-deep"
        >
          {item.themeName}
        </Link>
      ) : null}
      {showSegmentChip && item.segmentId && item.segmentName ? (
        <Link
          href={productHref(
            `/customers/segments/${item.segmentId.split(":").pop() ?? ""}`,
          )}
          onClick={(event) => event.stopPropagation()}
          className="whitespace-nowrap rounded-[5px] bg-chip px-[7px] py-0.5 font-medium text-muted hover:text-teal-deep"
        >
          {item.segmentName}
        </Link>
      ) : null}
      {item.competitorId && item.competitorName ? (
        <Link
          href={productHref(
            `/competitors/${item.competitorId.split(":").pop() ?? ""}`,
          )}
          onClick={(event) => event.stopPropagation()}
          className="whitespace-nowrap rounded-[5px] bg-teal-tint px-[7px] py-0.5 font-medium text-teal-dark hover:opacity-80"
        >
          {item.competitorName}
        </Link>
      ) : null}
    </div>
  );
}

/** A hairline-left-ruled verbatim with its provenance line. */
export function Verbatim({
  item,
  showThemeChip,
  showSegmentChip,
}: {
  item: FeedbackItemRef;
  showThemeChip?: boolean | undefined;
  showSegmentChip?: boolean | undefined;
}) {
  return (
    <blockquote className="border-l border-edge-hairline pl-4">
      <p className="text-[13.5px] leading-[1.65] text-body">“{item.text}”</p>
      <ProvenanceLine
        item={item}
        showThemeChip={showThemeChip}
        showSegmentChip={showSegmentChip}
      />
    </blockquote>
  );
}
