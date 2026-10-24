// AgenticOrg (Pine Labs) client: runs Munshi's Onboarding, Catalog and Order agents.
// Routes and response shapes follow agenticorg-sdk@0.4.0 (POST /api/v1/agents/{id}/run).
import type { AgentName } from "@prisma/client";
import { env } from "./env";
import { logAgent } from "./log";

export type AgentRole = "onboarding" | "catalog" | "order";

const ROLE_TO_LOG: Record<AgentRole, AgentName> = {
  onboarding: "ONBOARDING",
  catalog: "CATALOG",
  order: "ORDER",
};

export interface AgentRun<T> {
  ok: true;
  output: T;
  runId: string;
  confidence: number;
  toolCalls: Array<Record<string, unknown>>;
  /** Set when AgenticOrg's own HITL policy paused the run for human review. */
  hitl: string | null;
  raw: Record<string, unknown>;
}

export interface AgentFailure {
  ok: false;
  error: string;
}

export function agenticOrgReady(role: AgentRole): boolean {
  return Boolean(env.agenticOrgKey && env.agenticOrgAgents[role]);
}

/** Agent output is often JSON inside a text field; pull the first JSON object out of it. */
export function extractJson(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    for (const key of ["result", "response", "text", "content", "answer", "output"]) {
      if (key in obj) {
        const nested = extractJson(obj[key]);
        if (nested) return nested;
      }
    }
    return obj;
  }
  if (typeof value !== "string") return null;
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : value;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

export interface RunOptions {
  shopId?: string | null;
  timeoutMs?: number;
}

export async function runAgent<T = Record<string, unknown>>(
  role: AgentRole,
  action: string,
  inputs: Record<string, unknown>,
  opts: RunOptions = {},
): Promise<AgentRun<T> | AgentFailure> {
  const agentId = env.agenticOrgAgents[role];
  if (!env.agenticOrgKey || !agentId) {
    return { ok: false, error: "AgenticOrg is not configured" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20000);
  try {
    const body: Record<string, unknown> = { action, inputs, context: { source: "munshi", role } };
    if (env.agenticOrgCompanyId) body.company_id = env.agenticOrgCompanyId;

    const resp = await fetch(`${env.agenticOrgBaseUrl}/api/v1/agents/${agentId}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.agenticOrgKey}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await resp.text();
    if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${text.slice(0, 300)}`);

    const p = JSON.parse(text) as Record<string, unknown>;
    const nested = (p.result ?? {}) as Record<string, unknown>;
    const rawOutput = "output" in p ? p.output : nested.output;
    const output = (extractJson(rawOutput) ?? {}) as T;
    const confidence = Number(("confidence" in p ? p.confidence : nested.confidence) ?? 0);
    const run: AgentRun<T> = {
      ok: true,
      output,
      runId: String(p.run_id ?? p.task_id ?? p.id ?? ""),
      confidence,
      toolCalls: Array.isArray(p.tool_calls) ? (p.tool_calls as Array<Record<string, unknown>>) : [],
      hitl: (p.hitl_trigger as string | null) ?? null,
      raw: p,
    };
    if (p.error) throw new Error(String(p.error));

    await logAgent({
      shopId: opts.shopId,
      agent: ROLE_TO_LOG[role],
      action,
      input: inputs,
      output,
      runId: run.runId,
      provider: "agenticorg",
      confidence,
      needsApproval: Boolean(run.hitl),
    });
    return run;
  } catch (err) {
    const error = err instanceof Error ? (err.name === "AbortError" ? "timed out" : err.message) : String(err);
    await logAgent({
      shopId: opts.shopId,
      agent: ROLE_TO_LOG[role],
      action: `${action}:failed`,
      input: inputs,
      output: error,
      provider: "agenticorg",
    });
    return { ok: false, error };
  } finally {
    clearTimeout(timer);
  }
}
