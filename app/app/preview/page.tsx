import Link from "next/link";
import { StoreHeader } from "@/components/store/StoreHeader";
import { Storefront } from "@/components/store/Storefront";
import { Page, Pill } from "@/components/ui";
import { storefrontProps } from "@/lib/store-data";
import { missingFields } from "@/lib/shops";
import { requireShop } from "@/lib/session";
import { ApproveStoreButton } from "./ApproveStoreButton";

export const dynamic = "force-dynamic";

export default async function PreviewPage() {
  const shop = await requireShop();
  const props = await storefrontProps(shop);
  const missing = missingFields(shop);
  const { t } = props;
  return (
    <Page>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="font-display text-2xl font-extrabold">{t.previewTitle}</h1>
        <Pill tone={shop.status === "LIVE" ? "leaf" : "turmeric"}>{shop.status === "LIVE" ? t.live : t.draft}</Pill>
      </div>
      {shop.status !== "LIVE" && <p className="mb-4 text-sm text-ink-soft">{t.previewHint}</p>}

      <div lang={props.lang} className="rounded-[22px] border border-dashed border-ink/40 p-2">
        <StoreHeader name={shop.name ?? "Your shop"} tagline={shop.tagline} area={shop.area} address={shop.address} timings={shop.timings} deliveryLabel={props.deliveryLabel} />
        <Storefront slug={shop.slug} shopName={shop.name ?? ""} lang={props.lang} products={props.products} t={t} preview firstMessage="" />
      </div>

      {shop.status !== "LIVE" ? (
        <div className="mt-6 space-y-3">
          {missing.length > 0 && <p className="text-sm text-sindoor">Still needed: {missing.join(", ")}</p>}
          <ApproveStoreButton label={t.approveStore} disabled={missing.length > 0} />
          <Link href="/app/onboard" className="block text-center font-semibold text-ink underline">{t.change}</Link>
        </div>
      ) : (
        <Link href={`/s/${shop.slug}`} className="mt-6 block text-center font-semibold text-leaf underline">Open the live store</Link>
      )}
    </Page>
  );
}
