import { db } from "./db";
import { logAgent } from "./log";
import { notifyBuyer } from "./notify";
import { nextStatus, type OwnerAction } from "./orders";

/**
 * The owner's one-tap decisions on an order. Accept/reject is the PRD's required human approval.
 * Orders are cash on delivery/pickup, so "complete" also means the owner collected the cash.
 */
export async function applyOwnerAction(shopId: string, orderId: string, action: OwnerAction) {
  const order = await db.order.findFirst({ where: { id: orderId, shopId }, include: { buyer: true, shop: true } });
  if (!order) throw new Error("Order not found");

  const to = nextStatus(order.status, action);
  if (!to) throw new Error(`Cannot ${action.replace(/_/g, " ")} an order that is ${order.status.toLowerCase()}`);

  const updated = await db.order.update({
    where: { id: orderId },
    data: {
      status: to,
      ...(action === "accept" || action === "reject"
        ? { ownerDecision: action === "accept" ? "ACCEPTED" : "REJECTED", decidedAt: new Date() }
        : {}),
    },
    include: { buyer: true },
  });
  await logAgent({
    shopId,
    agent: "ORDER",
    action: `order_${action}`,
    input: { code: order.code },
    output: { from: order.status, to, ...(action === "complete" ? { cashCollected: order.total } : {}) },
    approvedBy: action === "accept" || action === "reject" ? "owner" : null,
  });
  await db.notification.updateMany({ where: { orderId, readAt: null }, data: { readAt: new Date() } });
  const event = action === "accept" ? "accepted" : action === "reject" ? "rejected" : action;
  await notifyBuyer(order.shop, updated, event);
  return updated;
}
