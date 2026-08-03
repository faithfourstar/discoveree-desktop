import { EmptyState } from "@/components/EmptyState";
import { EvidenceRow } from "@/components/EvidenceChip";
import { useAppState } from "@/state/AppStateContext";
import type { CompetitorObject, DeepDiveThread } from "@/mock/types";

function CapabilityColumn({
  heading,
  items,
}: {
  heading: string;
  items: readonly string[];
}) {
  return (
    <div className="flex-1">
      <div className="mb-2.5 font-mono text-[10.5px] font-semibold uppercase tracking-[0.08em] text-label">
        {heading}
      </div>
      <div className="text-[13.5px] leading-[1.75] text-body">
        {items.map((item) => (
          <div key={item}>{item}</div>
        ))}
      </div>
    </div>
  );
}

/** The Thread pattern: a deep dive growing inside the column, teal-edged. */
function OpenThread({ thread }: { thread: DeepDiveThread }) {
  return (
    <section className="border-l-2 border-teal pl-5">
      <div className="mb-3 font-mono text-[10.5px] font-semibold uppercase tracking-[0.08em] text-teal">
        Deep dive · {thread.status}
      </div>
      <div className="mb-3 text-[15.5px] font-medium leading-[1.5] text-ink">
        {thread.question}
      </div>
      <div className="mb-3 text-[13.5px] leading-[1.7] text-body">
        {thread.answer}
      </div>
      <div className="mb-4">
        <EvidenceRow evidence={thread.evidence} />
      </div>
      <div className="flex gap-[9px]">
        <button
          type="button"
          className="rounded-[7px] bg-teal px-[13px] py-2 text-[12.5px] font-semibold text-white transition-opacity hover:opacity-90"
        >
          {thread.fileUnderLabel}
        </button>
        <button
          type="button"
          className="rounded-[7px] border border-edge-btn bg-surface px-[13px] py-2 text-[12.5px] font-medium text-body transition-colors hover:border-edge-input"
        >
          {thread.keepAskingLabel}
        </button>
      </div>
    </section>
  );
}

/** The Object pattern: a linkable detail view owned by no tab. */
function CompetitorView({ competitor }: { competitor: CompetitorObject }) {
  return (
    <div className="flex justify-center px-8 py-[38px]">
      <div className="w-full max-w-[720px]">
        <div className="mb-1.5 flex items-baseline gap-3">
          <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-ink">
            {competitor.name}
          </h1>
          <span className="rounded bg-teal-tint px-1.5 py-1 font-mono text-[10px] font-semibold text-teal-dark">
            {competitor.classification}
          </span>
          <button
            type="button"
            className="ml-auto text-[12.5px] font-medium text-teal-deep hover:underline"
          >
            Explore this
          </button>
        </div>
        <div className="mb-[26px] font-mono text-xs text-faint">
          {competitor.domain} · sentiment {competitor.sentiment} ·{" "}
          {competitor.reviewCount} reviews · verified {competitor.verifiedAgo}
        </div>

        <p className="mb-6 text-[15px] leading-[1.65] text-ink [text-wrap:pretty]">
          {competitor.summary}
        </p>

        <div className="mb-8 flex gap-[34px] border-b border-edge-hairline pb-[26px]">
          <CapabilityColumn
            heading="They beat you on"
            items={competitor.theyBeatYouOn}
          />
          <CapabilityColumn
            heading="You beat them on"
            items={competitor.youBeatThemOn}
          />
        </div>

        {competitor.openThread ? (
          <OpenThread thread={competitor.openThread} />
        ) : null}

        {competitor.filedThreads.length > 0 ? (
          <p className="mt-[30px] text-[12.5px] leading-[1.7] text-faint">
            Filed here already:{" "}
            {competitor.filedThreads.map((thread, index) => (
              <span key={thread.id}>
                {index > 0 ? " · " : ""}
                <span className="text-body">{thread.title}</span> ·{" "}
                {thread.filedOn}
              </span>
            ))}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function CompetitorsPage() {
  const { competitor } = useAppState();
  if (!competitor) {
    return <EmptyState line="Who should Discoveree keep an eye on? Add a competitor and agents will keep the profile current." />;
  }
  return <CompetitorView competitor={competitor} />;
}
