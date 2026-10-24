// Matches what a buyer or owner says ("2 packet maggi", "godhi hittu", "आटा") to catalog products.
// Deterministic on purpose: the voice agent's LLM extracts item names, this decides which product.

export interface Matchable {
  id: string;
  name: string;
  nameLocal?: string | null;
  size?: string | null;
  aliases?: string[];
}

export interface Match<T extends Matchable> {
  product: T;
  score: number;
}

const STOP_WORDS = new Set([
  "the", "a", "an", "of", "and", "pack", "packet", "packets", "pkt", "piece", "pieces", "pcs",
  "kilo", "kg", "g", "gm", "gram", "grams", "litre", "liter", "ltr", "l", "ml", "rs", "rupees",
  "rupaye", "please", "give", "want", "need", "send", "one", "two", "ek", "do",
]);

export function normalize(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(text: string): string[] {
  return normalize(text)
    .split(" ")
    // Numbers and pack sizes ("5", "5kg", "500ml") describe the variant, not the item.
    .filter((t) => t && !STOP_WORDS.has(t) && !/^\d+(\.\d+)?[a-z]{0,5}$/.test(t));
}

/** Small edit distance so "aashirwad" still finds "aashirvaad". */
function similar(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 4 || b.length < 4) return false;
  if (a.startsWith(b) || b.startsWith(a)) return true;
  const limit = Math.max(a.length, b.length) > 7 ? 2 : 1;
  if (Math.abs(a.length - b.length) > limit) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length] <= limit;
}

export function scoreProduct(query: string, product: Matchable): number {
  const q = normalize(query);
  if (!q) return 0;
  const name = normalize(product.name);
  const local = product.nameLocal ? normalize(product.nameLocal) : "";
  const aliases = (product.aliases ?? []).map(normalize);

  if (q === name || (local && q === local) || aliases.includes(q)) return 1;

  let score = 0;
  if (name.includes(q) || (local && local.includes(q))) score = Math.max(score, 0.85);
  const qTokens = tokens(query);
  for (const a of aliases) {
    if (a.length <= 2) continue;
    if (a.includes(q)) score = Math.max(score, 0.8);
    // An alias inside a longer request only counts for the part it covers, so a brand alias
    // ("amul") can't turn "amul butter" into Amul ghee.
    else if (q.includes(a)) score = Math.max(score, 0.8 * Math.min(1, tokens(a).length / Math.max(1, qTokens.length)));
  }

  const pTokens = new Set([...tokens(product.name), ...tokens(product.nameLocal ?? ""), ...aliases.flatMap((a) => a.split(" "))]);
  if (qTokens.length && pTokens.size) {
    let hits = 0;
    for (const t of qTokens) if ([...pTokens].some((p) => similar(t, p))) hits++;
    score = Math.max(score, 0.75 * (hits / qTokens.length));
  }

  // Prefer the pack size the buyer mentioned ("5 kg atta" vs "1 kg atta").
  const size = product.size ? normalize(product.size).replace(/\s/g, "") : "";
  const qCompact = q.replace(/\s/g, "");
  // Digit boundary so "5kg" doesn't match inside "15kg".
  // normalize() leaves only letters and digits, so size is safe to drop into a RegExp.
  if (score > 0 && size && new RegExp(`(^|\\D)${size}`).test(qCompact)) {
    score = Math.min(1, score + 0.15);
  }
  return score;
}

export function findMatches<T extends Matchable>(query: string, products: T[], limit = 5, minScore = 0.4): Match<T>[] {
  return products
    .map((product) => ({ product, score: scoreProduct(query, product) }))
    .filter((m) => m.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** A match is safe to use without asking only if it is strong and clearly ahead of the runner-up. */
export function confidentMatch<T extends Matchable>(query: string, products: T[]): T | null {
  const [first, second] = findMatches(query, products, 2);
  if (!first || first.score < 0.6) return null;
  // Two equally good candidates (e.g. "atta" with 5 kg and 10 kg packs): ask, don't guess.
  if (second && first.score - second.score < 0.1) return null;
  return first.product;
}

const UNIT_WORDS: Record<string, string> = {
  kilo: "kg", kilos: "kg", kg: "kg", kgs: "kg", kilogram: "kg",
  g: "g", gm: "g", gms: "g", gram: "g", grams: "g",
  l: "L", ltr: "L", litre: "L", liter: "L", litres: "L", liters: "L",
  ml: "ml", dozen: "dozen", piece: "pc", pieces: "pc", pc: "pc", pcs: "pc", packet: "pack", pack: "pack",
};

export interface SpokenItem {
  name: string;
  size: string | null;
  price: number | null;
}

/**
 * Fallback parser for owner speech like "Aashirvaad atta 5 kilo 260 rupees".
 * Used when the AgenticOrg Catalog agent is unavailable; the owner still approves the draft.
 */
export function parseSpokenItem(text: string): SpokenItem {
  let rest = ` ${text.replace(/₹\s*(\d+)/g, "$1 rupees")} `;
  let price: number | null = null;
  const priceMatch =
    rest.match(/(\d+(?:\.\d+)?)\s*(?:rs\.?|rupees?|rupaye|rupay|bucks)\b/i) ??
    rest.match(/\b(?:rs\.?|price|for)\s*(\d+(?:\.\d+)?)/i);
  if (priceMatch) {
    price = Math.round(Number(priceMatch[1]));
    rest = rest.replace(priceMatch[0], " ");
  }

  let size: string | null = null;
  const sizeMatch = rest.match(/(\d+(?:\.\d+)?)\s*(kilos?|kgs?|kilogram|grams?|gms?|gm|g|litres?|liters?|ltr|l|ml|dozen|pieces?|pcs?|pc|packets?|pack)\b/i);
  if (sizeMatch) {
    size = `${sizeMatch[1]} ${UNIT_WORDS[sizeMatch[2].toLowerCase()] ?? sizeMatch[2]}`;
    rest = rest.replace(sizeMatch[0], " ");
  }

  if (price === null) {
    // A trailing bare number after the name is almost always the price.
    const trailing = rest.match(/(\d+)\s*$/);
    if (trailing) {
      price = Number(trailing[1]);
      rest = rest.replace(trailing[0], " ");
    }
  }

  const name = rest.replace(/\s+/g, " ").trim().replace(/^\w/, (c) => c.toUpperCase());
  return { name, size, price };
}
