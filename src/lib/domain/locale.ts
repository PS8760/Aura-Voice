/**
 * Supported locales for Aura Voice CX.
 *
 * English is the canonical language: every message key is defined in English and
 * other locales fall back to it when a translation is missing. That fallback is
 * deliberate — it is better to answer clearly in English than to ship a wrong
 * translation.
 */

export const LOCALES = ["en", "hi", "bn", "ta", "mr"] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

export const LOCALE_META: Record<Locale, { label: string; native: string; flag: string }> = {
  en: { label: "English", native: "English", flag: "EN" },
  hi: { label: "Hindi", native: "हिन्दी", flag: "HI" },
  bn: { label: "Bengali", native: "বাংলা", flag: "BN" },
  ta: { label: "Tamil", native: "தமிழ்", flag: "TA" },
  mr: { label: "Marathi", native: "मराठी", flag: "MR" },
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

export function toLocale(value: unknown, fallback: Locale = DEFAULT_LOCALE): Locale {
  return isLocale(value) ? value : fallback;
}
