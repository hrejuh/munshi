import Link from "next/link";
import { Page } from "@/components/ui";
import { db } from "@/lib/db";
import { dict } from "@/lib/i18n";
import { requireShop } from "@/lib/session";
import { DraftList } from "./DraftList";

export const dynamic = "force-dynamic";

export default async function DraftsPage() {
  const shop = await requireShop();
  const t = dict(shop.language);
  const drafts = await db.product.findMany({ where: { shopId: shop.id, status: "DRAFT" }, orderBy: { createdAt: "desc" } });
  const updateTargets = await db.product.findMany({
    where: { id: { in: drafts.filter((d) => d.templateId?.startsWith("update:")).map((d) => d.templateId!.slice(7)) } },
    select: { id: true, price: true },
  });
  return (
    <Page>
      <h1 className="font-display text-3xl font-extrabold">{t.reviewDrafts}</h1>
      {drafts.length === 0 ? (
        <div className="mt-8 text-center">
          <p className="text-mute">{t.noDrafts}</p>
          <Link href="/app/products" className="mt-4 inline-block font-semibold text-leaf underline">{t.addProducts}</Link>
        </div>
      ) : (
        <DraftList
          t={t}
          drafts={drafts.map((d) => ({
            id: d.id,
            name: d.name,
            nameLocal: d.nameLocal,
            size: d.size,
            price: d.price,
            source: d.source,
            imageId: d.imageId,
            oldPrice: d.templateId?.startsWith("update:") ? updateTargets.find((u) => u.id === d.templateId!.slice(7))?.price ?? null : null,
          }))}
        />
      )}
    </Page>
  );
}
