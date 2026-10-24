"use client";

import { useActionState } from "react";
import { Button, ErrorNote, Field, inputClass } from "@/components/ui";
import { LANGUAGES, type Dict } from "@/lib/i18n";
import { saveSettings } from "../actions";

interface ShopSettings {
  name: string;
  tagline: string;
  address: string;
  timings: string;
  deliveryMode: string;
  deliveryFee: number;
  minOrder: number;
  deliveryNote: string;
  language: string;
}

export function SettingsForm({ t, shop }: { t: Dict; shop: ShopSettings }) {
  const [state, action, pending] = useActionState(saveSettings, undefined);
  return (
    <form action={action} className="mt-6 space-y-4">
      <Field label={t.shopName}>
        <input name="name" defaultValue={shop.name} required className={inputClass} />
      </Field>
      <Field label="Tagline">
        <input name="tagline" defaultValue={shop.tagline} className={inputClass} />
      </Field>
      <Field label={t.address}>
        <input name="address" defaultValue={shop.address} className={inputClass} />
      </Field>
      <Field label={t.timings}>
        <input name="timings" defaultValue={shop.timings} className={inputClass} />
      </Field>
      <Field label={t.delivery}>
        <select name="deliveryMode" defaultValue={shop.deliveryMode} className={inputClass}>
          <option value="BOTH">{t.both}</option>
          <option value="DELIVERY">{t.delivery}</option>
          <option value="PICKUP">{t.pickup}</option>
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={`${t.deliveryFee} (₹)`}>
          <input name="deliveryFee" type="number" min={0} defaultValue={shop.deliveryFee} className={inputClass} />
        </Field>
        <Field label={`${t.minOrder} (₹)`}>
          <input name="minOrder" type="number" min={0} defaultValue={shop.minOrder} className={inputClass} />
        </Field>
      </div>
      <Field label="Delivery area note" hint="Shown to buyers at checkout">
        <input name="deliveryNote" defaultValue={shop.deliveryNote} placeholder="Within 2 km of Jayanagar 4th Block" className={inputClass} />
      </Field>
      <Field label={t.chooseLanguage}>
        <select name="language" defaultValue={shop.language} className={inputClass}>
          {LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>{l.label} ({l.english})</option>
          ))}
        </select>
      </Field>
      <ErrorNote>{state?.error}</ErrorNote>
      {state?.ok && <p className="text-sm font-semibold text-leaf">Saved.</p>}
      <Button type="submit" tone="ink" disabled={pending} className="w-full">{t.save}</Button>
    </form>
  );
}
