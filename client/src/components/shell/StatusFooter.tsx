import { useAppState } from "@/state/AppStateContext";

export function StatusFooter() {
  const { footer } = useAppState();

  return (
    <footer className="flex h-[30px] flex-none items-center gap-4 border-t border-edge bg-surface px-[18px] font-mono text-[11px] text-faint">
      <span className="flex items-center gap-1.5">
        <span
          className="h-1.5 w-1.5 rounded-full bg-live"
          aria-hidden
        />
        {footer.local}
      </span>
      {footer.agents ? <span>{footer.agents}</span> : null}
      {footer.mcp ? <span>{footer.mcp}</span> : null}
      <span>{footer.offline}</span>
      {footer.licence ? (
        <span className="ml-auto">{footer.licence}</span>
      ) : null}
    </footer>
  );
}
