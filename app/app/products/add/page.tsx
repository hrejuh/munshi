import { Page } from "@/components/ui";
import { dict } from "@/lib/i18n";
import { requireShop } from "@/lib/session";
import { AddByVoice } from "./AddByVoice";

export const dynamic = "force-dynamic";

export default async function AddPage({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  const shop = await requireShop();
  const t = dict(shop.language);
  const mode = (await searchParams).mode === "photo" ? "photo" : "voice";
  return (
    <Page>
      <h1 className="font-display text-3xl font-extrabold">{mode === "photo" ? t.photoSpeak : t.speakItem}</h1>
      <p className="mt-1 text-[15px] text-ink-soft">{mode === "photo" ? t.photoSpeakHint : t.speakItemHint}</p>
      <AddByVoice t={t} mode={mode} />
    </Page>
  );
}
