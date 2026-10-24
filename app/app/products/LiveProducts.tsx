"use client";

import { useState, useTransition } from "react";
import type { Dict } from "@/lib/i18n";
import { updateLiveProduct } from "../actions";

interface Item {
  id: string;
  name: string;
  nameLocal: string | null;
  size: string | null;
  price: number;
  inStock: boolean;
}

export function LiveProducts({ products, t }: { products: Item[]; t: Dict }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [price, setPrice] = useState("");
  const [pending, start] = useTransition();

  if (!products.length) return <p className="mt-3 text-sm text-mute">{t.noDrafts}</p>;

  return (
    <ul className="mt-2 divide-y divide-line">
      {products.map((p) => (
        <li key={p.id} className={`flex items-center gap-3 py-3 ${p.inStock ? "" : "opacity-50"}`}>
          <div className="min-w-0 flex-1">
            <p className="font-semibold leading-snug">{p.name}</p>
            <p className="text-sm text-mute">{p.size}</p>
          </div>
          {editing === p.id ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                start(async () => {
                  await updateLiveProduct(p.id, { price: Number(price) });
                  setEditing(null);
                });
              }}
              className="flex items-center gap-1"
            >
              <input autoFocus type="number" min={1} value={price} onChange={(e) => setPrice(e.target.value)} className="w-20 rounded-lg border border-ink px-2 py-1.5 text-right" />
              <button disabled={pending} className="rounded-lg bg-leaf px-3 py-1.5 font-semibold text-white">{t.save}</button>
            </form>
          ) : (
            <button type="button" onClick={() => { setEditing(p.id); setPrice(String(p.price)); }} className="rounded-lg border border-line px-3 py-1.5 font-bold">
              ₹{p.price}
            </button>
          )}
          <label className="flex items-center gap-1.5 text-xs font-semibold text-ink-soft">
            <input
              type="checkbox"
              checked={p.inStock}
              onChange={(e) => start(() => updateLiveProduct(p.id, { inStock: e.target.checked }).then(() => undefined))}
              className="h-5 w-5 accent-[var(--color-leaf)]"
            />
            In stock
          </label>
        </li>
      ))}
    </ul>
  );
}
