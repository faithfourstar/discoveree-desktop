import { Link } from "wouter";
import { EvidenceRow } from "@/components/EvidenceChip";
import { RichText } from "@/components/RichText";
import { useProductHref } from "@/lib/productUrl";
import { useAppState } from "@/state/AppStateContext";
import { useT } from "@/state/locale";
import type { BriefingItem, DayOnePrompt, HomeBriefing } from "@/mock/types";

function BriefingRow({ item, index }: { item: BriefingItem; index: number }) {
  return (
    <div className="flex gap-3.5 border-t border-edge-hairline py-5 last:border-b">
      <span className="data w-[18px] flex-none text-xs font-medium leading-[1.6] text-num">
        {String(index + 1).padStart(2, "0")}
      </span>
      <div className="flex-1">
        <p className="mb-[9px] text-[15px] leading-[1.6] text-ink">
          <RichText value={item.body} />
        </p>
        <EvidenceRow evidence={item.evidence}>
          <button
            type="button"
            className="text-[12.5px] font-medium text-teal-deep hover:underline"
          >
            {item.action.label} →
          </button>
        </EvidenceRow>
      </div>
    </div>
  );
}

function Briefing({ home }: { home: HomeBriefing }) {
  const productHref = useProductHref();
  return (
    <div className="flex justify-center px-8 py-[42px]">
      <div className="w-full max-w-[720px]">
        <div className="mb-4 text-[11px] font-semibold uppercase tracking-[0.08em] text-label">
          {home.kicker}
        </div>
        <p className="mb-[34px] text-[21px] leading-[1.5] tracking-[-0.01em] text-ink [text-wrap:pretty]">
          <RichText value={home.lede} />
        </p>

        <div className="mb-8 flex flex-col">
          {home.items.map((item, index) => (
            <BriefingRow key={item.id} item={item} index={index} />
          ))}
        </div>

        <input
          type="text"
          placeholder={home.ideaPlaceholder}
          className="mb-[26px] w-full rounded-[10px] border border-edge-input bg-surface px-[18px] py-4 text-sm text-ink outline-none placeholder:text-ghost focus:border-teal"
          aria-label="Test a product idea"
        />

        {/* Summary of the Connections page — every segment is a door
            (connections-spec 6.2); the figures share one source of truth. */}
        <div className="flex flex-wrap items-center gap-3 pt-0.5">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ghost">
            Serving
          </span>
          {home.serving.invitation ? (
            <span className="text-[12.5px] text-body">
              nothing is reading your context yet —{" "}
              <Link
                href={`${productHref("/connections")}#serving`}
                className="font-medium text-teal-deep hover:underline"
              >
                Connect a tool
              </Link>
            </span>
          ) : home.serving.waitingToolName ? (
            <Link
              href={`${productHref("/connections")}#serving`}
              className="text-[12.5px] text-body hover:text-ink"
            >
              {home.serving.waitingToolName} set up, waiting for its first
              query
            </Link>
          ) : (
            <>
              <span className="text-[12.5px] text-body">
                {home.serving.consumers.map((consumer, index) => (
                  <span key={consumer.tool}>
                    {index > 0 ? " · " : ""}
                    <Link
                      href={`${productHref("/connections")}#${consumer.anchor ?? "serving"}`}
                      className="hover:text-ink hover:underline"
                    >
                      {consumer.tool}{" "}
                      <span className="data">
                        {consumer.queriesThisWeek}
                      </span>
                    </Link>
                  </span>
                ))}{" "}
                this week
              </span>
              <span className="text-sep">·</span>
              <Link
                href={`${productHref("/connections")}#readers`}
                className="text-[12.5px] text-body hover:text-ink hover:underline"
              >
                <span className="data">
                  {home.serving.teammatesReading}
                </span>{" "}
                {home.serving.teammatesReading === 1
                  ? "teammate"
                  : "teammates"}{" "}
                reading
              </Link>
              <Link
                href={`${productHref("/connections")}#serving`}
                className="text-[12.5px] font-medium text-teal-deep hover:underline"
              >
                Connect another
              </Link>
            </>
          )}
          {home.serving.writeAttemptFragment ? (
            <>
              <span className="text-sep">·</span>
              <Link
                href={`${productHref("/connections")}#readers`}
                className="text-[12.5px] text-faint hover:text-body hover:underline"
              >
                {home.serving.writeAttemptFragment} — full seats
              </Link>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function DayOne({ prompt }: { prompt: DayOnePrompt }) {
  const t = useT();
  return (
    <div className="flex min-h-full items-center justify-center px-8">
      <div className="w-full max-w-[600px]">
        <p className="mb-[26px] text-[23px] leading-[1.45] tracking-[-0.015em] text-ink [text-wrap:pretty]">
          {t(prompt.lede)}
        </p>
        <div className="mb-3.5 flex gap-2.5">
          <input
            type="url"
            placeholder={prompt.inputPlaceholder}
            className="h-[46px] flex-1 rounded-[9px] border border-edge-input bg-surface px-3.5 text-sm text-ink outline-none placeholder:text-ghost focus:border-teal"
            aria-label="Your product's URL"
          />
          <button
            type="button"
            className="h-[46px] rounded-[9px] bg-teal px-5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
          >
            {prompt.cta}
          </button>
        </div>
        <p className="text-[12.5px] leading-[1.65] text-faint">
          {t(prompt.helper)}
        </p>
      </div>
    </div>
  );
}

export function HomePage() {
  const state = useAppState();
  if (state.scenario === "day-one" && state.dayOne) {
    return <DayOne prompt={state.dayOne} />;
  }
  if (state.home) {
    return <Briefing home={state.home} />;
  }
  return null;
}
