// Voice sessions carry a signed shop token (not a raw shop id) as an ElevenLabs dynamic variable,
// so a caller can't point the agent's tools at someone else's shop.
import { SignJWT, jwtVerify } from "jose";
import { env } from "./env";

export type VoiceScope = "setup" | "order";

function key() {
  return new TextEncoder().encode(env.sessionSecret);
}

export async function signVoiceToken(shopId: string, scope: VoiceScope, extra: Record<string, string> = {}) {
  return new SignJWT({ shopId, scope, ...extra })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("6h")
    .sign(key());
}

export async function verifyVoiceToken(token: string): Promise<{ shopId: string; scope: VoiceScope; caller?: string } | null> {
  try {
    const { payload } = await jwtVerify(token, key());
    if (typeof payload.shopId !== "string" || (payload.scope !== "setup" && payload.scope !== "order")) return null;
    return { shopId: payload.shopId, scope: payload.scope, caller: typeof payload.caller === "string" ? payload.caller : undefined };
  } catch {
    return null;
  }
}
