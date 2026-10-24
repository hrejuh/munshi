"use client";

import { useState } from "react";
import { Button, ErrorNote } from "@/components/ui";
import { useRecorder } from "@/components/useRecorder";
import type { Dict } from "@/lib/i18n";

interface Line {
  productId: string;
  name: string;
  size?: string | null;
  price: number;
  qty: number;
}

interface Parsed {
  text: string;
  lines: Line[];
  unclear: Array<{ said: string; suggestions: string[] }>;
}

/** F8: order by typing a list or sending a voice note. The agent drafts the cart; the buyer confirms it. */
export function OrderByMessage({ slug, t, onAdd }: { slug: string; t: Dict; onAdd: (lines: Array<{ productId: string; qty: number }>) => void }) {
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rec = useRecorder();

  async function handle(resp: Response) {
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error ?? "Could not read the order");
    setParsed(data as Parsed);
  }

  async function sendText() {
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await handle(await fetch("/api/orders/parse", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shop: slug, text }) }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function stopAndSend() {
    const blob = await rec.stop();
    if (!blob) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("audio", blob, "note.webm");
      form.append("purpose", "order");
      form.append("shop", slug);
      await handle(await fetch("/api/stt", { method: "POST", body: form }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const setQty = (i: number, qty: number) =>
    setParsed((p) => (p ? { ...p, lines: p.lines.map((l, j) => (j === i ? { ...l, qty } : l)).filter((l) => l.qty > 0) } : p));

  if (parsed) {
    return (
      <div className="space-y-4">
        <p className="rounded-xl bg-card px-4 py-3 text-sm italic text-ink-soft">“{parsed.text}”</p>
        {parsed.lines.length > 0 && (
          <ul className="divide-y divide-line rounded-xl border border-line bg-card">
            {parsed.lines.map((l, i) => (
              <li key={l.productId} className="flex items-center justify-between gap-3 px-4 py-3">
                <div>
                  <p className="font-semibold">{l.name}</p>
                  <p className="text-sm text-mute">{l.size} · ₹{l.price}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setQty(i, l.qty - 1)} className="h-8 w-8 rounded-lg border border-line font-bold">−</button>
                  <span className="w-5 text-center font-bold">{l.qty}</span>
                  <button type="button" onClick={() => setQty(i, l.qty + 1)} className="h-8 w-8 rounded-lg border border-line font-bold">+</button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {parsed.unclear.length > 0 && (
          <div className="rounded-xl bg-turmeric/20 px-4 py-3 text-sm">
            <p className="font-semibold">Not sure about:</p>
            <ul className="mt-1 space-y-1">
              {parsed.unclear.map((u) => (
                <li key={u.said}>
                  “{u.said}”{u.suggestions.length ? ` (maybe ${u.suggestions.join(" or ")})` : ""}. Add it from the list instead.
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex gap-2">
          <Button tone="plain" onClick={() => setParsed(null)} className="flex-1">{t.change}</Button>
          <Button
            disabled={!parsed.lines.length}
            onClick={() => onAdd(parsed.lines.map((l) => ({ productId: l.productId, qty: l.qty })))}
            className="flex-[2]"
          >
            {t.checkout}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        placeholder="2 Maggi, 1 Amul butter, 1 litre Nandini milk"
        className="w-full rounded-xl border border-line bg-card px-4 py-3 text-base focus:border-ink focus:outline-none"
      />
      <Button onClick={sendText} disabled={busy || !text.trim()} tone="ink" className="w-full">
        {busy ? "Reading your order…" : t.send}
      </Button>
      <div className="flex flex-col items-center gap-2 pt-2">
        <button
          type="button"
          onPointerDown={rec.start}
          onPointerUp={stopAndSend}
          onPointerLeave={() => rec.recording && stopAndSend()}
          disabled={busy}
          className={`h-20 w-20 rounded-full border-[3px] border-ink bg-turmeric font-display text-sm font-bold ${rec.recording ? "mic-ring" : ""}`}
        >
          {rec.recording ? "●" : "🎙"}
        </button>
        <p className="text-sm text-ink-soft">{rec.recording ? t.releaseToSend : t.holdToSpeak}</p>
      </div>
      <ErrorNote>{error ?? rec.error}</ErrorNote>
    </div>
  );
}
