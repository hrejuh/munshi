import type { Fulfilment, OrderChannel, Product } from "@prisma/client";
import { agenticOrgReady, runAgent } from "./agenticorg";
import { confidentMatch, findMatches } from "./catalog-match";
import { liveProducts } from "./catalog";
import { db } from "./db";
import { numericCode } from "./ids";
import { logAgent } from "./log";
import { notifyBuyer, notifyOwner } from "./notify";
import { computeTotals, rupees, validateOrder, type CartLine } from "./orders";

export interface RequestedItem {
  name: string;
  qty: number;
}

export interface Resolution {
  lines: CartLine[];
  /** Items we could not match confidently, with the closest suggestions to read back. */
  unclear: Array<{ said: string; suggestions: string[] }>;
}

function toLine(p: Product, qty: number): CartLine {
  return { productId: p.id, name: p.name, size: p.size, price: p.price, qty: Math.max(1, Math.min(99, Math.round(qty) || 1)) };
}

export function describe(p: Pick<Product, "name" | "size" | "price">) {
  return `${p.name}${p.size ? ` ${p.size}` : ""} ${rupees(p.price)}`;
}

export function resolveItems(products: Product[], items: RequestedItem[]): Resolution {
  const lines: CartLine[] = [];
  const unclear: Resolution["unclear"] = [];
  for (const item of items) {
    const match = confidentMatch(item.name, products);
    if (match) {
      const existing = lines.find((l) => l.productId === match.id);
      if (existing) existing.qty += item.qty || 1;
      else lines.push(toLine(match, item.qty));
    } else {
      unclear.push({ said: item.name, suggestions: findMatches(item.name, products, 3, 0.3).map((m) => describe(m.product)) });
    }
  }
  return { lines, unclear };
}

const QTY_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, ek: 1, do: 2, teen: 3, char: 4, paanch: 5,
  ondu: 1, eradu: 2, mooru: 3, onnu: 1, rendu: 2, moonu: 3, half: 1,
};

/** Fallback split of "2 maggi, 1 kg sugar and bread" into requested items. */
export function splitOrderText(text: string): RequestedItem[] {
  return text
    .split(/,|\n|\band\b|\baur\b|\bmattu\b|\bmatthu\b|\bum\b|&/i)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const m = part.match(/^(\d+|[a-z]+)\s*(?:x\s*)?(.*)$/i);
      if (m) {
        const n = /^\d+$/.test(m[1]) ? Number(m[1]) : QTY_WORDS[m[1].toLowerCase()];
        // "1 kg sugar": the number is a pack size, not a count.
        if (n && m[2] && !/^(kg|kilo|g|gm|gram|l|ltr|litre|ml)\b/i.test(m[2])) return { name: m[2], qty: n };
      }
      return { name: part, qty: 1 };
    });
}

/** F8: a free-text or voice-note order turned into a cart. Order agent first, fallback parser second. */
export async function parseOrderMessage(shopId: string, text: string): Promise<Resolution & { provider: string }> {
  const products = await liveProducts(shopId);
  if (agenticOrgReady("order")) {
    const run = await runAgent<{ lines?: Array<{ product_id?: string; qty?: number }>; unclear?: string[] }>(
      "order",
      "parse_order",
      {
        task: "A buyer sent this order to a small Indian shop, possibly in Kannada, Hindi, Tamil or English. Match each item to the catalog. Return JSON {lines:[{product_id, qty}], unclear:[text of items you could not match with confidence]}. Never add items the buyer did not ask for.",
        message: text,
        catalog: products.slice(0, 400).map((p) => ({ id: p.id, name: p.name, local: p.nameLocal, size: p.size, price: p.price })),
      },
      { shopId, timeoutMs: 20000 },
    );
    if (run.ok && Array.isArray(run.output.lines)) {
      const lines: CartLine[] = [];
      for (const l of run.output.lines) {
        const p = products.find((x) => x.id === l.product_id);
        if (p) lines.push(toLine(p, Number(l.qty) || 1));
      }
      const unclear = (run.output.unclear ?? []).map((said) => ({
        said,
        suggestions: findMatches(said, products, 3, 0.3).map((m) => describe(m.product)),
      }));
      if (lines.length || unclear.length) return { lines, unclear, provider: "agenticorg" };
    }
  }
  const resolution = resolveItems(products, splitOrderText(text));
  await logAgent({ shopId, agent: "ORDER", action: "parse_order", input: text, output: resolution, provider: "fallback" });
  return { ...resolution, provider: "fallback" };
}

export interface PlaceOrderInput {
  shopId: string;
  lines: Array<{ productId: string; qty: number }>;
  buyer: { name: string; phone: string; address?: string | null };
  fulfilment: Fulfilment;
  channel: OrderChannel;
  note?: string | null;
}

async function uniqueOrderCode() {
  for (let i = 0; i < 8; i++) {
    const code = numericCode(6);
    if (!(await db.order.findUnique({ where: { code }, select: { id: true } }))) return code;
  }
  return numericCode(8);
}

/**
 * Creates the order from server-side prices (never the client's), records the buyer for
 * "usual order" memory and alerts the owner, who must accept. Payment is cash on delivery/pickup.
 */
export async function placeOrder(input: PlaceOrderInput) {
  const shop = await db.shop.findUniqueOrThrow({ where: { id: input.shopId } });
  if (shop.status !== "LIVE") throw new Error("This shop is not taking orders yet");

  const ids = input.lines.map((l) => l.productId);
  const products = await db.product.findMany({ where: { id: { in: ids }, shopId: shop.id, status: "APPROVED", inStock: true } });
  const lines: CartLine[] = input.lines
    .map((l) => {
      const p = products.find((x) => x.id === l.productId);
      return p ? toLine(p, l.qty) : null;
    })
    .filter((l): l is CartLine => l !== null);

  const error = validateOrder(lines, shop, input.fulfilment, input.buyer.address);
  if (error) throw new Error(error);
  const totals = computeTotals(lines, shop, input.fulfilment);

  const buyer = await db.buyer.upsert({
    where: { shopId_phone: { shopId: shop.id, phone: input.buyer.phone } },
    create: { shopId: shop.id, name: input.buyer.name, phone: input.buyer.phone, address: input.buyer.address, orderCount: 1 },
    update: {
      name: input.buyer.name,
      address: input.buyer.address || undefined,
      orderCount: { increment: 1 },
    },
  });

  const order = await db.order.create({
    data: {
      code: await uniqueOrderCode(),
      shopId: shop.id,
      buyerId: buyer.id,
      items: lines as unknown as object,
      subtotal: totals.subtotal,
      deliveryFee: totals.deliveryFee,
      total: totals.total,
      channel: input.channel,
      fulfilment: input.fulfilment,
      address: input.fulfilment === "DELIVERY" ? input.buyer.address : null,
      note: input.note,
    },
    include: { buyer: true },
  });

  await logAgent({
    shopId: shop.id,
    agent: "ORDER",
    action: "order_created",
    input: { channel: input.channel, buyer: buyer.name, regular: buyer.orderCount > 1 },
    output: { code: order.code, total: order.total, items: lines.map((l) => `${l.qty}x ${l.name}`).join(", ") },
    needsApproval: true,
  });
  const summary = lines.map((l) => `${l.qty}x ${l.name}`).join(", ");
  await notifyOwner(
    shop,
    order,
    "new_order",
    `New ${input.fulfilment === "DELIVERY" ? "delivery" : "pickup"} order #${order.code} ${rupees(order.total)} from ${buyer.name}: ${summary}.`,
  );
  // Phone and message orders get the order link by SMS; web buyers see it on screen.
  if (input.channel === "PHONE" || input.channel === "MESSAGE") await notifyBuyer(shop, order, "order_placed");

  return { order, shop };
}

export async function usualOrder(shopId: string, phone: string) {
  const buyer = await db.buyer.findUnique({ where: { shopId_phone: { shopId, phone } } });
  if (!buyer) return null;
  const last = await db.order.findFirst({
    where: { buyerId: buyer.id, status: { not: "REJECTED" } },
    orderBy: { createdAt: "desc" },
  });
  return last ? { buyer, items: last.items as unknown as CartLine[], lastOrderAt: last.createdAt } : { buyer, items: [], lastOrderAt: null };
}
