"use client";

import { useRouter } from "next/navigation";
import { useActionState, useMemo, useState } from "react";
import { Button, ErrorNote, Field, inputClass } from "@/components/ui";
import { VoiceAgent } from "@/components/VoiceAgent";
import type { Dict } from "@/lib/i18n";
import { buildPreview, saveDraftFields } from "../actions";

interface DraftShop {
  name: string | null;
  category: string | null;
  address: string | null;
  area: string | null;
  timings: string | null;
  deliveryMode: string;
  deliveryFee: number;
  minOrder: number;
  tagline: string | null;
}

const CATEGORY_LABELS: Record<string, string> = {
  kirana: "Kirana / grocery",
  bakery: "Bakery",
  stationery: "Stationery",
  "fruits-veg": "Fruits and vegetables",
};

export function OnboardClient({ lang, t, firstMessage, ownerName, shop }: { lang: string; t: Dict; firstMessage: string; ownerName: string; shop: DraftShop }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [state, save, saving] = useActionState(saveDraftFields, undefined);
  const [, preview, building] = useActionState(buildPreview, undefined);
  const dynamicVariables = useMemo(() => ({ owner_name: ownerName, language: lang, channel: "web" }), [ownerName, lang]);

  const modeLabel = shop.deliveryMode === "DELIVERY" ? t.delivery : shop.deliveryMode === "PICKUP" ? t.pickup : t.both;
  const rows: Array<[string, string | null]> = [
    [t.shopName, shop.name],
    [t.category, shop.category ? CATEGORY_LABELS[shop.category] ?? shop.category : null],
    [t.address, [shop.address, shop.area].filter(Boolean).join(", ") || null],
    [t.timings, shop.timings],
    [t.delivery, shop.name ? `${modeLabel}${shop.deliveryFee ? `, ₹${shop.deliveryFee} fee` : ""}` : null],
  ];
  const ready = Boolean(shop.name && shop.category && shop.address && shop.timings);

  return (
    <div className="mt-5 space-y-6">
      <VoiceAgent
        kind="setup"
        lang={lang}
        labels={t}
        firstMessage={firstMessage}
        dynamicVariables={dynamicVariables}
        onToolResponse={() => router.refresh()}
        onFallbackText={async () => {
          setEditing(true);
          return "Voice is not connected yet, so fill in your shop details in the form below.";
        }}
      />

      <section className="rounded-[var(--radius-board)] border-2 border-ink bg-card p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl font-bold">{t.draftStore}</h2>
          <button type="button" onClick={() => setEditing((v) => !v)} className="text-sm font-semibold text-leaf underline">
            {editing ? t.cancel : t.edit}
          </button>
        </div>

        {!editing ? (
          <dl className="mt-3 divide-y divide-line">
            {rows.map(([label, value]) => (
              <div key={label} className="flex justify-between gap-4 py-2.5">
                <dt className="text-sm text-mute">{label}</dt>
                <dd className={`text-right text-[15px] font-semibold ${value ? "" : "text-mute/60"}`}>{value ?? "…"}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <form
            action={async (fd) => {
              await save(fd);
              setEditing(false);
              router.refresh();
            }}
            className="mt-3 space-y-3"
          >
            <Field label={t.shopName}>
              <input name="name" defaultValue={shop.name ?? ""} className={inputClass} required />
            </Field>
            <Field label={t.category}>
              <select name="category" defaultValue={shop.category ?? "kirana"} className={inputClass}>
                {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </Field>
            <Field label={t.address}>
              <input name="address" defaultValue={shop.address ?? ""} className={inputClass} required />
            </Field>
            <Field label="Area">
              <input name="area" defaultValue={shop.area ?? ""} className={inputClass} placeholder="Jayanagar 4th Block" />
            </Field>
            <Field label={t.timings}>
              <input name="timings" defaultValue={shop.timings ?? ""} className={inputClass} placeholder="7 am to 10 pm, all days" required />
            </Field>
            <Field label={t.delivery}>
              <select name="deliveryMode" defaultValue={shop.deliveryMode} className={inputClass}>
                <option value="both">{t.both}</option>
                <option value="delivery">{t.delivery}</option>
                <option value="pickup">{t.pickup}</option>
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t.deliveryFee}>
                <input name="deliveryFee" type="number" min={0} defaultValue={shop.deliveryFee} className={inputClass} />
              </Field>
              <Field label={t.minOrder}>
                <input name="minOrder" type="number" min={0} defaultValue={shop.minOrder} className={inputClass} />
              </Field>
            </div>
            <ErrorNote>{state?.error}</ErrorNote>
            <Button type="submit" tone="ink" disabled={saving} className="w-full">{t.save}</Button>
          </form>
        )}
      </section>

      <form action={preview}>
        <Button type="submit" disabled={!ready || building} className="w-full py-4 text-lg">
          {building ? "Munshi is writing your store page…" : t.seePreview}
        </Button>
      </form>
    </div>
  );
}
