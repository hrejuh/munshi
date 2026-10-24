import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyToolSecret } from "@/lib/elevenlabs";
import { FIRST_MESSAGES, isLang } from "@/lib/i18n";
import { normalizePhone } from "@/lib/ids";
import { logAgent } from "@/lib/log";
import { signVoiceToken } from "@/lib/voice-token";

export const dynamic = "force-dynamic";

/**
 * ElevenLabs conversation-initiation webhook for phone calls (Vobiz SIP -> ElevenLabs).
 * Maps the dialled number to a shop and the caller ID to a returning buyer, and hands the agent
 * signed tokens so its tools act for the right shop and caller.
 */
export async function POST(req: Request) {
  if (!verifyToolSecret(req.headers.get("x-munshi-secret"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as { caller_id?: string; called_number?: string; call_sid?: string };
  const caller = normalizePhone(body.caller_id ?? "");
  const called = normalizePhone(body.called_number ?? "");

  // A shop with its own Munshi number is picked automatically; on the shared number the agent asks for the shop code.
  const shop = called ? await db.shop.findFirst({ where: { munshiNumber: called, status: "LIVE" } }) : null;
  const buyer = shop && caller ? await db.buyer.findUnique({ where: { shopId_phone: { shopId: shop.id, phone: caller } } }) : null;

  const lang = shop && isLang(shop.language) ? shop.language : "en";
  const dynamicVariables = {
    channel: "phone",
    call_token: await signVoiceToken("", "order", { caller }),
    shop_token: shop ? await signVoiceToken(shop.id, "order", { caller }) : "",
    shop_name: shop?.name ?? "Munshi",
    shop_selected: Boolean(shop),
    caller_phone: caller,
    customer_name: buyer?.name ?? "",
    returning_customer: Boolean(buyer && buyer.orderCount > 0),
    delivery_mode: shop?.deliveryMode ?? "",
  };

  await logAgent({
    shopId: shop?.id ?? null,
    agent: "VOICE",
    action: "phone_call_started",
    input: { caller, called, callSid: body.call_sid },
    output: { shop: shop?.name ?? "shared line", returning: dynamicVariables.returning_customer },
    provider: "elevenlabs",
  });

  return NextResponse.json({
    type: "conversation_initiation_client_data",
    dynamic_variables: dynamicVariables,
    conversation_config_override: {
      agent: {
        language: lang,
        first_message: shop
          ? FIRST_MESSAGES[lang].order.replace("{{shop_name}}", shop.name ?? "")
          : "Namaste! This is Munshi. Please tell me the shop code of the shop you want to order from.",
      },
    },
  });
}
