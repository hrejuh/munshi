interface Props {
  name: string;
  tagline?: string | null;
  area?: string | null;
  address?: string | null;
  timings?: string | null;
  deliveryLabel: string;
}

/** The shop's painted signboard: the loudest element on the page, on purpose. */
export function StoreHeader({ name, tagline, area, address, timings, deliveryLabel }: Props) {
  return (
    <header className="signboard px-5 pb-5 pt-6">
      <h1 className="font-display text-[34px] font-extrabold leading-none text-ink">{name}</h1>
      {tagline && <p className="mt-2 text-[15px] font-medium leading-snug text-ink/85">{tagline}</p>}
      <div className="mt-4 flex flex-wrap gap-2 text-[13px] font-semibold text-ink">
        {(area || address) && <span className="rounded-full bg-white/70 px-3 py-1">{area || address}</span>}
        {timings && <span className="rounded-full bg-white/70 px-3 py-1">{timings}</span>}
        <span className="rounded-full bg-ink px-3 py-1 text-white">{deliveryLabel}</span>
      </div>
    </header>
  );
}
