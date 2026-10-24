import QRCode from "qrcode";
import { Page } from "@/components/ui";
import { env } from "@/lib/env";
import { dict } from "@/lib/i18n";
import { requireShop } from "@/lib/session";
import { logout } from "../actions";
import { SettingsForm } from "./SettingsForm";
import { ShareLink } from "./ShareLink";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const shop = await requireShop();
  const t = dict(shop.language);
  const storeUrl = `${env.appUrl}/s/${shop.slug}`;
  const qr = await QRCode.toDataURL(storeUrl, { margin: 1, width: 480, color: { dark: "#1f1b3f", light: "#ffffff" } });
  const shareText = `Order from ${shop.name ?? "our shop"} online: ${storeUrl}`;

  return (
    <Page>
      <h1 className="font-display text-3xl font-extrabold">{t.settings}</h1>

      {shop.status === "LIVE" && (
        <section className="mt-5 rounded-[var(--radius-board)] border-2 border-ink bg-card p-4 text-center">
          <h2 className="font-display text-xl font-bold">{t.shareStore}</h2>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} alt={`QR code for ${storeUrl}`} className="mx-auto mt-3 w-48" />
          <p className="mt-2 text-sm text-ink-soft">Print this and stick it at your counter.</p>
          <ShareLink url={storeUrl} text={shareText} labels={{ copy: t.copyLink, copied: t.copied }} />
          {env.munshiNumber && (
            <p className="mt-3 text-sm">
              {t.callToOrder}: <strong>{shop.munshiNumber ?? env.munshiNumber}</strong>, shop code <strong>{shop.shopCode}</strong>
            </p>
          )}
        </section>
      )}

      <SettingsForm
        t={t}
        shop={{
          name: shop.name ?? "",
          tagline: shop.tagline ?? "",
          address: shop.address ?? "",
          timings: shop.timings ?? "",
          deliveryMode: shop.deliveryMode,
          deliveryFee: shop.deliveryFee,
          minOrder: shop.minOrder,
          deliveryNote: shop.deliveryNote ?? "",
          language: shop.language,
        }}
      />

      <form action={logout} className="mt-8">
        <button type="submit" className="w-full rounded-xl border border-line py-3 font-semibold text-ink-soft">
          {t.logout}
        </button>
      </form>
    </Page>
  );
}
