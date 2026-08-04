/** The two capability columns — "They beat you on" / "You beat them on". */

export function CapabilityColumn({
  heading,
  items,
}: {
  heading: string;
  items: readonly string[];
}) {
  return (
    <div className="flex-1">
      <div className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-label">
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

export function CapabilityColumns({
  theyBeatYouOn,
  youBeatThemOn,
}: {
  theyBeatYouOn: readonly string[];
  youBeatThemOn: readonly string[];
}) {
  if (theyBeatYouOn.length === 0 && youBeatThemOn.length === 0) {
    return null;
  }
  return (
    <div className="flex gap-[34px]">
      {theyBeatYouOn.length > 0 ? (
        <CapabilityColumn heading="They beat you on" items={theyBeatYouOn} />
      ) : null}
      {youBeatThemOn.length > 0 ? (
        <CapabilityColumn heading="You beat them on" items={youBeatThemOn} />
      ) : null}
    </div>
  );
}
