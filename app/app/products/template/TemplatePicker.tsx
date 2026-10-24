"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Button, ErrorNote } from "@/components/ui";
import { useRecorder } from "@/components/useRecorder";
import { findMatches, parseSpokenItem } from "@/lib/catalog-match";
import type { Dict } from "@/lib/i18n";
import type { CategoryTemplate } from "@/lib/templates";
import { addTemplateItems } from "../../actions";

interface Props {
  t: Dict;
  lang: string;
  initialCategory: string;
  templates: CategoryTemplate[];
  taken: string[];
}

export function TemplatePicker({ t, lang, initialCategory, templates, taken }: Props) {
  const router = useRouter();
  const [category, setCategory] = useState(initialCategory);
  const [picked, setPicked] = useState<Record<string, number>>({});
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [heard, setHeard] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const rec = useRecorder();
  const takenSet = useMemo(() => new Set(taken), [taken]);

  const template = templates.find((x) => x.category === category) ?? templates[0];
  const items = template.items.filter((i) => !takenSet.has(i.id) && (!query || `${i.name} ${Object.values(i.local).join(" ")}`.toLowerCase().includes(query.toLowerCase())));
  const groups = [...new Set(items.map((i) => i.group))];
  const count = Object.keys(picked).length;

  const toggle = (id: string, price: number) =>
    setPicked((p) => {
      const next = { ...p };
      if (id in next) delete next[id];
      else next[id] = price;
      return next;
    });

  /** "Atta 260, sugar 48, Maggi 14": tick each item and set its price. */
  async function speakPrices() {
    const blob = await rec.stop();
    if (!blob) return;
    const form = new FormData();
    form.append("audio", blob, "prices.webm");
    form.append("purpose", "transcribe");
    const resp = await fetch("/api/stt", { method: "POST", body: form });
    const data = await resp.json();
    if (!resp.ok) return setError(data.error);
    setHeard(data.text);
    const matchable = template.items.map((i) => ({ id: i.id, name: i.name, size: i.size, nameLocal: (i.local as Record<string, string>)[lang], aliases: i.aliases }));
    setPicked((p) => {
      const next = { ...p };
      for (const part of String(data.text).split(/,|\n|\band\b|\baur\b|\bmattu\b/i)) {
        const spoken = parseSpokenItem(part);
        const best = spoken.name ? findMatches(`${spoken.name} ${spoken.size ?? ""}`, matchable, 1, 0.5)[0] : undefined;
        if (best) next[best.product.id] = spoken.price ?? next[best.product.id] ?? template.items.find((i) => i.id === best.product.id)!.price;
      }
      return next;
    });
  }

  function submit() {
    setError(null);
    start(async () => {
      const res = await addTemplateItems(Object.entries(picked).map(([templateId, price]) => ({ templateId, price })));
      if (res?.error) setError(res.error);
      else router.push("/app/products/drafts");
    });
  }

  return (
    <div className="mt-4 pb-24">
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-2">
        {templates.map((x) => (
          <button
            key={x.category}
            type="button"
            onClick={() => setCategory(x.category)}
            className={`shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-semibold ${category === x.category ? "border-ink bg-ink text-white" : "border-line bg-card"}`}
          >
            {(x.label as Record<string, string>)[lang] ?? x.label.en}
          </button>
        ))}
      </div>

      <div className="mt-2 flex gap-2">
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t.search} className="min-w-0 flex-1 rounded-xl border border-line bg-card px-4 py-2.5 focus:border-ink focus:outline-none" />
        <button
          type="button"
          onPointerDown={rec.start}
          onPointerUp={speakPrices}
          onPointerLeave={() => rec.recording && speakPrices()}
          className={`shrink-0 rounded-xl border-2 border-ink bg-turmeric px-3 text-sm font-bold ${rec.recording ? "mic-ring" : ""}`}
          title="Hold and say items with prices"
        >
          {rec.recording ? t.releaseToSend : "🎙 Say prices"}
        </button>
      </div>
      {heard && <p className="mt-2 text-sm italic text-ink-soft">“{heard}”</p>}
      <ErrorNote>{error ?? rec.error}</ErrorNote>

      {groups.map((g) => (
        <section key={g} className="mt-5">
          <h2 className="font-display text-lg font-bold">{g}</h2>
          <ul className="mt-1 divide-y divide-line">
            {items.filter((i) => i.group === g).map((i) => {
              const on = i.id in picked;
              return (
                <li key={i.id} className="flex items-center gap-3 py-2.5">
                  <input type="checkbox" checked={on} onChange={() => toggle(i.id, i.price)} className="h-6 w-6 shrink-0 accent-[var(--color-leaf)]" aria-label={i.name} />
                  <button type="button" onClick={() => toggle(i.id, i.price)} className="min-w-0 flex-1 text-left">
                    <span className="block font-semibold leading-snug">{i.name}</span>
                    <span lang={lang} className="block text-sm text-mute">{(i.local as Record<string, string>)[lang] ?? ""} {i.size}</span>
                  </button>
                  <label className="flex items-center gap-1 text-sm">
                    ₹
                    <input
                      type="number"
                      min={1}
                      value={picked[i.id] ?? i.price}
                      disabled={!on}
                      onChange={(e) => setPicked((p) => ({ ...p, [i.id]: Number(e.target.value) }))}
                      className="w-16 rounded-lg border border-line px-2 py-1 text-right disabled:bg-paper disabled:text-mute"
                    />
                  </label>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {count > 0 && (
        <div className="fixed inset-x-0 bottom-16 z-30 p-3">
          <Button onClick={submit} disabled={pending} className="mx-auto flex w-full max-w-md py-4 text-lg shadow-lg">
            {pending ? "Adding…" : `${t.add} ${count} ${t.items}`}
          </Button>
        </div>
      )}
    </div>
  );
}
