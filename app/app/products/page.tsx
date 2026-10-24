import Link from "next/link";
import { Page } from "@/components/ui";
import { db } from "@/lib/db";
import { dict } from "@/lib/i18n";
import { requireShop } from "@/lib/session";
import { LiveProducts } from "./LiveProducts";

export const dynamic = "force-dynamic";

export default async function ProductsPage() {
  const shop = await requireShop();
  const t = dict(shop.language);
  const [products, drafts] = await Promise.all([
    db.product.findMany({ where: { shopId: shop.id, status: "APPROVED" }, orderBy: [{ category: "asc" }, { name: "asc" }] }),
    db.product.count({ where: { shopId: shop.id, status: "DRAFT" } }),
  ]);
  const tiles = [
    { href: "/app/products/template", title: t.pickFromList, hint: t.pickFromListHint, icon: "☑" },
    { href: "/app/products/add?mode=photo", title: t.photoSpeak, hint: t.photoSpeakHint, icon: "📷" },
    { href: "/app/products/add?mode=voice", title: t.speakItem, hint: t.speakItemHint, icon: "🎙" },
  ];
  return (
    <Page>
      <h1 className="font-display text-3xl font-extrabold">{t.addProducts}</h1>
      <div className="mt-5 grid gap-3">
        {tiles.map((tile) => (
          <Link key={tile.href} href={tile.href} className="flex items-center gap-4 rounded-xl border-2 border-ink bg-card px-4 py-4 shadow-[0_3px_0_var(--color-ink)] active:translate-y-0.5 active:shadow-none">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-turmeric text-2xl" aria-hidden>{tile.icon}</span>
            <span>
              <span className="block font-display text-xl font-bold">{tile.title}</span>
              <span className="block text-sm text-ink-soft">{tile.hint}</span>
            </span>
          </Link>
        ))}
      </div>

      {drafts > 0 && (
        <Link href="/app/products/drafts" className="mt-4 flex items-center justify-between rounded-xl bg-ink px-4 py-3.5 text-white">
          <span className="font-semibold">{t.reviewDrafts}</span>
          <span className="rounded-full bg-turmeric px-2.5 py-0.5 text-sm font-bold text-ink">{drafts}</span>
        </Link>
      )}

      <h2 className="mt-8 font-display text-xl font-bold">
        {t.products} <span className="text-mute">({products.length})</span>
      </h2>
      <LiveProducts
        t={t}
        products={products.map((p) => ({ id: p.id, name: p.name, size: p.size, price: p.price, inStock: p.inStock, nameLocal: p.nameLocal }))}
      />
    </Page>
  );
}
