import type { DeliveryMode, Shop } from "@prisma/client";
import { agenticOrgReady, runAgent } from "./agenticorg";
import { db } from "./db";
import { numericCode, randomSuffix, slugify } from "./ids";
import { logAgent } from "./log";
import { guessCategory } from "./templates";

export const PROFILE_FIELDS = ["name", "category", "address", "timings", "deliveryMode"] as const;

export async function createShop(ownerName: string, phone: string, language: string) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const shop = await db.shop.create({
        data: {
          ownerName,
          phone,
          language,
          slug: `shop-${randomSuffix(6)}`,
          shopCode: numericCode(4 + Math.floor(attempt / 2)),
        },
      });
      await logAgent({ shopId: shop.id, agent: "SYSTEM", action: "owner_signup", input: { ownerName, phone, language } });
      return shop;
    } catch (err) {
      // Unique collisions on slug/shopCode: retry with a fresh one. Phone collisions bubble up.
      if (String(err).includes("phone")) throw err;
    }
  }
  throw new Error("Could not create shop");
}

export function missingFields(shop: Shop): string[] {
  return PROFILE_FIELDS.filter((f) => !shop[f]);
}

export interface ShopFieldInput {
  name?: string;
  category?: string;
  address?: string;
  area?: string;
  timings?: string;
  delivery_mode?: string;
  delivery_fee?: number | string;
  min_order?: number | string;
  tagline?: string;
  description?: string;
}

function toDeliveryMode(value: string | undefined): DeliveryMode | undefined {
  if (!value) return undefined;
  const v = value.toLowerCase();
  if (/both|dono|eradu|irandu/.test(v)) return "BOTH";
  if (/pick|collect|counter|takeaway/.test(v)) return "PICKUP";
  if (/deliver|home|door/.test(v)) return "DELIVERY";
  return undefined;
}

function toAmount(value: number | string | undefined): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const n = Math.round(Number(String(value).replace(/[^\d.]/g, "")));
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/** Writes the onboarding agent's answers onto the draft shop. Only drafts change; a live shop is edited in settings. */
export async function saveShopFields(shopId: string, input: ShopFieldInput, via: string) {
  const shop = await db.shop.findUnique({ where: { id: shopId } });
  if (!shop) throw new Error("Shop not found");

  const data: Partial<Shop> = {};
  if (input.name?.trim()) data.name = input.name.trim();
  if (input.category?.trim()) data.category = guessCategory(input.category);
  if (input.address?.trim()) data.address = input.address.trim();
  if (input.area?.trim()) data.area = input.area.trim();
  if (input.timings?.trim()) data.timings = input.timings.trim();
  if (input.tagline?.trim()) data.tagline = input.tagline.trim();
  if (input.description?.trim()) data.description = input.description.trim();
  const mode = toDeliveryMode(input.delivery_mode);
  if (mode) data.deliveryMode = mode;
  const fee = toAmount(input.delivery_fee);
  if (fee !== undefined) data.deliveryFee = fee;
  const min = toAmount(input.min_order);
  if (min !== undefined) data.minOrder = min;

  if (data.name && shop.slug.startsWith("shop-")) {
    const base = slugify(data.name) || "shop";
    data.slug = `${base}-${randomSuffix(4)}`;
  }

  const updated = await db.shop.update({ where: { id: shopId }, data });
  await logAgent({ shopId, agent: "ONBOARDING", action: "save_shop_fields", input, output: data, provider: via, needsApproval: true });
  return updated;
}

/**
 * The Onboarding agent polishes the collected answers into a tagline and short store description
 * in the owner's language. The shop stays DRAFT: nothing is public until the owner taps Approve.
 */
export async function finishOnboarding(shopId: string, transcript?: string) {
  const shop = await db.shop.findUniqueOrThrow({ where: { id: shopId } });
  if (agenticOrgReady("onboarding")) {
    const run = await runAgent<ShopFieldInput>(
      "onboarding",
      "build_store_profile",
      {
        task: "Build the store page copy for this small Indian shop. Return JSON with keys: name, category, address, area, timings, delivery_mode (DELIVERY|PICKUP|BOTH), delivery_fee, tagline (max 60 chars), description (max 200 chars). Write tagline and description in the owner's language followed by English in brackets. Never invent facts the owner did not say; leave unknown keys empty.",
        owner_language: shop.language,
        collected: {
          name: shop.name,
          category: shop.category,
          address: shop.address,
          area: shop.area,
          timings: shop.timings,
          delivery_mode: shop.deliveryMode,
          delivery_fee: shop.deliveryFee,
        },
        transcript: transcript?.slice(-6000),
      },
      { shopId, timeoutMs: 20000 },
    );
    if (run.ok) {
      // Owner's own answers win; the agent only fills gaps and writes the copy.
      const out = run.output;
      return saveShopFields(
        shopId,
        {
          name: shop.name ? undefined : out.name,
          address: shop.address ? undefined : out.address,
          area: shop.area ? undefined : out.area,
          timings: shop.timings ? undefined : out.timings,
          category: shop.category ? undefined : out.category,
          tagline: out.tagline,
          description: out.description,
        },
        "agenticorg",
      );
    }
  }
  if (!shop.tagline && shop.name) {
    const where = shop.area ?? shop.address?.split(",")[0];
    return saveShopFields(shopId, { tagline: where ? `Your neighbourhood shop in ${where}` : "Your trusted neighbourhood shop" }, "fallback");
  }
  return shop;
}

export async function approveShop(shopId: string) {
  const shop = await db.shop.findUniqueOrThrow({ where: { id: shopId } });
  const missing = missingFields(shop);
  if (missing.length) throw new Error(`Missing: ${missing.join(", ")}`);
  const updated = await db.shop.update({ where: { id: shopId }, data: { status: "LIVE", approvedAt: new Date() } });
  await logAgent({ shopId, agent: "ONBOARDING", action: "store_published", output: { slug: shop.slug }, approvedBy: "owner" });
  return updated;
}
