import { NextResponse } from "next/server";
import { draftsFromDescription } from "@/lib/catalog";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { transcribe } from "@/lib/elevenlabs";
import { parseOrderMessage } from "@/lib/order-service";
import { currentShop } from "@/lib/session";

export const dynamic = "force-dynamic";

const STT_LANG: Record<string, string> = { en: "eng", hi: "hin", kn: "kan", ta: "tam" };

/**
 * Push-to-talk speech: ElevenLabs Scribe transcribes, then
 *  - purpose=item  (owner): the Catalog agent drafts product cards (optionally with a photo)
 *  - purpose=order (buyer voice note, F8): the Order agent turns it into a cart to confirm
 */
export async function POST(req: Request) {
  if (!env.elevenLabsKey) return NextResponse.json({ error: "Voice is not configured. Type instead." }, { status: 503 });
  const form = await req.formData();
  const audio = form.get("audio");
  const purpose = String(form.get("purpose") ?? "item");
  if (!(audio instanceof Blob) || audio.size === 0) return NextResponse.json({ error: "No audio received" }, { status: 400 });
  if (audio.size > 10 * 1024 * 1024) return NextResponse.json({ error: "Recording too long" }, { status: 413 });

  try {
    if (purpose === "order") {
      const shop = await db.shop.findUnique({ where: { slug: String(form.get("shop") ?? "") } });
      if (!shop || shop.status !== "LIVE") return NextResponse.json({ error: "Shop not found" }, { status: 404 });
      const { text } = await transcribe(audio);
      if (!text) return NextResponse.json({ error: "Nothing was heard. Try again closer to the phone." }, { status: 422 });
      const parsed = await parseOrderMessage(shop.id, text);
      return NextResponse.json({ text, lines: parsed.lines, unclear: parsed.unclear });
    }

    const shop = await currentShop();
    if (!shop) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
    const { text } = await transcribe(audio, STT_LANG[shop.language]);
    if (!text) return NextResponse.json({ error: "Nothing was heard. Try again." }, { status: 422 });
    // Spoken price lists on the template screen are matched in the browser.
    if (purpose === "transcribe") return NextResponse.json({ text });
    const imageId = String(form.get("imageId") ?? "") || null;
    const { drafts } = await draftsFromDescription(shop.id, text, {
      language: shop.language,
      imageId,
      source: imageId ? "PHOTO" : "VOICE",
    });
    return NextResponse.json({ text, drafts: drafts.map((d) => ({ id: d.id, name: d.name, size: d.size, price: d.price })) });
  } catch (err) {
    console.error("stt failed", err);
    return NextResponse.json({ error: "Speech service is unavailable. Type instead." }, { status: 502 });
  }
}
