import { NextResponse } from "next/server";
import { verifyToolSecret } from "@/lib/elevenlabs";
import { runVoiceTool } from "@/lib/voice-tools";

export const dynamic = "force-dynamic";

/** ElevenLabs server-tool webhook. Each agent tool posts its arguments here as JSON. */
export async function POST(req: Request, { params }: { params: Promise<{ tool: string }> }) {
  if (!verifyToolSecret(req.headers.get("x-munshi-secret"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { tool } = await params;
  const args = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const { status, body } = await runVoiceTool(tool, args);
  return NextResponse.json(body, { status });
}
