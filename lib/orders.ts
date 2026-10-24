import type { DeliveryMode, Fulfilment, OrderStatus } from "@prisma/client";

export interface CartLine {
  productId: string;
  name: string;
  size?: string | null;
  price: number;
  qty: number;
}

export interface ShopPricing {
  deliveryMode: DeliveryMode;
  deliveryFee: number;
  minOrder: number;
}

export function computeTotals(lines: CartLine[], shop: ShopPricing, fulfilment: Fulfilment) {
  const subtotal = lines.reduce((sum, l) => sum + l.price * l.qty, 0);
  const deliveryFee = fulfilment === "DELIVERY" ? shop.deliveryFee : 0;
  return { subtotal, deliveryFee, total: subtotal + deliveryFee };
}

/** Returns an error message when the order can't be placed, or null if it's fine. */
export function validateOrder(lines: CartLine[], shop: ShopPricing, fulfilment: Fulfilment, address?: string | null) {
  if (lines.length === 0) return "Cart is empty";
  if (lines.some((l) => !Number.isInteger(l.qty) || l.qty < 1 || l.qty > 99)) return "Invalid quantity";
  if (fulfilment === "DELIVERY" && shop.deliveryMode === "PICKUP") return "This shop offers pickup only";
  if (fulfilment === "PICKUP" && shop.deliveryMode === "DELIVERY") return "This shop offers delivery only";
  if (fulfilment === "DELIVERY" && !address?.trim()) return "Delivery address is required";
  const { subtotal } = computeTotals(lines, shop, fulfilment);
  if (shop.minOrder > 0 && subtotal < shop.minOrder) return `Minimum order is ₹${shop.minOrder}`;
  return null;
}

export type OwnerAction = "accept" | "reject" | "ready" | "out_for_delivery" | "complete";

const TRANSITIONS: Record<OwnerAction, { from: OrderStatus[]; to: OrderStatus }> = {
  accept: { from: ["PLACED"], to: "ACCEPTED" },
  reject: { from: ["PLACED"], to: "REJECTED" },
  ready: { from: ["ACCEPTED"], to: "READY" },
  out_for_delivery: { from: ["ACCEPTED", "READY"], to: "OUT_FOR_DELIVERY" },
  complete: { from: ["READY", "OUT_FOR_DELIVERY"], to: "COMPLETED" },
};

export function nextStatus(current: OrderStatus, action: OwnerAction): OrderStatus | null {
  const rule = TRANSITIONS[action];
  return rule.from.includes(current) ? rule.to : null;
}

export function availableActions(status: OrderStatus, fulfilment: Fulfilment): OwnerAction[] {
  switch (status) {
    case "PLACED":
      return ["accept", "reject"];
    case "ACCEPTED":
      return fulfilment === "DELIVERY" ? ["out_for_delivery"] : ["ready"];
    case "READY":
    case "OUT_FOR_DELIVERY":
      return ["complete"];
    default:
      return [];
  }
}

export function rupees(amount: number) {
  return `₹${amount.toLocaleString("en-IN")}`;
}
