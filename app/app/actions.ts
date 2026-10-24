"use server";

import type { DeliveryMode } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { addFromTemplate, approveDraft, draftsFromDescription, rejectDraft } from "@/lib/catalog";
import { db } from "@/lib/db";
import { logAgent } from "@/lib/log";
import { applyOwnerAction } from "@/lib/order-actions";
import type { OwnerAction } from "@/lib/orders";
import { endOwnerSession, requireShop } from "@/lib/session";
import { approveShop, finishOnboarding, saveShopFields } from "@/lib/shops";

type Result = { error?: string; ok?: boolean } | undefined;

function message(err: unknown) {
  return err instanceof Error ? err.message : "Something went wrong";
}

export async function saveDraftFields(_prev: Result, form: FormData): Promise<Result> {
  const shop = await requireShop();
  try {
    await saveShopFields(
      shop.id,
      {
        name: String(form.get("name") ?? ""),
        category: String(form.get("category") ?? ""),
        address: String(form.get("address") ?? ""),
        area: String(form.get("area") ?? ""),
        timings: String(form.get("timings") ?? ""),
        delivery_mode: String(form.get("deliveryMode") ?? ""),
        delivery_fee: String(form.get("deliveryFee") ?? ""),
        min_order: String(form.get("minOrder") ?? ""),
        tagline: String(form.get("tagline") ?? ""),
      },
      "owner_typed",
    );
  } catch (err) {
    return { error: message(err) };
  }
  revalidatePath("/app", "layout");
  return { ok: true };
}

export async function buildPreview(): Promise<Result> {
  const shop = await requireShop();
  await finishOnboarding(shop.id);
  redirect("/app/preview");
}

export async function approveStore(): Promise<Result> {
  const shop = await requireShop();
  try {
    await approveShop(shop.id);
  } catch (err) {
    return { error: message(err) };
  }
  revalidatePath("/app", "layout");
  redirect("/app/products");
}

export async function logout() {
  await endOwnerSession();
  redirect("/");
}

// ── Catalog ────────────────────────────────────────────────

export async function addTemplateItems(picks: Array<{ templateId: string; price: number }>): Promise<Result & { added?: number }> {
  const shop = await requireShop();
  if (!picks.length) return { error: "Tick at least one item" };
  const created = await addFromTemplate(shop.id, picks.slice(0, 300));
  revalidatePath("/app/products", "layout");
  return { ok: true, added: created.length };
}

export async function draftFromText(text: string, imageId?: string | null): Promise<Result & { count?: number }> {
  const shop = await requireShop();
  if (!text.trim()) return { error: "Say or type the item name, size and price" };
  const { drafts } = await draftsFromDescription(shop.id, text, {
    language: shop.language,
    imageId: imageId ?? null,
    source: imageId ? "PHOTO" : "VOICE",
  });
  revalidatePath("/app/products", "layout");
  return drafts.length ? { ok: true, count: drafts.length } : { error: "Could not understand that. Try: “Tata salt 1 kilo 28 rupees”" };
}

export async function approveProduct(productId: string, edits?: { name?: string; size?: string; price?: number }): Promise<Result> {
  const shop = await requireShop();
  try {
    await approveDraft(shop.id, productId, edits);
  } catch (err) {
    return { error: message(err) };
  }
  revalidatePath("/app/products", "layout");
  return { ok: true };
}

export async function approveAllDrafts(): Promise<Result & { skipped?: number }> {
  const shop = await requireShop();
  const drafts = await db.product.findMany({ where: { shopId: shop.id, status: "DRAFT" } });
  let skipped = 0;
  for (const d of drafts) {
    if (d.price > 0) await approveDraft(shop.id, d.id);
    else skipped++;
  }
  revalidatePath("/app/products", "layout");
  return { ok: true, skipped };
}

export async function deleteProduct(productId: string): Promise<Result> {
  const shop = await requireShop();
  await rejectDraft(shop.id, productId);
  revalidatePath("/app/products", "layout");
  return { ok: true };
}

export async function updateLiveProduct(productId: string, data: { price?: number; inStock?: boolean }): Promise<Result> {
  const shop = await requireShop();
  const product = await db.product.findFirst({ where: { id: productId, shopId: shop.id, status: "APPROVED" } });
  if (!product) return { error: "Product not found" };
  if (data.price !== undefined && (!Number.isFinite(data.price) || data.price <= 0)) return { error: "Enter a valid price" };
  await db.product.update({ where: { id: productId }, data });
  await logAgent({
    shopId: shop.id,
    agent: "CATALOG",
    action: data.price !== undefined ? "price_changed_by_owner" : "stock_toggled",
    input: { product: product.name, ...data },
    approvedBy: "owner",
  });
  revalidatePath("/app/products");
  return { ok: true };
}

// ── Orders ─────────────────────────────────────────────────

export async function orderAction(orderId: string, action: OwnerAction): Promise<Result> {
  const shop = await requireShop();
  try {
    await applyOwnerAction(shop.id, orderId, action);
  } catch (err) {
    return { error: message(err) };
  }
  revalidatePath("/app", "layout");
  return { ok: true };
}

// ── Settings ───────────────────────────────────────────────

export async function saveSettings(_prev: Result, form: FormData): Promise<Result> {
  const shop = await requireShop();
  const mode = String(form.get("deliveryMode") ?? shop.deliveryMode) as DeliveryMode;
  const toInt = (key: string) => {
    const n = Math.round(Number(form.get(key) ?? 0));
    return Number.isFinite(n) && n >= 0 ? n : 0;
  };
  const name = String(form.get("name") ?? "").trim();
  if (!name) return { error: "Shop name is required" };
  await db.shop.update({
    where: { id: shop.id },
    data: {
      name,
      tagline: String(form.get("tagline") ?? "").trim() || null,
      address: String(form.get("address") ?? "").trim() || null,
      timings: String(form.get("timings") ?? "").trim() || null,
      deliveryMode: ["DELIVERY", "PICKUP", "BOTH"].includes(mode) ? mode : shop.deliveryMode,
      deliveryFee: toInt("deliveryFee"),
      minOrder: toInt("minOrder"),
      deliveryNote: String(form.get("deliveryNote") ?? "").trim() || null,
      language: String(form.get("language") ?? shop.language),
    },
  });
  await logAgent({ shopId: shop.id, agent: "SYSTEM", action: "settings_saved", approvedBy: "owner" });
  revalidatePath("/app", "layout");
  revalidatePath(`/s/${shop.slug}`);
  return { ok: true };
}
