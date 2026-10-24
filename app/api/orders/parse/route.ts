import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { parseOrderMessage } from "@/lib/order-service";

export const dynamic = "force-dynamic";

/** F8 typed message: "2 maggi, 1 amul butter" turned into cart lines the buyer confirms before ordering. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { shop?: string; text?: string };
  const text = (body.text ?? "").trim().slice(0, 1000);
  if (!text) return NextResponse.json({ error: "Type what you need" }, { status: 400 });
  const shop = await db.shop.findUnique({ where: { slug: body.shop ?? "" } });
  if (!shop || shop.status !== "LIVE") return NextResponse.json({ error: "Shop not found" }, { status: 404 });
  const parsed = await parseOrderMessage(shop.id, text);
  return NextResponse.json({ text, lines: parsed.lines, unclear: parsed.unclear });
}
