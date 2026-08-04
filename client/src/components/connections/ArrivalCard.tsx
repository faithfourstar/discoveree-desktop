import { useState } from "react";
import { EvidenceRow } from "@/components/EvidenceChip";
import { RichText } from "@/components/RichText";
import { useAppActions } from "@/state/AppStateContext";
import { useT } from "@/state/locale";
import type { McpArrivalCard } from "@/mock/types";

/**
 * The §4a review card (connections-spec 4.2): the standard proposal-card
 * grammar with MCP provenance. The VIA chip renders in the ASSERTED register
 * (plain bg-chip, never teal-tint) — attribution is what the tool reported;
 * the human accept is the verification step.
 */

export function ViaChip({ via }: { via: string }) {
  return (
    <span className="whitespace-nowrap rounded-[5px] bg-chip px-[7px] py-0.5 text-[10px] [font-weight:650] uppercase tracking-[0.06em] text-muted">
      via {via}
    </span>
  );
}

export function ArrivalCardView({ card }: { card: McpArrivalCard }) {
  const actions = useAppActions();
  const t = useT();
  const known = card.targetObjectId !== undefined;

  // Typography ruling §7 (arrival attribution): people and tools are words,
  // Inter 12.5px text-faint; the channel and the date are the only values.
  const attribution = (
    <>
      {card.attribution.sharedBy ? (
        <>
          shared by {card.attribution.sharedBy}
          {card.attribution.channel ? (
            <>
              {" in "}
              <span className="data">{card.attribution.channel}</span>
            </>
          ) : null}
          <span className="text-sep"> · </span>
        </>
      ) : null}
      via {card.attribution.via}
      <span className="text-sep"> · </span>
      <span className="data">{card.attribution.date}</span>
    </>
  );

  return (
    <div className="rounded-[10px] border border-edge bg-surface p-5">
      <div className="mb-1 flex items-baseline gap-3">
        <span className="text-[15.5px] font-semibold text-ink">
          {card.title}
        </span>
        <ViaChip via={card.attribution.via} />
      </div>
      <p className="mb-3 text-[12.5px] text-faint">{attribution}</p>
      <blockquote className="mb-4 border-l border-edge-hairline pl-4">
        <p className="text-[13.5px] leading-[1.65] text-body">
          “{card.verbatim}”
        </p>
      </blockquote>
      {card.extracted && card.extracted.length > 0 ? (
        <div className="mb-4 flex flex-col gap-1">
          {card.extracted.map((field) => (
            <p key={field.label} className="text-[13px] leading-[1.6] text-body">
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-label">
                {t(field.label)}:
              </span>{" "}
              {field.value}
            </p>
          ))}
        </div>
      ) : null}
      {card.suggestedThemeLine ? (
        <p className="mb-4 text-[13px] leading-[1.6] text-body">
          <RichText value={card.suggestedThemeLine} />
        </p>
      ) : null}
      <div className="mb-5">
        <EvidenceRow evidence={card.evidence} />
      </div>
      <div className="flex items-center gap-[9px]">
        {known ? (
          <button
            type="button"
            onClick={() => actions.acceptArrival(card.id)}
            className="rounded-[7px] bg-teal px-[13px] py-2 text-[12.5px] font-semibold text-white transition-opacity hover:opacity-90"
          >
            {card.kind === "feedback"
              ? t("Accept as feedback")
              : t(`Accept into ${card.targetName ?? "the"}'s profile`)}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => actions.researchArrival(card.id)}
            className="rounded-[7px] bg-teal px-[13px] py-2 text-[12.5px] font-semibold text-white transition-opacity hover:opacity-90"
          >
            {t(`Research and track ${card.targetName ?? "them"}`)}
          </button>
        )}
        <button
          type="button"
          onClick={() => actions.dismissArrival(card.id)}
          className="rounded-[7px] border border-edge-btn bg-surface px-[13px] py-2 text-[12.5px] font-medium text-body transition-colors hover:border-edge-input"
        >
          {t("Discard")}
        </button>
      </div>
    </div>
  );
}

/** The "Waiting for your review" block (spec 4.1) — rows expanding inline. */
export function ArrivalsReviewBlock({
  arrivals,
}: {
  arrivals: readonly McpArrivalCard[];
}) {
  const t = useT();
  const [expanded, setExpanded] = useState<string | null>(
    arrivals[0]?.id ?? null,
  );
  if (arrivals.length === 0) {
    return null;
  }
  return (
    <section className="mb-8">
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-label">
        {t("Waiting for your review")}
      </div>
      <div className="flex flex-col gap-2.5">
        {arrivals.map((card) =>
          expanded === card.id ? (
            <ArrivalCardView key={card.id} card={card} />
          ) : (
            <button
              key={card.id}
              type="button"
              onClick={() => setExpanded(card.id)}
              className="flex items-baseline gap-3 rounded-[9px] border border-edge-hairline px-4 py-3 text-left transition-colors hover:border-edge-input"
            >
              <span className="flex-1 text-[14px] font-medium text-ink">
                {card.title}
              </span>
              <span className="text-[12.5px] text-faint">
                via {card.attribution.via} ·{" "}
                <span className="data">{card.attribution.date}</span>
              </span>
            </button>
          ),
        )}
      </div>
    </section>
  );
}
