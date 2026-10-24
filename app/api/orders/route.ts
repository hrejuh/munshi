import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { normalizePhone } from "@/lib/ids";
import { placeOrder } from "@/lib/order-service";

export const dynamic = "force-dynamic";

const OrderInput = z.object({
  shop: z.string().min(1),
  lines: z.array(z.object({ productId: z.string(), qty: z.number().int().min(1).max(99) })).min(1).max(100),
  name: z.string().trim().min(1).max(80),
  phone: z.string().min(6).max(20),
  fulfilment: z.enum(["DELIVERY", "PICKUP"]),
  address: z.string().max(400).optional(),
  note: z.string().max(400).optional(),
  channel: z.enum(["WEB", "MESSAGE"]).default("WEB"),
});

/** Buyer checkout from the store link (F7): creates the order; the buyer pays cash on delivery or pickup. */
export async function POST(req: Request) {
  const parsed = OrderInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Please check your details and try again" }, { status: 400 });
  const input = parsed.data;
  const phone = normalizePhone(input.phone);
  if (!/^\+\d{10,15}$/.test(phone)) return NextResponse.json({ error: "Enter a valid phone number" }, { status: 400 });

  const shop = await db.shop.findUnique({ where: { slug: input.shop } });
  if (!shop) return NextResponse.json({ error: "Shop not found" }, { status: 404 });

  try {
    const { order } = await placeOrder({
      shopId: shop.id,
      lines: input.lines,
      buyer: { name: input.name, phone, address: input.address },
      fulfilment: input.fulfilment,
      channel: input.channel,
      note: input.note,
    });
    return NextResponse.json({ code: order.code, total: order.total });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not place order" }, { status: 400 });
  }
}
