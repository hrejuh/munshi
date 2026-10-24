import { Page } from "@/components/ui";
import { dict, FIRST_MESSAGES, isLang } from "@/lib/i18n";
import { requireShop } from "@/lib/session";
import { OnboardClient } from "./OnboardClient";

export const dynamic = "force-dynamic";

export default async function OnboardPage() {
  const shop = await requireShop();
  const t = dict(shop.language);
  const lang = isLang(shop.language) ? shop.language : "en";
  return (
    <Page>
      <h1 className="font-display text-3xl font-extrabold">{t.talkTitle}</h1>
      <p className="mt-1 text-[15px] text-ink-soft">{t.talkHint}</p>
      <OnboardClient
        lang={lang}
        t={t}
        firstMessage={FIRST_MESSAGES[lang].setup}
        ownerName={shop.ownerName}
        shop={{
          name: shop.name,
          category: shop.category,
          address: shop.address,
          area: shop.area,
          timings: shop.timings,
          deliveryMode: shop.deliveryMode,
          deliveryFee: shop.deliveryFee,
          minOrder: shop.minOrder,
          tagline: shop.tagline,
        }}
      />
    </Page>
  );
}
