import Link from "next/link";
import { ButtonLink, Page, Pill } from "@/components/ui";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { dict } from "@/lib/i18n";
import { rupees } from "@/lib/orders";
import { requireShop } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function OwnerHome() {
  const shop = await requireShop();
  const t = dict(shop.language);
  const [approved, drafts, pending] = await Promise.all([
    db.product.count({ where: { shopId: shop.id, status: "APPROVED" } }),
    db.product.count({ where: { shopId: shop.id, status: "DRAFT" } }),
    db.order.count({ where: { shopId: shop.id, ownerDecision: "PENDING", status: "PLACED" } }),
  ]);
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const today = await db.order.aggregate({
    where: { shopId: shop.id, createdAt: { gte: startOfDay }, status: { not: "REJECTED" } },
    _sum: { total: true },
    _count: true,
  });

  // Setup is a real sequence, so numbered steps carry meaning here.
  const steps = [
    { done: Boolean(shop.name && shop.address && shop.timings), title: t.talkTitle, href: "/app/onboard" },
    { done: shop.status === "LIVE", title: t.approveStore, href: "/app/preview" },
    { done: approved > 0, title: t.addProducts, href: "/app/products" },
  ];
  const next = steps.find((s) => !s.done);
  const storeUrl = `${env.appUrl}/s/${shop.slug}`;

  return (
    <Page>
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-mute">{shop.ownerName}</p>
          <h1 className="font-display text-3xl font-extrabold">{shop.name ?? "Munshi"}</h1>
        </div>
        <Pill tone={shop.status === "LIVE" ? "leaf" : "turmeric"}>{shop.status === "LIVE" ? t.live : t.draft}</Pill>
      </header>

      {next ? (
        <section className="mt-6">
          <ol className="space-y-2.5">
            {steps.map((s, i) => (
              <li key={s.href}>
                <Link
                  href={s.href}
                  className={`flex items-center gap-3 rounded-xl border px-4 py-3.5 ${
                    s === next ? "border-2 border-ink bg-turmeric/25" : "border-line bg-card"
                  }`}
                >
                  <span
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-display font-bold ${
                      s.done ? "bg-leaf text-white" : "border-2 border-ink"
                    }`}
                  >
                    {s.done ? "✓" : i + 1}
                  </span>
                  <span className={`font-semibold ${s.done ? "text-mute line-through" : ""}`}>{s.title}</span>
                </Link>
              </li>
            ))}
          </ol>
          <ButtonLink href={next.href} className="mt-5 w-full py-4 text-lg">
            {next.title}
          </ButtonLink>
        </section>
      ) : (
        <section className="mt-6 grid grid-cols-2 gap-3">
          <Link href="/app/orders" className="rounded-xl border border-line bg-card p-4">
            <p className="text-sm text-mute">{t.orders}</p>
            <p className="font-display text-3xl font-extrabold">{pending}</p>
            <p className="text-xs text-mute">waiting for you</p>
          </Link>
          <div className="rounded-xl border border-line bg-card p-4">
            <p className="text-sm text-mute">{t.today}</p>
            <p className="font-display text-3xl font-extrabold">{rupees(today._sum.total ?? 0)}</p>
            <p className="text-xs text-mute">{today._count} orders</p>
          </div>
        </section>
      )}

      {drafts > 0 && (
        <Link href="/app/products/drafts" className="mt-4 flex items-center justify-between rounded-xl bg-ink px-4 py-3.5 text-white">
          <span className="font-semibold">{t.reviewDrafts}</span>
          <span className="rounded-full bg-turmeric px-2.5 py-0.5 text-sm font-bold text-ink">{drafts}</span>
        </Link>
      )}

      {shop.status === "LIVE" && (
        <section className="mt-6 rounded-xl border border-line bg-card p-4">
          <h2 className="font-display text-lg font-bold">{t.shareStore}</h2>
          <a href={storeUrl} className="mt-1 block break-all text-sm font-semibold text-leaf underline">
            {storeUrl}
          </a>
          {env.munshiNumber && (
            <p className="mt-2 text-sm text-ink-soft">
              {t.callToOrder}: <strong>{env.munshiNumber}</strong>, shop code <strong>{shop.shopCode}</strong>
            </p>
          )}
          <ButtonLink href="/app/settings" tone="plain" className="mt-3 w-full">
            QR code and WhatsApp share
          </ButtonLink>
        </section>
      )}
    </Page>
  );
}
