import { OwnerNav } from "@/components/OwnerNav";
import { db } from "@/lib/db";
import { dict } from "@/lib/i18n";
import { requireShop } from "@/lib/session";

export default async function OwnerLayout({ children }: { children: React.ReactNode }) {
  const shop = await requireShop();
  const t = dict(shop.language);
  const newOrders = await db.order.count({ where: { shopId: shop.id, ownerDecision: "PENDING", status: "PLACED" } });
  return (
    <div lang={shop.language}>
      {children}
      <OwnerNav labels={{ home: t.home, products: t.products, orders: t.orders, settings: t.settings }} newOrders={newOrders} />
    </div>
  );
}
