// Server tools the ElevenLabs agents call mid-conversation (webhooks: /api/voice/tools/[tool]).
// Responses are short plain objects the voice LLM reads back to the caller in their language.
import { draftsFromDescription } from "./catalog";
import { findMatches } from "./catalog-match";
import { liveProducts } from "./catalog";
import { db } from "./db";
import { normalizePhone } from "./ids";
import { logAgent } from "./log";
import { describe, placeOrder, resolveItems, usualOrder } from "./order-service";
import { rupees } from "./orders";
import { signVoiceToken, verifyVoiceToken } from "./voice-token";
import { finishOnboarding, missingFields, saveShopFields, type ShopFieldInput } from "./shops";

type Args = Record<string, unknown>;
type ToolResult = Record<string, unknown>;

const str = (v: unknown) => (typeof v === "string" ? v.trim() : v === undefined || v === null ? "" : String(v));

const SETUP_TOOLS = new Set(["save_shop_details", "finish_onboarding", "add_product"]);

/** Resolves the shop from the signed shop_token; setup tools additionally need the owner's setup scope. */
async function loadShop(args: Args) {
  const token = str(args.shop_token);
  const claims = token ? await verifyVoiceToken(token) : null;
  if (!claims) throw new ToolError("No shop selected. Ask the caller for the shop code.");
  if (SETUP_TOOLS.has(str(args.__tool)) && claims.scope !== "setup") throw new ToolError("Only the shop owner can change the store.");
  const shop = await db.shop.findUnique({ where: { id: claims.shopId } });
  if (!shop) throw new ToolError("Shop not found.");
  args.shop_id = shop.id;
  // caller_phone only ever comes from the token (verified caller ID on phone calls), never from the LLM,
  // so nobody can look up another buyer's usual order by saying their number.
  args.caller_phone = claims.caller ?? "";
  return shop;
}

export class ToolError extends Error {}

const FIELD_LABELS: Record<string, string> = {
  name: "shop name",
  category: "type of shop",
  address: "address",
  timings: "opening hours",
  deliveryMode: "delivery or pickup",
};

export const voiceTools: Record<string, (args: Args) => Promise<ToolResult>> = {
  async save_shop_details(args) {
    const shop = await loadShop(args);
    const updated = await saveShopFields(shop.id, args as ShopFieldInput, "elevenlabs");
    const missing = missingFields(updated).map((f) => FIELD_LABELS[f]);
    return {
      saved: true,
      still_missing: missing,
      next: missing.length ? `Ask about: ${missing[0]}` : "All details collected. Ask about delivery fee if delivery is offered, then call finish_onboarding.",
    };
  },

  async finish_onboarding(args) {
    const shop = await loadShop(args);
    const updated = await finishOnboarding(shop.id, str(args.summary));
    const missing = missingFields(updated).map((f) => FIELD_LABELS[f]);
    if (missing.length) return { ready: false, still_missing: missing };
    return {
      ready: true,
      tagline: updated.tagline,
      message: "The store preview is ready on the owner's screen. Tell them to check it and tap Approve. Then they can add products from a list, by photo, or by speaking.",
    };
  },

  async add_product(args) {
    const shop = await loadShop(args);
    const description = str(args.description);
    if (!description) throw new ToolError("Say the item name, size and price.");
    const { drafts } = await draftsFromDescription(shop.id, description, { language: shop.language, source: "VOICE" });
    if (!drafts.length) return { added: 0, message: "Could not understand the item. Ask the owner to repeat name, size and price." };
    return {
      added: drafts.length,
      drafts: drafts.map((d) => ({ name: d.name, size: d.size, price: d.price || "price not given" })),
      message: drafts.some((d) => !d.price)
        ? "Saved as draft. Ask the owner for the missing price."
        : "Saved as a draft card. The owner approves it on the Review drafts screen.",
    };
  },

  /** Shared Munshi number: the caller says the shop code, we hand back a shop token for the other tools. */
  async select_shop(args) {
    const code = str(args.shop_code).replace(/\D/g, "");
    const shop = code ? await db.shop.findFirst({ where: { shopCode: code, status: "LIVE" } }) : null;
    if (!shop) return { found: false, message: "No shop with that code. Ask the caller to repeat the code digit by digit." };
    const call = await verifyVoiceToken(str(args.call_token));
    return {
      found: true,
      shop_token: await signVoiceToken(shop.id, "order", call?.caller ? { caller: call.caller } : {}),
      shop_name: shop.name,
      delivery_mode: shop.deliveryMode.toLowerCase(),
      message: `Connected to ${shop.name}. Greet the caller on behalf of the shop and take the order.`,
    };
  },

  async search_products(args) {
    const shop = await loadShop(args);
    const products = await liveProducts(shop.id);
    const query = str(args.query);
    const matches = query ? findMatches(query, products, 5, 0.3) : [];
    return {
      results: matches.map((m) => ({ name: m.product.name, size: m.product.size, price: m.product.price })),
      note: matches.length ? undefined : "Not available in this shop. Offer something similar or move on.",
    };
  },

  async get_usual_order(args) {
    const shop = await loadShop(args);
    const phone = normalizePhone(str(args.caller_phone));
    if (!phone) return { found: false, note: "Usual orders are only available when the buyer calls from their own phone." };
    const usual = await usualOrder(shop.id, phone);
    if (!usual) return { found: false };
    return {
      found: usual.items.length > 0,
      customer_name: usual.buyer.name,
      saved_address: usual.buyer.address,
      usual_items: usual.items.map((i) => ({ name: i.name, size: i.size, qty: i.qty })),
    };
  },

  async place_order(args) {
    const shop = await loadShop(args);
    if (shop.status !== "LIVE") throw new ToolError("This shop is not taking orders yet.");
    const rawItems = Array.isArray(args.items) ? (args.items as Args[]) : [];
    const items = rawItems.map((i) => ({ name: str(i.name), qty: Number(i.qty) || 1 })).filter((i) => i.name);
    if (!items.length) throw new ToolError("No items in the order yet.");

    const products = await liveProducts(shop.id);
    const { lines, unclear } = resolveItems(products, items);
    if (unclear.length) {
      return {
        status: "needs_clarification",
        unclear: unclear.map((u) => ({ said: u.said, did_you_mean: u.suggestions })),
        message: "Ask the caller which of the suggestions they meant (or drop the item), then call place_order again with the full list.",
      };
    }

    const phone = normalizePhone(str(args.customer_phone) || str(args.caller_phone));
    if (!phone) throw new ToolError("Ask for the customer's phone number.");
    const fulfilment = /deliver/i.test(str(args.fulfilment)) ? "DELIVERY" : "PICKUP";
    const channel = str(args.channel) === "phone" ? "PHONE" : "VOICE_WEB";

    try {
      const { order } = await placeOrder({
        shopId: shop.id,
        lines: lines.map((l) => ({ productId: l.productId, qty: l.qty })),
        buyer: { name: str(args.customer_name) || "Customer", phone, address: str(args.address) || null },
        fulfilment,
        channel,
        note: str(args.note) || null,
      });
      return {
        status: "placed",
        order_code: order.code,
        order_code_spoken: order.code.split("").join(" "),
        items: lines.map((l) => `${l.qty} x ${describe({ name: l.name, size: l.size ?? null, price: l.price })}`),
        total: rupees(order.total),
        delivery_fee: order.deliveryFee ? rupees(order.deliveryFee) : undefined,
        payment: "cash on delivery or pickup",
        message:
          channel === "PHONE"
            ? "Read back the total and order number. Tell them to pay cash when they get the order; an order link has been sent by SMS. The shop will confirm the order shortly."
            : "Read back the total and order number. Tell them to pay cash when they get the order. Then call the open_order client tool with the order_code so the buyer can track it on screen.",
      };
    } catch (err) {
      throw new ToolError(err instanceof Error ? err.message : "Could not place the order.");
    }
  },

  async order_status(args) {
    const shop = await loadShop(args);
    const code = str(args.order_code).replace(/\D/g, "");
    const order = await db.order.findFirst({ where: { shopId: shop.id, code } });
    if (!order) return { found: false };
    return { found: true, status: order.status.toLowerCase().replace(/_/g, " "), total: rupees(order.total), payment: "cash on delivery or pickup" };
  },
};

function redact(args: Args) {
  const { shop_token: _token, call_token: _call, __tool: _tool, ...rest } = args;
  return rest;
}

export async function runVoiceTool(name: string, args: Args): Promise<{ status: number; body: ToolResult }> {
  const tool = voiceTools[name];
  if (!tool) return { status: 404, body: { error: `Unknown tool ${name}` } };
  try {
    args.__tool = name;
    const body = await tool(args);
    const { shop_token: _issued, ...loggable } = body;
    await logAgent({ shopId: str(args.shop_id) || null, agent: "VOICE", action: `tool:${name}`, input: redact(args), output: loggable, provider: "elevenlabs" });
    return { status: 200, body };
  } catch (err) {
    const message = err instanceof ToolError ? err.message : "Something went wrong. Apologise and offer to take the order on the store link.";
    if (!(err instanceof ToolError)) console.error(`voice tool ${name} failed`, err);
    await logAgent({ shopId: str(args.shop_id) || null, agent: "VOICE", action: `tool:${name}:error`, input: redact(args), output: message, provider: "elevenlabs" });
    // 200 with an error field: the agent reads the message instead of failing the turn.
    return { status: 200, body: { error: message } };
  }
}
