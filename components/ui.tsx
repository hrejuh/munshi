import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

type Tone = "leaf" | "ink" | "plain" | "danger" | "turmeric";

const TONES: Record<Tone, string> = {
  leaf: "bg-leaf text-white hover:bg-leaf-dark",
  ink: "bg-ink text-white hover:bg-ink-soft",
  turmeric: "bg-turmeric text-ink border-2 border-ink hover:bg-turmeric-deep",
  plain: "bg-card text-ink border border-line hover:border-ink",
  danger: "bg-card text-sindoor border border-sindoor/40 hover:bg-sindoor hover:text-white",
};

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-[15px] font-semibold transition-colors disabled:opacity-50 disabled:pointer-events-none";

export function Button({ tone = "leaf", className = "", ...props }: ComponentProps<"button"> & { tone?: Tone }) {
  return <button className={`${BASE} ${TONES[tone]} ${className}`} {...props} />;
}

export function ButtonLink({ tone = "leaf", className = "", ...props }: ComponentProps<typeof Link> & { tone?: Tone }) {
  return <Link className={`${BASE} ${TONES[tone]} ${className}`} {...props} />;
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-semibold text-ink">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-mute">{hint}</span>}
    </label>
  );
}

export const inputClass =
  "w-full rounded-xl border border-line bg-card px-4 py-3 text-base text-ink placeholder:text-mute focus:border-ink focus:outline-none";

export function Page({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <main className={`mx-auto w-full max-w-md px-4 pb-28 pt-5 ${className}`}>{children}</main>;
}

export function Pill({ children, tone = "plain" }: { children: ReactNode; tone?: "plain" | "leaf" | "turmeric" | "danger" }) {
  const tones = {
    plain: "bg-paper text-ink-soft border border-line",
    leaf: "bg-leaf/10 text-leaf",
    turmeric: "bg-turmeric/25 text-ink",
    danger: "bg-sindoor/10 text-sindoor",
  };
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${tones[tone]}`}>{children}</span>;
}

export function ErrorNote({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <p className="rounded-xl bg-sindoor/10 px-4 py-3 text-sm text-sindoor">{children}</p>;
}
