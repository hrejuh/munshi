// Vobiz Messaging API: POST https://api.vobiz.ai/api/v1/sms/messages (X-Auth-ID / X-Auth-Token).
// Indian recipients need TRAI DLT IDs; without them carriers may drop the SMS, so in-app alerts
// and on-screen links remain the primary channel and SMS is best-effort.
import { env } from "./env";
import { logAgent } from "./log";

export function smsReady() {
  return Boolean(env.vobizAuthId && env.vobizAuthToken && env.vobizSmsFrom);
}

export async function sendSms(to: string, text: string, opts: { shopId?: string | null; tag?: string } = {}) {
  if (!smsReady() || !to) return { ok: false as const, error: "SMS not configured" };
  const body: Record<string, unknown> = {
    from: env.vobizSmsFrom,
    to: [to],
    channel: "sms",
    text,
    tag: opts.tag ?? "munshi",
  };
  if (to.startsWith("+91")) {
    if (env.vobizDltEntityId) body.dltEntityId = env.vobizDltEntityId;
    if (env.vobizDltHeaderId) body.dltHeaderId = env.vobizDltHeaderId;
    if (env.vobizDltTemplateId) body.dltTemplateId = env.vobizDltTemplateId;
  }
  try {
    const resp = await fetch("https://api.vobiz.ai/api/v1/sms/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Auth-ID": env.vobizAuthId,
        "X-Auth-Token": env.vobizAuthToken,
      },
      body: JSON.stringify(body),
    });
    const result = await resp.text();
    const ok = resp.status === 201 || resp.status === 202;
    await logAgent({
      shopId: opts.shopId,
      agent: "SYSTEM",
      action: ok ? "sms_sent" : "sms_failed",
      input: { to, tag: opts.tag },
      output: result.slice(0, 300),
      provider: "vobiz",
    });
    return ok ? { ok: true as const } : { ok: false as const, error: `HTTP ${resp.status}` };
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
  }
}
