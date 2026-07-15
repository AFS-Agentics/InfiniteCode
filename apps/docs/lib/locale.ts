export const localeCookieName = "devo-locale";

export const supportedLocales = ["en", "zh"] as const;

export type Locale = (typeof supportedLocales)[number];

export function normalizeLocale(value: string | undefined): Locale | null {
  if (!value) {
    return null;
  }

  const lowered = value.toLowerCase();

  if (supportedLocales.includes(lowered as Locale)) {
    return lowered as Locale;
  }

  if (lowered.startsWith("zh")) {
    return "zh";
  }

  if (lowered.startsWith("en")) {
    return "en";
  }

  return null;
}

export function preferredLocale(
  cookieLocale: string | undefined,
  acceptedLanguages: string | null,
): Locale {
  const normalizedCookieLocale = normalizeLocale(cookieLocale);

  if (normalizedCookieLocale) {
    return normalizedCookieLocale;
  }

  for (const language of (acceptedLanguages ?? "").split(",")) {
    const locale = normalizeLocale(language.trim().split(";")[0]);

    if (locale) {
      return locale;
    }
  }

  return "en";
}
