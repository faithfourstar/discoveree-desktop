/**
 * The shared confirm dialogue for destructive acts (merge, retire, remove,
 * delete) — the competitor stop-tracking pattern, generalised.
 */
export function ConfirmDialogue({
  title,
  body,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-20 flex items-center justify-center bg-black/30 px-6"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-[400px] rounded-[12px] border border-edge bg-surface p-6 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="mb-2 text-[16px] font-semibold text-ink">{title}</h2>
        <p className="mb-5 text-[13.5px] leading-[1.6] text-body">{body}</p>
        <div className="flex justify-end gap-[9px]">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-[7px] border border-edge-btn bg-surface px-[13px] py-2 text-[12.5px] font-medium text-body transition-colors hover:border-edge-input"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-[7px] bg-red-600 px-[13px] py-2 text-[12.5px] font-semibold text-white transition-opacity hover:opacity-90"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
