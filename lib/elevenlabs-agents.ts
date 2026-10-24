// Creates (or updates) Munshi's two ElevenLabs agents and their tools. Used by the server on first
// voice use (so only ELEVENLABS_API_KEY is needed) and by scripts/setup-elevenlabs.ts.
// Re-running is safe: tools and agents are matched by name and updated in place.
import { FIRST_MESSAGES } from "./i18n";
import { ORDER_VOICE_PROMPT, SETUP_VOICE_PROMPT } from "./prompts";

const API = "https://api.elevenlabs.io";

export interface SyncOptions {
  apiKey: string;
  /** Public https URL of this app; ElevenLabs calls its tool webhooks here. */
  appUrl: string;
  /** Shared secret ElevenLabs sends with every tool call (VOICE_TOOL_SECRET). */
  toolSecret: string;
  llm?: string;
  ttsModel?: string;
  voiceId?: string;
  log?: (line: string) => void;
}

type Prop = Record<string, unknown>;
const s = (description: string): Prop => ({ type: "string", description });
const n = (description: string): Prop => ({ type: "number", description });
const dyn = (name: string): Prop => ({ type: "string", dynamic_variable: name });

export async function syncVoiceAgents(opts: SyncOptions): Promise<{ setup: string; order: string }> {
  const appUrl = opts.appUrl.replace(/\/$/, "");
  if (!opts.apiKey) throw new Error("Set ELEVENLABS_API_KEY");
  if (!appUrl.startsWith("https://")) throw new Error("APP_URL must be a public https URL (Render URL or a tunnel) so ElevenLabs can reach the tools");
  if (!opts.toolSecret) throw new Error("Set VOICE_TOOL_SECRET (any long random string) so tool webhooks are authenticated");
  const log = opts.log ?? (() => {});

  async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
    const resp = await fetch(`${API}${path}`, {
      method,
      headers: { "xi-api-key": opts.apiKey, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await resp.text();
    if (!resp.ok) throw new Error(`${method} ${path} -> HTTP ${resp.status}: ${text.slice(0, 600)}`);
    return (text ? JSON.parse(text) : {}) as T;
  }

  function webhook(name: string, description: string, properties: Record<string, Prop>, required: string[], extra: Prop = {}) {
    return {
      type: "webhook",
      name,
      description,
      response_timeout_secs: 30,
      api_schema: {
        url: `${appUrl}/api/voice/tools/${name}`,
        method: "POST",
        request_headers: { "x-munshi-secret": opts.toolSecret },
        request_body_schema: { type: "object", description: `${name} arguments`, properties, required },
      },
      ...extra,
    };
  }

  const TOOLS = {
    save_shop_details: webhook(
      "save_shop_details",
      "Save shop details the owner just told you. Send only the fields you learned in this turn.",
      {
        shop_token: dyn("shop_token"),
        name: s("Shop name"),
        category: s("Type of shop: kirana, bakery, stationery or fruits-veg"),
        address: s("Street address"),
        area: s("Area or locality"),
        timings: s("Opening hours, e.g. 7 am to 10 pm"),
        delivery_mode: s("delivery, pickup or both"),
        delivery_fee: n("Delivery fee in rupees"),
        min_order: n("Minimum order in rupees"),
      },
      ["shop_token"],
    ),
    finish_onboarding: webhook(
      "finish_onboarding",
      "Call once all shop details are collected. Builds the store preview for the owner to approve.",
      { shop_token: dyn("shop_token"), summary: s("One-line English summary of the shop") },
      ["shop_token"],
    ),
    add_product: webhook(
      "add_product",
      "Add a product the owner described (name, size, price) as a draft card for their approval.",
      { shop_token: dyn("shop_token"), description: s("The owner's exact words about the product, e.g. 'Aashirvaad atta 5 kilo 260 rupees'") },
      ["shop_token", "description"],
    ),
    select_shop: webhook(
      "select_shop",
      "On the shared Munshi phone line, select which shop the caller is ordering from using the shop code they say.",
      { call_token: dyn("call_token"), shop_code: s("Shop code digits the caller said") },
      ["call_token", "shop_code"],
      { assignments: [{ source: "response", dynamic_variable: "shop_token", value_path: "shop_token" }] },
    ),
    search_products: webhook(
      "search_products",
      "Search this shop's products by what the buyer said. Returns names, sizes and prices.",
      { shop_token: dyn("shop_token"), query: s("Item the buyer asked for") },
      ["shop_token", "query"],
    ),
    get_usual_order: webhook(
      "get_usual_order",
      "Get a returning caller's usual (last) order. Only works on phone calls.",
      { shop_token: dyn("shop_token") },
      ["shop_token"],
    ),
    place_order: webhook(
      "place_order",
      "Place the confirmed order. Only call after reading the items back and the buyer agreeing.",
      {
        shop_token: dyn("shop_token"),
        channel: dyn("channel"),
        items: {
          type: "array",
          description: "Items the buyer confirmed",
          items: { type: "object", description: "One item", properties: { name: s("Item name as on the shop list"), qty: n("Quantity") }, required: ["name", "qty"] },
        },
        customer_name: s("Buyer's name"),
        customer_phone: s("Buyer's phone number"),
        fulfilment: s("delivery or pickup"),
        address: s("Delivery address (only for delivery)"),
        note: s("Any note for the shop"),
      },
      ["shop_token", "channel", "items", "customer_name", "customer_phone", "fulfilment"],
    ),
    order_status: webhook(
      "order_status",
      "Look up an existing order's status by its order number.",
      { shop_token: dyn("shop_token"), order_code: s("Order number digits") },
      ["shop_token", "order_code"],
    ),
    open_order: {
      type: "client",
      name: "open_order",
      description: "Web only: open the status page for the order the buyer just placed (they pay cash on delivery or pickup).",
      expects_response: false,
      parameters: { type: "object", description: "Order to show", properties: { order_code: s("Order number returned by place_order") }, required: ["order_code"] },
    },
  };

  async function upsertTool(config: Record<string, unknown>): Promise<string> {
    const list = await api<{ tools: Array<{ id: string; tool_config: { name: string } }> }>("GET", "/v1/convai/tools");
    const existing = list.tools?.find((t) => t.tool_config?.name === config.name);
    const send = async (cfg: Record<string, unknown>) =>
      existing
        ? (await api<{ id: string }>("PATCH", `/v1/convai/tools/${existing.id}`, { tool_config: cfg }), existing.id)
        : (await api<{ id: string }>("POST", "/v1/convai/tools", { tool_config: cfg })).id;
    try {
      return await send(config);
    } catch (err) {
      if ("assignments" in config) {
        log(`  ! ${config.name}: assignments not accepted (${(err as Error).message.slice(0, 120)}); retrying without them`);
        const { assignments: _a, ...rest } = config;
        return send(rest);
      }
      throw err;
    }
  }

  async function upsertAgent(name: string, body: Record<string, unknown>): Promise<string> {
    const list = await api<{ agents: Array<{ agent_id: string; name: string }> }>("GET", `/v1/convai/agents?search=${encodeURIComponent(name)}`);
    const existing = list.agents?.find((a) => a.name === name);
    if (existing) {
      await api("PATCH", `/v1/convai/agents/${existing.agent_id}`, body);
      return existing.agent_id;
    }
    return (await api<{ agent_id: string }>("POST", "/v1/convai/agents/create", body)).agent_id;
  }

  function agentBody(name: string, prompt: string, firstMessage: string, toolIds: string[], placeholders: Record<string, string | boolean>, extraPlatform: Record<string, unknown> = {}) {
    return {
      name,
      conversation_config: {
        agent: {
          first_message: firstMessage,
          language: "en",
          prompt: { prompt, llm: opts.llm || "gemini-2.5-flash", temperature: 0.3, tool_ids: toolIds },
          dynamic_variables: { dynamic_variable_placeholders: placeholders },
        },
        ...(opts.ttsModel || opts.voiceId
          ? { tts: { ...(opts.ttsModel ? { model_id: opts.ttsModel } : {}), ...(opts.voiceId ? { voice_id: opts.voiceId } : {}) } }
          : {}),
      },
      platform_settings: {
        overrides: {
          conversation_config_override: {
            agent: { first_message: true, language: true },
            conversation: { text_only: true },
          },
        },
        ...extraPlatform,
      },
    };
  }

  log(`Creating tools pointing at ${appUrl} ...`);
  const ids: Record<string, string> = {};
  for (const [key, cfg] of Object.entries(TOOLS)) {
    ids[key] = await upsertTool(cfg as Record<string, unknown>);
    log(`  ✓ ${key} ${ids[key]}`);
  }

  const setup = await upsertAgent(
    "Munshi Setup",
    agentBody("Munshi Setup", SETUP_VOICE_PROMPT, FIRST_MESSAGES.en.setup, [ids.save_shop_details, ids.finish_onboarding, ids.add_product], {
      shop_token: "",
      owner_name: "there",
      language: "en",
      channel: "web",
    }),
  );
  log(`  ✓ Munshi Setup agent ${setup}`);

  const order = await upsertAgent(
    "Munshi Orders",
    agentBody(
      "Munshi Orders",
      ORDER_VOICE_PROMPT,
      FIRST_MESSAGES.en.order,
      [ids.select_shop, ids.search_products, ids.get_usual_order, ids.place_order, ids.order_status, ids.open_order],
      {
        shop_token: "",
        call_token: "",
        channel: "web",
        shop_name: "our shop",
        shop_selected: true,
        caller_phone: "",
        customer_name: "",
        returning_customer: false,
        delivery_mode: "",
        language: "en",
      },
      {
        // Phone calls: ElevenLabs asks Munshi which shop/caller this is before the call starts.
        workspace_overrides: {
          conversation_initiation_client_data_webhook: {
            url: `${appUrl}/api/voice/init`,
            request_headers: { "x-munshi-secret": opts.toolSecret },
          },
        },
      },
    ),
  );
  log(`  ✓ Munshi Orders agent ${order}`);

  return { setup, order };
}
