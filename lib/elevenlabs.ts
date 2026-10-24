import { createHmac, timingSafeEqual } from "node:crypto";
import { syncVoiceAgents } from "./elevenlabs-agents";
import { env } from "./env";
import { logAgent } from "./log";

const API = "https://api.elevenlabs.io";

export type VoiceAgentKind = "setup" | "order";

export function voiceReady() {
  return Boolean(env.elevenLabsKey);
}

let synced: Promise<Record<VoiceAgentKind, string>> | null = null;

/**
 * Agent IDs from env when set; otherwise the server creates/updates its two agents once per boot,
 * so ELEVENLABS_API_KEY is the only voice setting a deploy needs.
 */
async function resolveAgentId(kind: VoiceAgentKind): Promise<string> {
  const pinned = kind === "setup" ? env.elevenSetupAgentId : env.elevenOrderAgentId;
  if (pinned) return pinned;
  synced ??= syncVoiceAgents({
    apiKey: env.elevenLabsKey,
    appUrl: env.appUrl,
    toolSecret: env.voiceToolSecret,
    llm: env.elevenLlm,
    ttsModel: env.elevenTtsModel,
    voiceId: env.elevenVoiceId,
  }).then(
    async (ids) => {
      await logAgent({ agent: "VOICE", action: "voice_agents_synced", output: ids, provider: "elevenlabs" });
      return ids;
    },
    async (err) => {
      synced = null; // retry on the next voice request
      await logAgent({ agent: "VOICE", action: "voice_agents_synced:failed", output: String(err), provider: "elevenlabs" });
      throw err;
    },
  );
  return (await synced)[kind];
}

/** Signed URL so the browser can talk to the agent without seeing our API key. */
export async function getSignedUrl(kind: VoiceAgentKind): Promise<string> {
  const agentId = await resolveAgentId(kind);
  const resp = await fetch(`${API}/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(agentId)}`, {
    headers: { "xi-api-key": env.elevenLabsKey },
    cache: "no-store",
  });
  if (!resp.ok) throw new Error(`ElevenLabs signed URL failed: HTTP ${resp.status} ${await resp.text()}`);
  const data = (await resp.json()) as { signed_url: string };
  return data.signed_url;
}

/** ElevenLabs Scribe speech-to-text for push-to-talk item entry and buyer voice notes. */
export async function transcribe(audio: Blob, languageCode?: string): Promise<{ text: string; language: string | null }> {
  const form = new FormData();
  form.append("model_id", env.elevenSttModel);
  form.append("file", audio, "speech.webm");
  if (languageCode) form.append("language_code", languageCode);
  const resp = await fetch(`${API}/v1/speech-to-text`, {
    method: "POST",
    headers: { "xi-api-key": env.elevenLabsKey },
    body: form,
  });
  if (!resp.ok) throw new Error(`ElevenLabs STT failed: HTTP ${resp.status} ${await resp.text()}`);
  const data = (await resp.json()) as { text?: string; language_code?: string };
  return { text: (data.text ?? "").trim(), language: data.language_code ?? null };
}

/**
 * Verifies the `ElevenLabs-Signature: t=<unix>,v0=<hex>` header on post-call webhooks
 * (HMAC-SHA256 of `${t}.${rawBody}` with the webhook secret), rejecting stale timestamps.
 */
export function verifyWebhookSignature(rawBody: string, header: string | null, secret = env.elevenWebhookSecret) {
  if (!secret || !header) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.trim().split("=") as [string, string]));
  const t = Number(parts.t);
  if (!t || !parts.v0 || Math.abs(Date.now() / 1000 - t) > 30 * 60) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(parts.v0);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Server tools carry a shared secret header configured by scripts/setup-elevenlabs.ts. */
export function verifyToolSecret(header: string | null) {
  if (!env.voiceToolSecret) return process.env.NODE_ENV !== "production";
  if (!header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(env.voiceToolSecret);
  return a.length === b.length && timingSafeEqual(a, b);
}
