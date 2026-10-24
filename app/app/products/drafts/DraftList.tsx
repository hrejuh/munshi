"use client";

import { useState, useTransition } from "react";
import { Button, ErrorNote, Pill } from "@/components/ui";
import type { Dict } from "@/lib/i18n";
import { approveAllDrafts, approveProduct, deleteProduct } from "../../actions";

interface Draft {
  id: string;
  name: string;
  nameLocal: string | null;
  size: string | null;
  price: number;
  source: string;
  imageId: string | null;
  /** Set when this draft proposes a new price for an item already in the store. */
  oldPrice: number | null;
}

const SOURCE_LABEL: Record<string, string> = { TEMPLATE: "From list", PHOTO: "Photo", VOICE: "Spoken", TEXT: "Typed" };

export function DraftList({ drafts, t }: { drafts: Draft[]; t: Dict }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const ready = drafts.filter((d) => d.price > 0).length;

  return (
    <div className="mt-4 space-y-3">
      <ErrorNote>{error}</ErrorNote>
      {ready > 1 && (
        <Button
          className="w-full"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await approveAllDrafts();
              if (res?.skipped) setError(`${res.skipped} item(s) still need a price.`);
            })
          }
        >
          {t.approveAll} ({ready})
        </Button>
      )}
      {drafts.map((d) => (
        <DraftCard key={d.id} draft={d} t={t} onError={setError} />
      ))}
    </div>
  );
}

function DraftCard({ draft, t, onError }: { draft: Draft; t: Dict; onError: (e: string | null) => void }) {
  const [editing, setEditing] = useState(draft.price === 0);
  const [name, setName] = useState(draft.name);
  const [size, setSize] = useState(draft.size ?? "");
  const [price, setPrice] = useState(draft.price ? String(draft.price) : "");
  const [pending, start] = useTransition();

  const approve = () =>
    start(async () => {
      onError(null);
      const res = await approveProduct(draft.id, editing ? { name, size, price: Number(price) } : undefined);
      if (res?.error) onError(res.error);
    });

  return (
    <article className="rounded-xl border border-line bg-card p-4">
      <div className="flex gap-3">
        {draft.imageId && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/api/images/${draft.imageId}`} alt="" className="h-16 w-16 shrink-0 rounded-lg object-cover" />
        )}
        <div className="min-w-0 flex-1">
          {editing ? (
            <div className="space-y-2">
              <input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-lg border border-line px-3 py-2 font-semibold" aria-label="Name" />
              <div className="flex gap-2">
                <input value={size} onChange={(e) => setSize(e.target.value)} placeholder="Size" className="w-1/2 rounded-lg border border-line px-3 py-2" aria-label="Size" />
                <input
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  type="number"
                  min={1}
                  placeholder="₹ Price"
                  className={`w-1/2 rounded-lg border px-3 py-2 ${price ? "border-line" : "border-sindoor"}`}
                  aria-label="Price"
                />
              </div>
            </div>
          ) : (
            <>
              <p className="font-semibold leading-snug">{draft.name}</p>
              {draft.nameLocal && <p className="text-sm text-ink-soft">{draft.nameLocal}</p>}
              <p className="mt-0.5 text-sm">
                {draft.size && <span className="text-mute">{draft.size} </span>}
                {draft.oldPrice !== null && <span className="text-mute line-through">₹{draft.oldPrice}</span>}{" "}
                <span className="font-bold">₹{draft.price}</span>
              </p>
            </>
          )}
        </div>
        <div className="flex flex-col items-end gap-1">
          <Pill>{SOURCE_LABEL[draft.source] ?? draft.source}</Pill>
          {draft.oldPrice !== null && <Pill tone="turmeric">Price change</Pill>}
          {!draft.price && <Pill tone="danger">{t.priceNeeded}</Pill>}
        </div>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <Button onClick={approve} disabled={pending || (editing && !Number(price))} className="col-span-1 py-2">
          {t.approve}
        </Button>
        <Button tone="plain" onClick={() => setEditing((v) => !v)} disabled={pending} className="py-2">
          {editing ? t.cancel : t.edit}
        </Button>
        <Button tone="danger" onClick={() => start(async () => { await deleteProduct(draft.id); })} disabled={pending} className="py-2">
          {t.delete}
        </Button>
      </div>
    </article>
  );
}
