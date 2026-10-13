"use client";

import { Languages } from "lucide-react";

import { LOCALES, LOCALE_META, type Locale } from "@/lib/domain/locale";

export function LanguageSelector({
  locale,
  onLocaleChange,
}: {
  locale: Locale;
  onLocaleChange: (locale: Locale) => void;
}) {
  return (
    <label className="inline-flex items-center gap-1.5 rounded-full border border-line bg-panel px-2.5 py-1 text-[11px] font-medium text-muted">
      <Languages size={12} aria-hidden />
      <span className="sr-only">Conversation language</span>
      <select
        value={locale}
        onChange={(event) => onLocaleChange(event.target.value as Locale)}
        aria-label="Conversation language"
        className="cursor-pointer bg-transparent text-[11px] font-medium text-muted outline-none"
      >
        {LOCALES.map((code) => (
          <option key={code} value={code}>
            {LOCALE_META[code].native} · {LOCALE_META[code].label}
          </option>
        ))}
      </select>
    </label>
  );
}
