// Demo data for local testing: one live kirana with 30 approved products.
// Sign in at /start with phone 9999900001 to see it as the owner.
import { PrismaClient } from "@prisma/client";
import kirana from "../data/templates/kirana.json";

const db = new PrismaClient();

async function main() {
  const phone = "+919999900001";
  const existing = await db.shop.findUnique({ where: { phone } });
  if (existing) {
    console.log(`Demo shop already exists: /s/${existing.slug}`);
    return;
  }
  const shop = await db.shop.create({
    data: {
      slug: "ganesh-provision-stores-demo",
      shopCode: "1001",
      ownerName: "Ganesh",
      phone,
      language: "kn",
      name: "Ganesh Provision Stores",
      category: "kirana",
      address: "12, 9th Main Road",
      area: "Jayanagar 4th Block",
      timings: "7 am to 10 pm, all days",
      tagline: "ನಿಮ್ಮ ನೆರೆಹೊರೆಯ ವಿಶ್ವಾಸಾರ್ಹ ಅಂಗಡಿ (Your trusted neighbourhood shop)",
      deliveryMode: "BOTH",
      deliveryFee: 20,
      minOrder: 100,
      deliveryNote: "Within 2 km of Jayanagar 4th Block",
      status: "LIVE",
      approvedAt: new Date(),
    },
  });
  for (const item of kirana.items.slice(0, 30)) {
    await db.product.create({
      data: {
        shopId: shop.id,
        name: item.name,
        nameLocal: item.local.kn,
        size: item.size,
        price: item.price,
        category: item.group,
        aliases: [...item.aliases, item.local.hi, item.local.kn, item.local.ta],
        templateId: item.id,
        source: "TEMPLATE",
        status: "APPROVED",
      },
    });
  }
  console.log(`Seeded demo shop: /s/${shop.slug}`);
}

main().finally(() => db.$disconnect());
