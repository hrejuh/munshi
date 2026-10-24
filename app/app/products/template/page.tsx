import { Page } from "@/components/ui";
import { db } from "@/lib/db";
import { dict } from "@/lib/i18n";
import { requireShop } from "@/lib/session";
import { TEMPLATES } from "@/lib/templates";
import { TemplatePicker } from "./TemplatePicker";

export const dynamic = "force-dynamic";

export default async function TemplatePage() {
  const shop = await requireShop();
  const t = dict(shop.language);
  const taken = await db.product.findMany({ where: { shopId: shop.id, templateId: { not: null }, status: { not: "REJECTED" } }, select: { templateId: true } });
  return (
    <Page>
      <h1 className="font-display text-3xl font-extrabold">{t.pickFromList}</h1>
      <p className="mt-1 text-[15px] text-ink-soft">{t.pickFromListHint}</p>
      <TemplatePicker
        t={t}
        lang={shop.language}
        initialCategory={shop.category ?? "kirana"}
        templates={TEMPLATES}
        taken={taken.map((p) => p.templateId!)}
      />
    </Page>
  );
}
