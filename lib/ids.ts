import { randomInt } from "node:crypto";

const SLUG_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export function randomSuffix(length = 4): string {
  let out = "";
  for (let i = 0; i < length; i++) out += SLUG_ALPHABET[randomInt(SLUG_ALPHABET.length)];
  return out;
}

/** Digits only: easy to read aloud on a phone call in any language. */
export function numericCode(length: number): string {
  let out = String(randomInt(1, 10));
  for (let i = 1; i < length; i++) out += String(randomInt(10));
  return out;
}

/** Indian mobile numbers to +91XXXXXXXXXX; anything else is kept as typed digits. */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) return `+91${digits.slice(1)}`;
  return digits ? `+${digits}` : "";
}
