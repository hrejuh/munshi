import type { Order, Shop, Buyer } from "@prisma/client";
import { db } from "./db";
import { env } from "./env";
import { rupees } from "./orders";
import { sendSms } from "./sms";

type OrderWithBuyer = Order & { buyer: Buyer };

export async function notifyOwner(shop: Shop, order: Order, type: string, message: string, sms = true) {
  await db.notification.create({ data: { shopId: shop.id, orderId: order.id, type, message } });
  if (sms) await sendSms(shop.phone, `Munshi: ${message} ${env.appUrl}/app/orders`, { shopId: shop.id, tag: type });
}

export function orderLink(shop: Pick<Shop, "slug">, order: Pick<Order, "code">) {
  return `${env.appUrl}/s/${shop.slug}/order/${order.code}`;
}

const BUYER_MESSAGES: Record<string, (shop: Shop, order: OrderWithBuyer) => string> = {
  order_placed: (s, o) =>
    `${s.name}: got your order #${o.code}, total ${rupees(o.total)}. Pay cash on ${o.fulfilment === "DELIVERY" ? "delivery" : "pickup"}. Track: ${orderLink(s, o)}`,
  accepted: (s, o) => `${s.name} accepted your order #${o.code}. Track: ${orderLink(s, o)}`,
  rejected: (s, o) => `${s.name} could not take order #${o.code}. Please call the shop.`,
  ready: (s, o) => `Your order #${o.code} is ready for pickup at ${s.name}.`,
  out_for_delivery: (s, o) => `Your order #${o.code} from ${s.name} is out for delivery.`,
};

export async function notifyBuyer(shop: Shop, order: OrderWithBuyer, event: keyof typeof BUYER_MESSAGES | string) {
  const build = BUYER_MESSAGES[event];
  if (!build) return;
  await sendSms(order.buyer.phone, build(shop, order), { shopId: shop.id, tag: `buyer_${event}` });
}
