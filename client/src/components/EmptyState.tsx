import { useT } from "@/state/locale";

/**
 * Centred single-line state for modules that are not built yet, or are
 * enabled but unpopulated. Always an invitation, never an apology.
 * The line is app copy — it flows through the display-locale transform.
 */
export function EmptyState({ line }: { line: string }) {
  const t = useT();
  return (
    <div className="flex min-h-full items-center justify-center px-8">
      <p className="max-w-[600px] text-center text-[15px] leading-relaxed text-muted">
        {t(line)}
      </p>
    </div>
  );
}
