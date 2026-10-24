"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { VoiceAgent } from "@/components/VoiceAgent";
import type { Dict } from "@/lib/i18n";
import { useCart } from "./cart";
import { OrderByMessage } from "./OrderByMessage";

export interface StoreProduct {
  id: string;
  name: string;
  nameLocal: string | null;
  size: string | null;
  price: number;
  category: string | null;
  imageId: string | null;
}

interface Props {
  slug: string;
  shopName: string;
  lang: string;
  products: StoreProduct[];
  t: Dict;
  preview?: boolean;
  firstMessage: string;
  phoneLine?: { number: string; code: string } | null;
}

const TILE_COLORS = ["bg-turmeric/40", "bg-leaf/15", "bg-sindoor/10", "bg-ink/10"];

export function Storefront({ slug, shopName, lang, products, t, preview, firstMessage, phoneLine }: Props) {
  const router = useRouter();
  const { cart, setQty, addMany } = useCart(slug);
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<string | null>(null);
  const [sheet, setSheet] = useState<null | "voice" | "message">(null);

  const groups = useMemo(() => [...new Set(products.map((p) => p.category ?? "Other"))], [products]);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter(
      (p) =>
        (!group || (p.category ?? "Other") === group) &&
        (!q || p.name.toLowerCase().includes(q) || p.nameLocal?.toLowerCase().includes(q)),
    );
  }, [products, query, group]);

  const count = Object.values(cart).reduce((a, b) => a + b, 0);
  const total = products.reduce((sum, p) => sum + (cart[p.id] ?? 0) * p.price, 0);
  const dynamicVariables = useMemo(() => ({ shop_name: shopName, channel: "web", language: lang }), [shopName, lang]);

  return (
    <>
      <div className="sticky top-0 z-20 -mx-4 mt-4 space-y-2 bg-paper/95 px-4 py-2 backdrop-blur">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t.search}
          className="w-full rounded-xl border border-line bg-card px-4 py-2.5 text-base focus:border-ink focus:outline-none"
        />
        {groups.length > 1 && (
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
            {[null, ...groups].map((g) => (
              <button
                key={g ?? "all"}
                type="button"
                onClick={() => setGroup(g)}
                className={`shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-semibold ${
                  group === g ? "border-ink bg-ink text-white" : "border-line bg-card text-ink"
                }`}
              >
                {g ?? t.all}
              </button>
            ))}
          </div>
        )}
      </div>

      {products.length === 0 ? (
        <p className="mt-8 text-center text-mute">{preview ? "Add products to see them here." : t.shopClosedDraft}</p>
      ) : (
        <ul className="mt-2 divide-y divide-line">
          {visible.map((p, i) => {
            const qty = cart[p.id] ?? 0;
            return (
              <li key={p.id} className="flex items-center gap-3 py-3">
                {p.imageId ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/api/images/${p.imageId}`} alt="" className="h-14 w-14 shrink-0 rounded-xl object-cover" loading="lazy" />
                ) : (
                  <span className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-xl font-display text-xl font-bold ${TILE_COLORS[i % TILE_COLORS.length]}`}>
                    {p.name.charAt(0)}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-semibold leading-snug">{p.name}</p>
                  {p.nameLocal && p.nameLocal !== p.name && (
                    <p lang={lang} className="truncate text-sm text-ink-soft">{p.nameLocal}</p>
                  )}
                  <p className="text-sm">
                    <span className="font-bold">₹{p.price}</span>
                    {p.size && <span className="text-mute"> / {p.size}</span>}
                  </p>
                </div>
                {qty === 0 ? (
                  <button
                    type="button"
                    onClick={() => setQty(p.id, 1)}
                    className="rounded-xl border-2 border-leaf px-4 py-1.5 font-bold text-leaf hover:bg-leaf hover:text-white"
                  >
                    {t.add}
                  </button>
                ) : (
                  <div className="flex items-center rounded-xl bg-leaf text-white">
                    <button type="button" aria-label="Remove one" onClick={() => setQty(p.id, qty - 1)} className="px-3 py-1.5 text-lg font-bold">−</button>
                    <span className="min-w-6 text-center font-bold">{qty}</span>
                    <button type="button" aria-label="Add one" onClick={() => setQty(p.id, qty + 1)} className="px-3 py-1.5 text-lg font-bold">+</button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {!preview && products.length > 0 && (
        <section className="mt-6 grid grid-cols-2 gap-2">
          <button type="button" onClick={() => setSheet("voice")} className="rounded-xl border-2 border-ink bg-turmeric px-3 py-3 font-semibold">
            {t.askMunshi}
          </button>
          <button type="button" onClick={() => setSheet("message")} className="rounded-xl border border-line bg-card px-3 py-3 font-semibold">
            {t.voiceNote}
          </button>
          {phoneLine && (
            <a href={`tel:${phoneLine.number}`} className="col-span-2 rounded-xl border border-line bg-card px-3 py-3 text-center font-semibold">
              {t.callToOrder}: {phoneLine.number} (code {phoneLine.code})
            </a>
          )}
        </section>
      )}

      {count > 0 && !sheet && (
        <div className="fixed inset-x-0 bottom-0 z-30 p-3">
          <Link
            href={preview ? "#" : `/s/${slug}/checkout`}
            aria-disabled={preview}
            className="mx-auto flex max-w-md items-center justify-between rounded-2xl bg-leaf px-5 py-4 text-white shadow-lg"
          >
            <span className="font-semibold">
              {count} {t.items}, ₹{total}
            </span>
            <span className="font-display text-lg font-bold">{t.viewCart}</span>
          </Link>
        </div>
      )}

      {sheet && (
        <div className="fixed inset-0 z-40 flex items-end bg-ink/40" onClick={() => setSheet(null)}>
          <div
            role="dialog"
            aria-modal="true"
            className="mx-auto max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-paper p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-display text-2xl font-bold">{sheet === "voice" ? t.askMunshi : t.voiceNote}</h2>
              <button type="button" onClick={() => setSheet(null)} aria-label={t.cancel} className="rounded-full px-3 py-1 text-2xl">×</button>
            </div>
            {sheet === "voice" ? (
              <VoiceAgent
                kind="order"
                shopSlug={slug}
                lang={lang}
                labels={t}
                firstMessage={firstMessage}
                dynamicVariables={dynamicVariables}
                clientTools={{
                  open_order: ({ order_code }) => {
                    router.push(`/s/${slug}/order/${String(order_code).replace(/\D/g, "")}`);
                    return "Opened the order status page for the buyer.";
                  },
                }}
                onFallbackText={async () => {
                  setSheet("message");
                  return "";
                }}
              />
            ) : (
              <OrderByMessage
                slug={slug}
                t={t}
                onAdd={(lines) => {
                  addMany(lines);
                  router.push(`/s/${slug}/checkout`);
                }}
              />
            )}
          </div>
        </div>
      )}
    </>
  );
}
