import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyWebhookSignature } from "@/lib/elevenlabs";
import { logAgent } from "@/lib/log";
import { verifyVoiceToken } from "@/lib/voice-token";

export const dynamic = "force-dynamic";

interface PostCallBody {
  type?: string;
  data?: {
    conversation_id?: string;
    agent_id?: string;
    transcript?: Array<{ role: string; message: string | null }>;
    conversation_initiation_client_data?: { dynamic_variables?: Record<string, unknown> };
    metadata?: { phone_call?: { external_number?: string } ; call_duration_secs?: number };
  };
}

/** ElevenLabs post-call webhook (HMAC-signed): stores transcripts as proof of agent activity. */
export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifyWebhookSignature(raw, req.headers.get("elevenlabs-signature"))) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }
  const body = JSON.parse(raw) as PostCallBody;
  if (body.type !== "post_call_transcription" || !body.data?.conversation_id) return NextResponse.json({ ok: true });

  const vars = body.data.conversation_initiation_client_data?.dynamic_variables ?? {};
  const token = typeof vars.shop_token === "string" ? vars.shop_token : "";
  const claims = token ? await verifyVoiceToken(token) : null;
  const channel = String(vars.channel ?? "web");
  const transcript = (body.data.transcript ?? []).filter((t) => t.message).map((t) => ({ role: t.role, message: t.message }));

  await db.conversation.upsert({
    where: { elConversationId: body.data.conversation_id },
    create: {
      elConversationId: body.data.conversation_id,
      shopId: claims?.shopId || null,
      kind: claims?.scope === "setup" ? "ONBOARDING" : "ORDER",
      channel,
      caller: body.data.metadata?.phone_call?.external_number ?? null,
      transcript,
    },
    update: { transcript },
  });
  await logAgent({
    shopId: claims?.shopId || null,
    agent: "VOICE",
    action: channel === "phone" ? "phone_call_completed" : "voice_session_completed",
    input: { conversationId: body.data.conversation_id, turns: transcript.length },
    output: { durationSecs: body.data.metadata?.call_duration_secs },
    provider: "elevenlabs",
  });
  return NextResponse.json({ ok: true });
}
