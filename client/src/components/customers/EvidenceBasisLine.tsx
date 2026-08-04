import type { EvidenceBasis } from "@/mock/types";

/**
 * The evidence-basis contract, enforced at the surface (customers spec
 * 0.5/3.5): every persona, JTBD section, needs section and segment insight
 * renders with its basis visible. An empty basis throws in dev and renders
 * nothing in production — there is no unsourced display state.
 */

export function basisIsEmpty(basis: EvidenceBasis): boolean {
  return (
    basis.feedbackCount === undefined &&
    basis.reviewCount === undefined &&
    !basis.ownerProvided &&
    !(basis.extraRefs && basis.extraRefs.length > 0)
  );
}

/** The quiet mono "added by you" chip — asserted, never dressed as research. */
export function AddedByYouChip() {
  return (
    <span className="whitespace-nowrap rounded-[5px] bg-chip px-[7px] py-0.5 font-mono text-[10.5px] font-medium text-muted">
      added by you
    </span>
  );
}

export function EvidenceBasisLine({
  basis,
  onAddEvidence,
}: {
  basis: EvidenceBasis;
  /** The thin-basis remedy: opens the log-feedback flow pre-filled. */
  onAddEvidence?: (() => void) | undefined;
}) {
  if (basisIsEmpty(basis)) {
    if (import.meta.env.DEV) {
      throw new Error(
        "EvidenceBasis is empty — an unsourced section or persona cannot render (customers spec 0.5).",
      );
    }
    return null;
  }

  const figures: { key: string; label: string }[] = [];
  if (basis.feedbackCount !== undefined) {
    figures.push({
      key: "feedback",
      label: `${basis.feedbackCount} feedback item${basis.feedbackCount === 1 ? "" : "s"}`,
    });
  }
  if (basis.reviewCount !== undefined) {
    figures.push({
      key: "reviews",
      label: `${basis.reviewCount} review quote${basis.reviewCount === 1 ? "" : "s"}`,
    });
  }
  for (const ref of basis.extraRefs ?? []) {
    figures.push({ key: ref.id, label: ref.label });
  }

  const ownerLabel =
    basis.ownerProvided === "interview" ? "your interview" : null;

  if (basis.thin) {
    return (
      <div className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1 font-mono text-[11px] tabular-nums text-amber-600 dark:text-amber-400">
        <span>
          early — built on{" "}
          {figures.map((figure) => figure.label).join(" · ")}
          {basis.singleSourceKind ? " from one source" : ""}
        </span>
        {onAddEvidence ? (
          <button
            type="button"
            onClick={onAddEvidence}
            className="font-sans text-[12px] font-medium text-teal-deep hover:underline"
          >
            Add evidence
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="mt-2 flex flex-wrap items-baseline gap-x-1.5 gap-y-1 font-mono text-[11px] tabular-nums text-faint">
      {figures.length > 0 ? (
        <span>
          built on{" "}
          {figures.map((figure, index) => (
            <span key={figure.key}>
              {index > 0 ? " · " : ""}
              <button
                type="button"
                title="Open the underlying evidence"
                className="hover:text-teal-deep hover:underline"
              >
                {figure.label}
              </button>
            </span>
          ))}
          {ownerLabel ? " · " : ""}
          {ownerLabel ? (
            <button
              type="button"
              title="Open your interview answers"
              className="hover:text-teal-deep hover:underline"
            >
              {ownerLabel}
            </button>
          ) : null}
        </span>
      ) : null}
      {basis.ownerProvided && figures.length === 0 ? <AddedByYouChip /> : null}
      {basis.ownerProvided && figures.length > 0 && !ownerLabel ? (
        <AddedByYouChip />
      ) : null}
      {basis.correctedOn ? (
        <span className="text-ghost">corrected by you · {basis.correctedOn}</span>
      ) : null}
    </div>
  );
}
