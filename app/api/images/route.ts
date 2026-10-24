import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { currentShop } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Owner product photos, already resized in the browser, stored in Postgres (Render disks are ephemeral). */
export async function POST(req: Request) {
  const shop = await currentShop();
  if (!shop) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  const form = await req.formData();
  const file = form.get("image");
  if (!(file instanceof Blob)) return NextResponse.json({ error: "No image" }, { status: 400 });
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return NextResponse.json({ error: "Use a JPEG, PNG or WebP photo" }, { status: 415 });
  if (file.size > 1.5 * 1024 * 1024) return NextResponse.json({ error: "Photo too large" }, { status: 413 });
  const image = await db.image.create({
    data: { shopId: shop.id, mime: file.type, bytes: Buffer.from(await file.arrayBuffer()) },
  });
  return NextResponse.json({ id: image.id });
}
