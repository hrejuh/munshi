"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useCart } from "@/components/store/cart";
import type { StoreProduct } from "@/components/store/Storefront";
import { Button, ErrorNote, Field, inputClass } from "@/components/ui";
import type { Dict } from "@/lib/i18n";

interface Pricing {
  deliveryMode: "DELIVERY" | "PICKUP" | "BOTH";
  deliveryFee: number;
  minOrder: number;
}

const BUYER_KEY = "munshi-buyer";

export function CheckoutClient({ slug, t, products, pricing, deliveryNote }: { slug: string; t: Dict; products: StoreProduct[]; pricing: Pricing; deliveryNote: string | null }) {
  const router = useRouter();
  const { cart, loaded, setQty, clear } = useCart(slug);
  const [fulfilment, setFulfilment] = useState<"DELIVERY" | "PICKUP">(pricing.deliveryMode === "PICKUP" ? "PICKUP" : "DELIVERY");
  const [buyer, setBuyer] = useState({ name: "", phone: "", address: "" });
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(BUYER_KEY);
      if (saved) setBuyer((b) => ({ ...b, ...JSON.parse(saved) }));
    } catch {
      /* no saved details */
    }
  }, []);

  const lines = products.filter((p) => cart[p.id]).map((p) => ({ ...p, qty: cart[p.id] }));
  const subtotal = lines.reduce((s, l) => s + l.price * l.qty, 0);
  const deliveryFee = fulfilment === "DELIVERY" ? pricing.deliveryFee : 0;
  const total = subtotal + deliveryFee;
  const belowMin = pricing.minOrder > 0 && subtotal < pricing.minOrder;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      localStorage.setItem(BUYER_KEY, JSON.stringify(buyer));
    } catch {
      /* fine */
    }
    try {
      const resp = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shop: slug,
          lines: lines.map((l) => ({ productId: l.id, qty: l.qty })),
          name: buyer.name,
          phone: buyer.phone,
          address: fulfilment === "DELIVERY" ? buyer.address : undefined,
          fulfilment,
          note: note || undefined,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error ?? "Could not place the order");
      clear();
      router.push(`/s/${slug}/order/${data.code}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  if (!loaded) return null;
  if (!lines.length) {
    return (
      <div className="mt-10 text-center">
        <p className="text-mute">{t.emptyCart}</p>
        <Link href={`/s/${slug}`} className="mt-4 inline-block font-semibold text-leaf underline">{t.backToShop}</Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="mt-5 space-y-6">
      <ul className="divide-y divide-line rounded-xl border border-line bg-card">
        {lines.map((l) => (
          <li key={l.id} className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <p className="font-semibold">{l.name}</p>
              <p className="text-sm text-mute">{l.size ? `${l.size}, ` : ""}₹{l.price}</p>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setQty(l.id, l.qty - 1)} className="h-8 w-8 rounded-lg border border-line font-bold">−</button>
              <span className="w-5 text-center font-bold">{l.qty}</span>
              <button type="button" onClick={() => setQty(l.id, l.qty + 1)} className="h-8 w-8 rounded-lg border border-line font-bold">+</button>
            </div>
          </li>
        ))}
      </ul>

      {pricing.deliveryMode === "BOTH" && (
        <div className="grid grid-cols-2 gap-2" role="radiogroup">
          {(["DELIVERY", "PICKUP"] as const).map((f) => (
            <button
              key={f}
              type="button"
              role="radio"
              aria-checked={fulfilment === f}
              onClick={() => setFulfilment(f)}
              className={`rounded-xl border-2 py-3 font-semibold ${fulfilment === f ? "border-ink bg-turmeric/30" : "border-line bg-card"}`}
            >
              {f === "DELIVERY" ? t.delivery : t.pickup}
            </button>
          ))}
        </div>
      )}

      <div className="space-y-3">
        <Field label={t.name}>
          <input required value={buyer.name} onChange={(e) => setBuyer({ ...buyer, name: e.target.value })} className={inputClass} autoComplete="name" />
        </Field>
        <Field label={t.phone}>
          <input required type="tel" inputMode="numeric" value={buyer.phone} onChange={(e) => setBuyer({ ...buyer, phone: e.target.value })} className={inputClass} autoComplete="tel" />
        </Field>
        {fulfilment === "DELIVERY" && (
          <Field label={t.deliveryAddress} hint={deliveryNote ?? undefined}>
            <textarea required rows={2} value={buyer.address} onChange={(e) => setBuyer({ ...buyer, address: e.target.value })} className={inputClass} autoComplete="street-address" />
          </Field>
        )}
        <Field label="Note for the shop (optional)">
          <input value={note} onChange={(e) => setNote(e.target.value)} className={inputClass} placeholder="Ring the bell twice" />
        </Field>
      </div>

      <dl className="space-y-1.5 rounded-xl bg-card p-4">
        <div className="flex justify-between text-ink-soft"><dt>{t.subtotal}</dt><dd>₹{subtotal}</dd></div>
        {fulfilment === "DELIVERY" && <div className="flex justify-between text-ink-soft"><dt>{t.deliveryFee}</dt><dd>₹{deliveryFee}</dd></div>}
        <div className="flex justify-between border-t border-line pt-2 font-display text-xl font-bold"><dt>{t.total}</dt><dd>₹{total}</dd></div>
      </dl>

      {belowMin && <ErrorNote>{`${t.minOrder}: ₹${pricing.minOrder}`}</ErrorNote>}
      <ErrorNote>{error}</ErrorNote>
      <p className="text-center text-sm font-semibold text-ink-soft">{t.payCash}</p>
      <Button type="submit" disabled={busy || belowMin} className="w-full py-4 text-lg">
        {busy ? "Placing order…" : `${t.placeOrder} ₹${total}`}
      </Button>
    </form>
  );
}
