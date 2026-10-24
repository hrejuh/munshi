"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { Button, ErrorNote } from "@/components/ui";
import { useRecorder } from "@/components/useRecorder";
import type { Dict } from "@/lib/i18n";
import { draftFromText } from "../../actions";

interface Draft {
  id?: string;
  name: string;
  size: string | null;
  price: number;
}

/** Shrinks a phone photo to ~800px WebP in the browser so uploads stay small on mobile data. */
async function resize(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 800 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not read photo"))), "image/webp", 0.8),
  );
}

export function AddByVoice({ t, mode }: { t: Dict; mode: "photo" | "voice" }) {
  const rec = useRecorder();
  const fileInput = useRef<HTMLInputElement>(null);
  const [photo, setPhoto] = useState<{ url: string; id: string } | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<Draft[]>([]);
  const [heard, setHeard] = useState<string | null>(null);

  async function onPhoto(file: File | undefined) {
    if (!file) return;
    setError(null);
    setBusy("Saving photo…");
    try {
      const blob = await resize(file);
      const form = new FormData();
      form.append("image", blob, "photo.webp");
      const resp = await fetch("/api/images", { method: "POST", body: form });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error);
      setPhoto({ url: URL.createObjectURL(blob), id: data.id });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  function done(drafts: Draft[]) {
    setAdded((a) => [...drafts, ...a]);
    setPhoto(null);
    setText("");
  }

  async function stopAndSend() {
    const blob = await rec.stop();
    if (!blob) return;
    setBusy("Munshi is listening…");
    setError(null);
    try {
      const form = new FormData();
      form.append("audio", blob, "item.webm");
      form.append("purpose", "item");
      if (photo) form.append("imageId", photo.id);
      const resp = await fetch("/api/stt", { method: "POST", body: form });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error);
      setHeard(data.text);
      if (!data.drafts.length) throw new Error("Could not understand that. Try: Tata salt 1 kilo 28 rupees");
      done(data.drafts);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function sendText(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy("Munshi is writing the card…");
    setError(null);
    const res = await draftFromText(text, photo?.id);
    setBusy(null);
    if (res?.error) setError(res.error);
    else done([{ name: text, size: null, price: 0 }]);
  }

  const needPhoto = mode === "photo" && !photo;
  const dim = needPhoto ? "pointer-events-none opacity-40" : "";

  return (
    <div className="mt-6 space-y-5">
      {mode === "photo" && (
        <div>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => onPhoto(e.target.files?.[0])}
          />
          {photo ? (
            <div className="flex items-center gap-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo.url} alt="Product" className="h-28 w-28 rounded-xl border-2 border-ink object-cover" />
              <Button tone="plain" onClick={() => fileInput.current?.click()}>
                {t.retake}
              </Button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              className="flex h-40 w-full flex-col items-center justify-center gap-2 rounded-[var(--radius-board)] border-2 border-dashed border-ink bg-card font-display text-xl font-bold"
            >
              <span className="text-4xl" aria-hidden>
                📷
              </span>
              {t.takePhoto}
            </button>
          )}
        </div>
      )}

      <div className={`flex flex-col items-center gap-2 ${dim}`}>
        <button
          type="button"
          onPointerDown={rec.start}
          onPointerUp={stopAndSend}
          onPointerLeave={() => rec.recording && stopAndSend()}
          disabled={Boolean(busy)}
          aria-label={t.holdToSpeak}
          className={`flex h-24 w-24 items-center justify-center rounded-full border-[3px] border-ink bg-turmeric shadow-[0_5px_0_var(--color-ink)] active:translate-y-1 active:shadow-none ${rec.recording ? "mic-ring" : ""}`}
        >
          <svg viewBox="0 0 24 24" className="h-10 w-10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" />
            <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
          </svg>
        </button>
        <p className="text-sm font-semibold text-ink-soft">{busy ?? (rec.recording ? t.releaseToSend : t.holdToSpeak)}</p>
      </div>

      <form onSubmit={sendText} className={`flex gap-2 ${dim}`}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Aashirvaad atta 5 kg 260"
          className="min-w-0 flex-1 rounded-xl border border-line bg-card px-4 py-3 focus:border-ink focus:outline-none"
        />
        <button type="submit" disabled={!text.trim() || Boolean(busy)} className="rounded-xl bg-ink px-4 font-semibold text-white disabled:opacity-40">
          {t.add}
        </button>
      </form>

      {heard && <p className="text-sm italic text-ink-soft">&ldquo;{heard}&rdquo;</p>}
      <ErrorNote>{error ?? rec.error}</ErrorNote>

      {added.length > 0 && (
        <section className="rounded-xl border border-line bg-card p-4">
          <p className="font-semibold">Added to drafts</p>
          <ul className="mt-1 space-y-0.5 text-[15px]">
            {added.map((d, i) => (
              <li key={d.id ?? i}>
                {d.name} {d.size ?? ""}{" "}
                {d.price ? `₹${d.price}` : <span className="text-sindoor">({t.priceNeeded})</span>}
              </li>
            ))}
          </ul>
          <Link href="/app/products/drafts" className="mt-3 inline-block font-semibold text-leaf underline">
            {t.reviewDrafts}
          </Link>
        </section>
      )}
    </div>
  );
}
