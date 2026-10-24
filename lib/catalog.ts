import type { Product, ProductSource } from "@prisma/client";
import { agenticOrgReady, runAgent } from "./agenticorg";
import { confidentMatch, parseSpokenItem } from "./catalog-match";
import { db } from "./db";
import { logAgent } from "./log";
import { findTemplateItem } from "./templates";

export interface DraftSpec {
  name: string;
  nameLocal?: string | null;
  size?: string | null;
  price?: number | null;
  category?: string | null;
  imageId?: string | null;
  /** When set, the draft proposes a change to this existing product instead of a new card. */
  updatesProductId?: string | null;
}

interface CatalogAgentItem {
  action?: "create" | "update";
  product_id?: string;
  name?: string;
  name_local?: string;
  size?: string;
  price?: number | string;
  category?: string;
}

/**
 * Turns an owner's spoken or typed description into draft product cards.
 * The Catalog agent normalizes names, sizes and prices and spots updates to existing items;
 * if it is unavailable we parse the sentence ourselves. Either way every card is a DRAFT.
 */
export async function draftsFromDescription(
  shopId: string,
  text: string,
  opts: { language?: string; imageId?: string | null; source: ProductSource },
): Promise<{ drafts: Product[]; provider: string }> {
  const existing = await db.product.findMany({
    where: { shopId, status: { not: "REJECTED" } },
    select: { id: true, name: true, nameLocal: true, size: true, price: true, aliases: true },
  });

  let specs: DraftSpec[] = [];
  let provider = "fallback";
  if (agenticOrgReady("catalog")) {
    const run = await runAgent<{ items?: CatalogAgentItem[] }>(
      "catalog",
      "draft_listings",
      {
        task: "An Indian shop owner described products, possibly in Kannada, Hindi, Tamil or English. Return JSON {items:[{action:'create'|'update', product_id, name (English, brand first), name_local (owner's language script), size (e.g. '5 kg', '500 ml'), price (integer rupees or null if not said), category}]}. Use action 'update' with product_id only when the item clearly matches one in existing_products. Never guess a price that was not said.",
        description: text,
        owner_language: opts.language,
        existing_products: existing.slice(0, 300).map((p) => ({ id: p.id, name: p.name, size: p.size, price: p.price })),
      },
      { shopId, timeoutMs: 20000 },
    );
    if (run.ok && Array.isArray(run.output.items) && run.output.items.length) {
      provider = "agenticorg";
      specs = run.output.items
        .filter((i) => i.name)
        .map((i) => ({
          name: String(i.name),
          nameLocal: i.name_local ?? null,
          size: i.size ?? null,
          price: i.price === undefined || i.price === null || i.price === "" ? null : Math.round(Number(i.price)),
          category: i.category ?? null,
          updatesProductId: i.action === "update" && existing.some((p) => p.id === i.product_id) ? i.product_id! : null,
        }));
    }
  }
  if (!specs.length) {
    const parsed = parseSpokenItem(text);
    if (parsed.name) {
      const match = confidentMatch(`${parsed.name} ${parsed.size ?? ""}`, existing);
      specs = [{ name: parsed.name, size: parsed.size, price: parsed.price, updatesProductId: match?.id ?? null }];
    }
  }

  const drafts: Product[] = [];
  for (const spec of specs) drafts.push(await createDraft(shopId, { ...spec, imageId: opts.imageId ?? null }, opts.source, provider, text));
  return { drafts, provider };
}

export async function createDraft(shopId: string, spec: DraftSpec, source: ProductSource, provider: string, said?: string) {
  const target = spec.updatesProductId
    ? await db.product.findFirst({ where: { id: spec.updatesProductId, shopId } })
    : null;
  const draft = await db.product.create({
    data: {
      shopId,
      name: spec.name.slice(0, 120),
      nameLocal: spec.nameLocal ?? target?.nameLocal ?? null,
      size: spec.size ?? target?.size ?? null,
      // 0 means "price not said yet": the drafts screen asks the owner instead of guessing.
      price: spec.price && spec.price > 0 ? spec.price : 0,
      category: spec.category ?? target?.category ?? null,
      aliases: target?.aliases ?? [],
      imageId: spec.imageId ?? target?.imageId ?? null,
      source,
      status: "DRAFT",
      // Remember which approved product this draft would replace.
      templateId: target ? `update:${target.id}` : null,
    },
  });
  await logAgent({
    shopId,
    agent: "CATALOG",
    action: target ? "draft_price_update" : "draft_item",
    input: said ?? spec,
    output: { name: draft.name, size: draft.size, price: draft.price },
    provider,
    needsApproval: true,
  });
  return draft;
}

export async function addFromTemplate(shopId: string, picks: Array<{ templateId: string; price: number }>) {
  const already = new Set(
    (await db.product.findMany({ where: { shopId, templateId: { in: picks.map((p) => p.templateId) } }, select: { templateId: true } }))
      .map((p) => p.templateId),
  );
  const shop = await db.shop.findUniqueOrThrow({ where: { id: shopId }, select: { language: true } });
  const created: Product[] = [];
  for (const pick of picks) {
    if (already.has(pick.templateId)) continue;
    const item = findTemplateItem(pick.templateId);
    if (!item) continue;
    const local = (item.local as Record<string, string>)[shop.language] ?? null;
    created.push(
      await db.product.create({
        data: {
          shopId,
          name: item.name,
          nameLocal: local,
          size: item.size,
          price: Math.max(0, Math.round(pick.price || item.price)),
          category: item.group,
          aliases: [...item.aliases, item.local.hi, item.local.kn, item.local.ta].filter(Boolean),
          templateId: item.id,
          source: "TEMPLATE",
          status: "DRAFT",
        },
      }),
    );
  }
  if (created.length) {
    await logAgent({
      shopId,
      agent: "CATALOG",
      action: "draft_from_template",
      input: { count: picks.length },
      output: created.map((p) => `${p.name} ${p.size} ₹${p.price}`).join(", "),
      needsApproval: true,
    });
  }
  return created;
}

/** Owner approval: a draft becomes a live item (or applies its change to the item it updates). */
export async function approveDraft(shopId: string, productId: string, edits?: { name?: string; size?: string; price?: number }) {
  const draft = await db.product.findFirst({ where: { id: productId, shopId, status: "DRAFT" } });
  if (!draft) throw new Error("Draft not found");
  const price = edits?.price ?? draft.price;
  if (!price || price <= 0) throw new Error("Set a price before approving");
  const name = edits?.name?.trim() || draft.name;
  const size = edits?.size?.trim() ?? draft.size;

  const updateTarget = draft.templateId?.startsWith("update:") ? draft.templateId.slice(7) : null;
  let result: Product;
  if (updateTarget) {
    result = await db.product.update({
      where: { id: updateTarget },
      data: { name, size, price, imageId: draft.imageId ?? undefined, nameLocal: draft.nameLocal ?? undefined },
    });
    await db.product.delete({ where: { id: draft.id } });
  } else {
    result = await db.product.update({ where: { id: draft.id }, data: { name, size, price, status: "APPROVED" } });
  }
  await logAgent({
    shopId,
    agent: "CATALOG",
    action: updateTarget ? "price_change_approved" : "item_approved",
    output: { name, size, price },
    approvedBy: "owner",
  });
  return result;
}

export async function rejectDraft(shopId: string, productId: string) {
  await db.product.updateMany({ where: { id: productId, shopId, status: "DRAFT" }, data: { status: "REJECTED" } });
  await logAgent({ shopId, agent: "CATALOG", action: "item_rejected", input: { productId }, approvedBy: "owner" });
}

export function liveProducts(shopId: string) {
  return db.product.findMany({
    where: { shopId, status: "APPROVED", inStock: true },
    orderBy: [{ category: "asc" }, { name: "asc" }],
  });
}
