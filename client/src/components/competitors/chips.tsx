/** Small mono chips shared by the Competitors Overview and Object views. */

/** The DIRECT / ADJACENT relationship badge (teal-tint chip beside the name). */
export function ClassificationBadge({
  value,
  onClick,
  title,
}: {
  value: "DIRECT" | "ADJACENT" | "ASPIRATIONAL";
  onClick?: () => void;
  title?: string;
}) {
  const className =
    "rounded bg-teal-tint px-1.5 py-1 font-mono text-[10px] font-semibold text-teal-dark";
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        title={title}
        className={`${className} cursor-pointer transition-opacity hover:opacity-80`}
      >
        {value}
      </button>
    );
  }
  return <span className={className}>{value}</span>;
}

/** The mono teal NEW marker on freshly detected, unseen changes. */
export function NewTag() {
  return (
    <span className="mr-1.5 inline-block translate-y-[-1px] rounded bg-teal-tint px-1.5 py-0.5 font-mono text-[10px] font-semibold text-teal-dark">
      NEW
    </span>
  );
}
