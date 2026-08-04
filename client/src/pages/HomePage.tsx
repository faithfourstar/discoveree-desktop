import { EvidenceRow } from "@/components/EvidenceChip";
import { RichText } from "@/components/RichText";
import { useAppState } from "@/state/AppStateContext";
import { useT } from "@/state/locale";
import type { BriefingItem, DayOnePrompt, HomeBriefing } from "@/mock/types";

function BriefingRow({ item, index }: { item: BriefingItem; index: number }) {
  return (
    <div className="flex gap-3.5 border-t border-edge-hairline py-5 last:border-b">
      <span className="w-[18px] flex-none font-mono text-xs font-medium leading-[1.6] text-num">
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
  return (
    <div className="flex justify-center px-8 py-[42px]">
      <div className="w-full max-w-[720px]">
        <div className="mb-4 font-mono text-[11px] font-semibold uppercase tracking-[0.09em] text-label">
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

        <div className="flex items-center gap-3 pt-0.5">
          <span className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ghost">
            Serving
          </span>
          <span className="text-[12.5px] text-body">
            {home.serving.consumers.map((consumer, index) => (
              <span key={consumer.tool}>
                {index > 0 ? " · " : ""}
                {consumer.tool}{" "}
                <span className="font-mono tabular-nums">
                  {consumer.queriesThisWeek}
                </span>
              </span>
            ))}{" "}
            this week
          </span>
          <span className="text-sep">·</span>
          <span className="text-[12.5px] text-body">
            <span className="font-mono tabular-nums">
              {home.serving.teammatesReading}
            </span>{" "}
            {home.serving.teammatesReading === 1 ? "teammate" : "teammates"}{" "}
            reading
          </span>
          <button
            type="button"
            className="text-[12.5px] font-medium text-teal-deep hover:underline"
          >
            Connect another
          </button>
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
