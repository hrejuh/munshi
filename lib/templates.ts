import kirana from "@/data/templates/kirana.json";
import bakery from "@/data/templates/bakery.json";
import stationery from "@/data/templates/stationery.json";
import fruitsVeg from "@/data/templates/fruits-veg.json";

export interface TemplateItem {
  id: string;
  name: string;
  size: string;
  group: string;
  price: number;
  local: { hi: string; kn: string; ta: string };
  aliases: string[];
}

export interface CategoryTemplate {
  category: string;
  label: { en: string; hi: string; kn: string; ta: string };
  items: TemplateItem[];
}

export const TEMPLATES: CategoryTemplate[] = [kirana, bakery, stationery, fruitsVeg] as CategoryTemplate[];

export function getTemplate(category: string | null | undefined): CategoryTemplate | undefined {
  return TEMPLATES.find((t) => t.category === category);
}

export function findTemplateItem(id: string): TemplateItem | undefined {
  for (const t of TEMPLATES) {
    const item = t.items.find((i) => i.id === id);
    if (item) return item;
  }
  return undefined;
}

/** Maps whatever the owner said ("grocery", "dinasi", "cake shop") to one of our templates. */
export function guessCategory(text: string | null | undefined): string {
  const t = (text ?? "").toLowerCase();
  if (/bak|cake|bread|sweet|mithai|ಬೇಕರಿ|बेकरी|பேக்கரி/.test(t)) return "bakery";
  if (/station|book|pen|xerox|ಸ್ಟೇಷನರಿ|स्टेशनरी/.test(t)) return "stationery";
  if (/fruit|veg|sabzi|sabji|tarkari|ತರಕಾರಿ|सब्ज|காய்கறி|பழ/.test(t)) return "fruits-veg";
  return "kirana";
}
