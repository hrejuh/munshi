import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StoreHeader } from "@/components/store/StoreHeader";
import { Storefront } from "@/components/store/Storefront";
import { Page } from "@/components/ui";
import { db } from "@/lib/db";
import { dict } from "@/lib/i18n";
import { storefrontProps } from "@/lib/store-data";

export const dynamic = "force-dynamic";

async function load(slug: string) {
  return db.shop.findUnique({ where: { slug } });
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const shop = await load((await params).slug);
  if (!shop?.name) return { title: "Munshi" };
  return { title: shop.name, description: shop.tagline ?? `Order from ${shop.name}` };
}

export default async function StorePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const shop = await load(slug);
  if (!shop) notFound();
  if (shop.status !== "LIVE") {
    return (
      <Page>
        <div className="signboard px-5 py-8 text-center">
          <h1 className="font-display text-3xl font-extrabold">{shop.name ?? "Coming soon"}</h1>
          <p className="mt-2">{dict(shop.language).shopClosedDraft}</p>
        </div>
      </Page>
    );
  }
  const props = await storefrontProps(shop);
  return (
    <Page className="pb-32" >
      <div lang={props.lang}>
        <StoreHeader name={shop.name!} tagline={shop.tagline} area={shop.area} address={shop.address} timings={shop.timings} deliveryLabel={props.deliveryLabel} />
        <Storefront slug={shop.slug} shopName={shop.name!} lang={props.lang} products={props.products} t={props.t} firstMessage={props.firstMessage} phoneLine={props.phoneLine} />
        <p className="mt-10 text-center text-xs text-mute">Orders handled by Munshi. Pay cash on delivery or pickup.</p>
      </div>
    </Page>
  );
}
