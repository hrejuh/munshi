import type { Shop } from "@prisma/client";
import { liveProducts } from "./catalog";
import { env } from "./env";
import { dict, FIRST_MESSAGES, isLang } from "./i18n";

/** Everything the storefront needs, shared by the public page and the owner's preview. */
export async function storefrontProps(shop: Shop) {
  const lang = isLang(shop.language) ? shop.language : "en";
  const t = dict(lang);
  const products = await liveProducts(shop.id);
  const deliveryLabel = shop.deliveryMode === "DELIVERY" ? t.delivery : shop.deliveryMode === "PICKUP" ? t.pickup : t.both;
  return {
    lang,
    t,
    deliveryLabel: shop.deliveryFee && shop.deliveryMode !== "PICKUP" ? `${deliveryLabel}, ₹${shop.deliveryFee}` : deliveryLabel,
    firstMessage: FIRST_MESSAGES[lang].order.replace("{{shop_name}}", shop.name ?? ""),
    phoneLine: env.munshiNumber ? { number: shop.munshiNumber ?? env.munshiNumber, code: shop.shopCode } : null,
    products: products.map((p) => ({
      id: p.id,
      name: p.name,
      nameLocal: p.nameLocal,
      size: p.size,
      price: p.price,
      category: p.category,
      imageId: p.imageId,
    })),
  };
}
