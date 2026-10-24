import { Page } from "@/components/ui";
import { db } from "@/lib/db";
import { dict } from "@/lib/i18n";
import { availableActions, rupees, type CartLine } from "@/lib/orders";
import { requireShop } from "@/lib/session";
import { OrderCard } from "./OrderCard";
import { OrdersLive } from "./OrdersLive";

export const dynamic = "force-dynamic";

export default async function OrdersPage() {
  const shop = await requireShop();
  const t = dict(shop.language);
  const orders = await db.order.findMany({
    where: { shopId: shop.id },
    include: { buyer: true },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const counted = orders.filter((o) => o.status !== "REJECTED");
  const todayRevenue = counted.filter((o) => o.createdAt >= startOfDay).reduce((s, o) => s + o.total, 0);
  const allTime = await db.order.aggregate({ where: { shopId: shop.id, status: { not: "REJECTED" } }, _sum: { total: true }, _count: true });
  // Cash on delivery: a completed order is one the owner handed over and collected cash for.
  const collected = await db.order.aggregate({ where: { shopId: shop.id, status: "COMPLETED" }, _sum: { total: true } });

  const rank = (s: string) => (s === "PLACED" ? 0 : s === "ACCEPTED" || s === "READY" || s === "OUT_FOR_DELIVERY" ? 1 : 2);
  const sorted = [...orders].sort((a, b) => rank(a.status) - rank(b.status) || b.createdAt.getTime() - a.createdAt.getTime());

  return (
    <Page>
      <OrdersLive />
      <h1 className="font-display text-3xl font-extrabold">{t.orders}</h1>

      <section className="mt-4 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl border border-line bg-card px-2 py-3">
          <p className="text-xs text-mute">{t.today}</p>
          <p className="font-display text-xl font-bold">{rupees(todayRevenue)}</p>
        </div>
        <div className="rounded-xl border border-line bg-card px-2 py-3">
          <p className="text-xs text-mute">{t.allTime}</p>
          <p className="font-display text-xl font-bold">{rupees(allTime._sum.total ?? 0)}</p>
        </div>
        <div className="rounded-xl border border-line bg-card px-2 py-3">
          <p className="text-xs text-mute">{t.cashCollected}</p>
          <p className="font-display text-xl font-bold">{rupees(collected._sum.total ?? 0)}</p>
        </div>
      </section>

      {sorted.length === 0 ? (
        <p className="mt-10 text-center text-mute">{t.noOrders}</p>
      ) : (
        <div className="mt-5 space-y-3">
          {sorted.map((o) => (
            <OrderCard
              key={o.id}
              t={t}
              order={{
                id: o.id,
                code: o.code,
                status: o.status,
                channel: o.channel,
                fulfilment: o.fulfilment,
                total: o.total,
                address: o.address,
                note: o.note,
                createdAt: o.createdAt.toISOString(),
                buyer: { name: o.buyer.name, phone: o.buyer.phone, regular: o.buyer.orderCount > 1 },
                items: o.items as unknown as CartLine[],
                actions: availableActions(o.status, o.fulfilment),
              }}
            />
          ))}
        </div>
      )}
    </Page>
  );
}
