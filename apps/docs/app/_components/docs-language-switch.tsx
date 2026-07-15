"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { localeCookieName, type Locale } from "@/app/_components/landing/data";
import { i18n } from "@/lib/i18n";
import { docsLocalePath } from "@/lib/layout.shared";

type DocsLanguageSwitchProps = {
  locale: Locale;
};

export function DocsLanguageSwitch({ locale }: DocsLanguageSwitchProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [nextLocale, setNextLocale] = useState<Locale | null>(null);

  useEffect(() => {
    if (!nextLocale) {
      return;
    }

    document.cookie = `${localeCookieName}=${nextLocale}; Path=/; Max-Age=31536000; SameSite=Lax`;
    router.push(docsLocalePath(nextLocale, pathname));
  }, [nextLocale, pathname, router]);

  function selectLocale(nextLocale: Locale) {
    setNextLocale(nextLocale);
  }

  return (
    <div
      aria-label={locale === "zh" ? "选择语言" : "Choose language"}
      className="ms-2 inline-grid grid-cols-2 rounded-lg border bg-fd-secondary/50 p-0.5 text-xs font-medium text-fd-muted-foreground"
      role="group"
    >
      {i18n.languages.map((item) => (
        <button
          aria-pressed={locale === item}
          className="min-h-7 rounded-md px-2 transition-colors hover:bg-fd-accent hover:text-fd-accent-foreground aria-pressed:bg-fd-primary/10 aria-pressed:text-fd-primary"
          key={item}
          onClick={() => selectLocale(item)}
          type="button"
        >
          {item === "zh" ? "中文" : "EN"}
        </button>
      ))}
    </div>
  );
}
