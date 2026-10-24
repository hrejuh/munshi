import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSignedUrl, voiceReady } from "@/lib/elevenlabs";
import { currentShop } from "@/lib/session";
import { signVoiceToken } from "@/lib/voice-token";

export const dynamic = "force-dynamic";

/** Returns a one-time ElevenLabs signed URL plus the signed shop token the agent's tools need. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind") === "order" ? "order" : "setup";

  let shopId: string;
  if (kind === "setup") {
    const shop = await currentShop();
    if (!shop) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
    shopId = shop.id;
  } else {
    const slug = url.searchParams.get("shop") ?? "";
    const shop = await db.shop.findUnique({ where: { slug }, select: { id: true, status: true } });
    if (!shop || shop.status !== "LIVE") return NextResponse.json({ error: "Shop not found" }, { status: 404 });
    shopId = shop.id;
  }

  if (!voiceReady()) return NextResponse.json({ error: "Voice not configured" }, { status: 503 });
  try {
    const [signedUrl, shopToken] = await Promise.all([getSignedUrl(kind), signVoiceToken(shopId, kind)]);
    return NextResponse.json({ signedUrl, shopToken });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Voice service unavailable" }, { status: 502 });
  }
}
