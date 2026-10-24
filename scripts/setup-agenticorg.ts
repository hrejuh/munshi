// Creates Munshi's three agents on AgenticOrg (Pine Labs): Onboarding, Catalog, Order.
// Orders are cash on delivery, so no agent gets payment tools or connectors.
// Usage: npm run setup:agenticorg   (needs AGENTICORG_API_KEY with agents:write scope)
// Re-running is safe: agents are matched by name and existing ones are reused.
import "dotenv/config";
import { AGENTICORG_PROMPTS } from "../lib/prompts";

const BASE = (process.env.AGENTICORG_BASE_URL ?? "https://agenticorg.pinelabs.com").replace(/\/$/, "");
const KEY = process.env.AGENTICORG_API_KEY ?? "";
const COMPANY = process.env.AGENTICORG_COMPANY_ID || undefined;
if (!KEY) throw new Error("Set AGENTICORG_API_KEY (Settings > API Keys in the AgenticOrg dashboard)");

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const resp = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`${method} ${path} -> HTTP ${resp.status}: ${text.slice(0, 600)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

interface AgentSpec {
  env: string;
  name: string;
  agent_type: string;
  domain: string;
  designation: string;
  system_prompt: string;
  authorized_tools: string[];
  connector_ids: string[];
}

const AGENTS: AgentSpec[] = [
  {
    env: "AGENTICORG_ONBOARDING_AGENT_ID",
    name: "Munshi Onboarding Agent",
    agent_type: "munshi_onboarding",
    domain: "ops",
    designation: "Shop onboarding assistant",
    system_prompt: AGENTICORG_PROMPTS.onboarding,
    authorized_tools: [],
    connector_ids: [],
  },
  {
    env: "AGENTICORG_CATALOG_AGENT_ID",
    name: "Munshi Catalog Agent",
    agent_type: "munshi_catalog",
    domain: "ops",
    designation: "Product listing assistant",
    system_prompt: AGENTICORG_PROMPTS.catalog,
    authorized_tools: [],
    connector_ids: [],
  },
  {
    env: "AGENTICORG_ORDER_AGENT_ID",
    name: "Munshi Order Agent",
    agent_type: "munshi_order",
    domain: "ops",
    designation: "Order assistant",
    system_prompt: AGENTICORG_PROMPTS.order,
    authorized_tools: [],
    connector_ids: [],
  },
];

async function findExisting(name: string): Promise<string | null> {
  const data = await api<{ items?: Array<{ id: string; name: string }> } | Array<{ id: string; name: string }>>("GET", "/api/v1/agents?page_size=200");
  const items = Array.isArray(data) ? data : (data.items ?? []);
  return items.find((a) => a.name === name)?.id ?? null;
}

async function create(spec: AgentSpec): Promise<{ id: string; status: string }> {
  const body = {
    name: spec.name,
    agent_type: spec.agent_type,
    domain: spec.domain,
    employee_name: spec.name.replace(" Agent", ""),
    designation: spec.designation,
    system_prompt: spec.system_prompt,
    authorized_tools: spec.authorized_tools,
    use_default_tools: false,
    connector_ids: spec.connector_ids,
    // Munshi itself asks the shop owner to approve every draft, order and price; AgenticOrg's
    // HITL gate only needs to catch genuinely low-confidence runs.
    hitl_policy: { condition: "confidence < 0.5" },
    confidence_floor: 0.5,
    company_id: COMPANY,
  };
  // Try to go live straight away; tenants with maker-checker require a second person to activate.
  for (const initial_status of ["active", "shadow"]) {
    try {
      const res = await api<{ id?: string; agent_id?: string; status?: string }>("POST", "/api/v1/agents", { ...body, initial_status });
      return { id: String(res.id ?? res.agent_id), status: res.status ?? initial_status };
    } catch (err) {
      if (initial_status === "shadow") throw err;
      console.warn(`  ! ${spec.name}: could not create as active (${(err as Error).message.slice(0, 160)}); creating in shadow mode`);
    }
  }
  throw new Error("unreachable");
}

async function main() {
  console.log(`AgenticOrg at ${BASE}`);
  const lines: string[] = [];
  for (const spec of AGENTS) {
    const existing = await findExisting(spec.name);
    if (existing) {
      console.log(`  ✓ ${spec.name} already exists: ${existing}`);
      lines.push(`${spec.env}=${existing}`);
      continue;
    }
    const { id, status } = await create(spec);
    console.log(`  ✓ ${spec.name} created: ${id} (${status})`);
    lines.push(`${spec.env}=${id}`);
  }
  console.log(`
Add these to your environment:

${lines.join("\n")}

In the AgenticOrg dashboard:
  1. If any agent shows "shadow", promote it to active (Agents > agent > Promote) so runs aren't refused.
  2. Your API key needs the agents:execute scope for Munshi to run agents.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
