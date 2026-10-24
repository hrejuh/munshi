"use client";

import { useActionState, useState } from "react";
import { Button, ErrorNote, Field, inputClass } from "@/components/ui";
import { LANGUAGES, dict, type Lang } from "@/lib/i18n";
import { signUp } from "./actions";

export function SignUpForm() {
  const [lang, setLang] = useState<Lang>("kn");
  const [state, action, pending] = useActionState(signUp, undefined);
  const t = dict(lang);

  return (
    <form action={action} className="space-y-6">
      <fieldset>
        <legend className="mb-3 font-display text-xl font-bold">{t.chooseLanguage}</legend>
        <div className="grid grid-cols-2 gap-3">
          {LANGUAGES.map((l) => (
            <label
              key={l.code}
              className={`cursor-pointer rounded-xl border-2 px-4 py-3 text-center transition-colors ${
                lang === l.code ? "border-ink bg-turmeric/30" : "border-line bg-card"
              }`}
            >
              <input type="radio" name="language" value={l.code} checked={lang === l.code} onChange={() => setLang(l.code)} className="sr-only" />
              <span lang={l.code} className="block font-display text-2xl font-bold">{l.label}</span>
              <span className="text-xs text-mute">{l.english}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <Field label={t.yourName}>
        <input name="name" autoComplete="name" required className={inputClass} placeholder="Ganesh" />
      </Field>
      <Field label={t.phone}>
        <input name="phone" type="tel" inputMode="numeric" autoComplete="tel" required className={inputClass} placeholder="98450 12345" />
      </Field>

      <ErrorNote>{state?.error}</ErrorNote>
      <Button type="submit" disabled={pending} className="w-full py-4 text-lg">
        {t.continue}
      </Button>
    </form>
  );
}
