"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { isLang } from "@/lib/i18n";
import { normalizePhone } from "@/lib/ids";
import { startOwnerSession } from "@/lib/session";
import { createShop } from "@/lib/shops";

export async function signUp(_prev: { error?: string } | undefined, form: FormData) {
  const name = String(form.get("name") ?? "").trim();
  const phone = normalizePhone(String(form.get("phone") ?? ""));
  const language = String(form.get("language") ?? "en");
  if (!name) return { error: "Enter your name" };
  if (!/^\+91\d{10}$/.test(phone) && !/^\+\d{10,15}$/.test(phone)) return { error: "Enter a valid 10-digit phone number" };

  // PRD: phone + name sign-up, no OTP for the event build. Returning owners sign back in by phone.
  const existing = await db.shop.findUnique({ where: { phone } });
  const shop = existing ?? (await createShop(name, phone, isLang(language) ? language : "en"));
  if (existing && isLang(language) && existing.language !== language) {
    await db.shop.update({ where: { id: existing.id }, data: { language } });
  }
  await startOwnerSession(shop.id);
  redirect("/app");
}
