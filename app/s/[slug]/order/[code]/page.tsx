import Link from "next/link";
import { notFound } from "next/navigation";
import { AutoRefresh } from "@/components/AutoRefresh";
import { Page } from "@/components/ui";
import { db } from "@/lib/db";
import { dict } from "@/lib/i18n";
import type { CartLine } from "@/lib/orders";
import { rupees } from "@/lib/orders";

export const dynamic = "force-dynamic";

export default async function OrderStatusPage({ params }: { params: Promise<{ slug: string; code: string }> }) {
  const { slug, code } = await params;
  const order = await db.order.findUnique({ where: { code }, include: { shop: true } });
  if (!order || order.shop.slug !== slug) notFound();
  const t = dict(order.shop.language);
  const items = order.items as unknown as CartLine[];

  const finalStep = order.fulfilment === "DELIVERY" ? t.statusOutForDelivery : t.statusReady;
  const steps = [
    { label: t.statusPlaced, done: true },
    { label: t.statusAccepted, done: ["ACCEPTED", "READY", "OUT_FOR_DELIVERY", "COMPLETED"].includes(order.status) },
    { label: finalStep, done: ["READY", "OUT_FOR_DELIVERY", "COMPLETED"].includes(order.status) },
    { label: t.statusCompleted, done: order.status === "COMPLETED" },
  ];
  const rejected = order.status === "REJECTED";
  const live = !rejected && order.status !== "COMPLETED";

  return (
    <Page>
      {live && <AutoRefresh />}
      <div lang={order.shop.language}>
        <p className="text-ink-soft">{order.shop.name}</p>
        <h1 className="font-display text-3xl font-extrabold">
          {t.orderStatus} #{order.code}
        </h1>

        {live && (
          <p className="mt-4 rounded-xl bg-turmeric/20 px-4 py-3 text-sm font-semibold">
            {t.payCash}: {rupees(order.total)}
          </p>
        )}

        {rejected ? (
          <p className="mt-6 rounded-xl bg-sindoor/10 px-4 py-4 font-semibold text-sindoor">{t.statusRejected}</p>
        ) : (
          <ol className="mt-6 space-y-0">
            {steps.map((s, i) => (
              <li key={s.label} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <span className={`flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold ${s.done ? "bg-leaf text-white" : "border-2 border-line bg-card"}`}>
                    {s.done ? "✓" : ""}
                  </span>
                  {i < steps.length - 1 && <span className={`h-7 w-0.5 ${s.done ? "bg-leaf" : "bg-line"}`} />}
                </div>
                <p className={`pt-0.5 font-semibold ${s.done ? "" : "text-mute"}`}>{s.label}</p>
              </li>
            ))}
          </ol>
        )}

        <section className="mt-8 rounded-xl border border-line bg-card p-4">
          <ul className="space-y-1.5">
            {items.map((l) => (
              <li key={l.productId} className="flex justify-between gap-3 text-[15px]">
                <span>{l.qty} × {l.name}{l.size ? ` (${l.size})` : ""}</span>
                <span>{rupees(l.price * l.qty)}</span>
              </li>
            ))}
            {order.deliveryFee > 0 && (
              <li className="flex justify-between text-ink-soft"><span>{t.deliveryFee}</span><span>{rupees(order.deliveryFee)}</span></li>
            )}
          </ul>
          <p className="mt-3 flex justify-between border-t border-line pt-3 font-display text-xl font-bold">
            <span>{t.total}</span>
            <span>{rupees(order.total)}</span>
          </p>
          <p className="mt-2 text-sm text-mute">{order.fulfilment === "DELIVERY" ? `${t.delivery}: ${order.address}` : `${t.pickup}: ${order.shop.address ?? ""}`}</p>
        </section>

        <Link href={`/s/${slug}`} className="mt-6 block text-center font-semibold text-leaf underline">{t.backToShop}</Link>
      </div>
    </Page>
  );
}
