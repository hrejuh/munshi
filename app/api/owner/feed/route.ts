import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentShopId } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Polled by owner screens: tells them when to refresh and chime for a new order. */
export async function GET() {
  const shopId = await currentShopId();
  if (!shopId) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  const [latest, pending] = await Promise.all([
    db.order.findFirst({ where: { shopId }, orderBy: { updatedAt: "desc" }, select: { updatedAt: true } }),
    db.order.count({ where: { shopId, ownerDecision: "PENDING", status: "PLACED" } }),
  ]);
  return NextResponse.json({ stamp: latest?.updatedAt.getTime() ?? 0, pending });
}
