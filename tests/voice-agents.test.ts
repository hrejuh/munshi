import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/log", () => ({ logAgent: vi.fn() }));

/** A tiny in-memory ElevenLabs: tools and agents are created once, then found by name. */
function fakeElevenLabs() {
  const tools: Array<{ id: string; tool_config: Record<string, unknown> }> = [];
  const agents: Array<{ agent_id: string; name: string }> = [];
  const calls: string[] = [];
  const fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
    const { pathname } = new URL(url);
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push(`${method} ${pathname}`);
    const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200 });
    if (pathname === "/v1/convai/tools" && method === "GET") return json({ tools });
    if (pathname === "/v1/convai/tools" && method === "POST") {
      tools.push({ id: `tool_${tools.length}`, tool_config: body.tool_config });
      return json({ id: tools.at(-1)!.id });
    }
    if (pathname.startsWith("/v1/convai/tools/")) return json({});
    if (pathname === "/v1/convai/agents" && method === "GET") return json({ agents });
    if (pathname === "/v1/convai/agents/create") {
      agents.push({ agent_id: `agent_${agents.length}`, name: body.name });
      return json({ agent_id: agents.at(-1)!.agent_id });
    }
    if (pathname.startsWith("/v1/convai/agents/")) return json({});
    if (pathname === "/v1/convai/conversation/get-signed-url") {
      return json({ signed_url: `wss://el/${new URL(url).searchParams.get("agent_id")}` });
    }
    return new Response("not found", { status: 404 });
  });
  return { tools, agents, calls, fetchMock };
}

describe("voice agents with only ELEVENLABS_API_KEY", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("ELEVENLABS_API_KEY", "xi_test");
    vi.stubEnv("APP_URL", "https://munshi-test.onrender.com");
    vi.stubEnv("VOICE_TOOL_SECRET", "tool-secret");
    vi.stubEnv("ELEVENLABS_SETUP_AGENT_ID", "");
    vi.stubEnv("ELEVENLABS_ORDER_AGENT_ID", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("creates the agents on first use, then reuses them", async () => {
    const el = fakeElevenLabs();
    vi.stubGlobal("fetch", el.fetchMock);
    const { getSignedUrl, voiceReady } = await import("@/lib/elevenlabs");

    expect(voiceReady()).toBe(true);
    expect(await getSignedUrl("setup")).toBe("wss://el/agent_0");
    expect(await getSignedUrl("order")).toBe("wss://el/agent_1");
    expect(el.agents.map((a) => a.name)).toEqual(["Munshi Setup", "Munshi Orders"]);

    const webhook = el.tools.find((t) => t.tool_config.name === "place_order")!.tool_config.api_schema as Record<string, unknown>;
    expect(webhook.url).toBe("https://munshi-test.onrender.com/api/voice/tools/place_order");
    expect(webhook.request_headers).toEqual({ "x-munshi-secret": "tool-secret" });

    // The second request reused the synced IDs instead of setting up again.
    expect(el.calls.filter((c) => c === "POST /v1/convai/agents/create")).toHaveLength(2);
  });

  it("uses pinned agent IDs from env without touching agents", async () => {
    vi.stubEnv("ELEVENLABS_ORDER_AGENT_ID", "pinned_order");
    const el = fakeElevenLabs();
    vi.stubGlobal("fetch", el.fetchMock);
    const { getSignedUrl } = await import("@/lib/elevenlabs");

    expect(await getSignedUrl("order")).toBe("wss://el/pinned_order");
    expect(el.calls).toEqual(["GET /v1/convai/conversation/get-signed-url"]);
  });

  it("retries setup after a failure", async () => {
    const el = fakeElevenLabs();
    let fail = true;
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) =>
      fail ? new Response("forbidden", { status: 401 }) : el.fetchMock(url, init),
    );
    const { getSignedUrl } = await import("@/lib/elevenlabs");

    await expect(getSignedUrl("setup")).rejects.toThrow(/HTTP 401/);
    fail = false;
    expect(await getSignedUrl("setup")).toBe("wss://el/agent_0");
  });
});
