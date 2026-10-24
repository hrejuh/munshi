import type { AgentName } from "@prisma/client";
import { db } from "./db";

function summarize(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > 800 ? `${text.slice(0, 797)}...` : text;
}

export interface AgentLogInput {
  shopId?: string | null;
  agent: AgentName;
  action: string;
  input?: unknown;
  output?: unknown;
  runId?: string | null;
  provider?: string;
  confidence?: number | null;
  needsApproval?: boolean;
  approvedBy?: string | null;
}

/** Every agent action is written here with a timestamp (PRD guardrail + proof dashboard). */
export async function logAgent(entry: AgentLogInput) {
  try {
    return await db.agentLog.create({
      data: {
        shopId: entry.shopId ?? null,
        agent: entry.agent,
        action: entry.action,
        inputSummary: summarize(entry.input),
        outputSummary: summarize(entry.output),
        runId: entry.runId ?? null,
        provider: entry.provider ?? "munshi",
        confidence: entry.confidence ?? null,
        needsApproval: entry.needsApproval ?? false,
        approvedBy: entry.approvedBy ?? null,
        approvedAt: entry.approvedBy ? new Date() : null,
      },
    });
  } catch (err) {
    // Logging must never break the user-facing flow.
    console.error("agent log failed", err);
    return null;
  }
}
