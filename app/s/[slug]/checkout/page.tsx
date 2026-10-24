import { notFound } from "next/navigation";
import { Page } from "@/components/ui";
import { db } from "@/lib/db";
import { storefrontProps } from "@/lib/store-data";
import { CheckoutClient } from "./CheckoutClient";

export const dynamic = "force-dynamic";

export default async function CheckoutPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const shop = await db.shop.findUnique({ where: { slug } });
  if (!shop || shop.status !== "LIVE") notFound();
  const props = await storefrontProps(shop);
  return (
    <Page>
      <div lang={props.lang}>
        <h1 className="font-display text-3xl font-extrabold">{props.t.checkout}</h1>
        <p className="text-ink-soft">{shop.name}</p>
        <CheckoutClient
          slug={shop.slug}
          t={props.t}
          products={props.products}
          pricing={{ deliveryMode: shop.deliveryMode, deliveryFee: shop.deliveryFee, minOrder: shop.minOrder }}
          deliveryNote={shop.deliveryNote}
        />
      </div>
    </Page>
  );
}
