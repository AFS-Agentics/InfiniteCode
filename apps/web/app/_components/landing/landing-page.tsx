"use client";

import { useEffect, useState } from "react";

import { ClosingSection } from "./closing-section";
import { landingCopy, localeCookieName, type Locale } from "./data";
import { HeroSection } from "./hero-section";
import { InstallSection } from "./install-section";
import { ProofSection } from "./proof-section";
import { WorkflowSection } from "./workflow-section";

type LandingPageProps = {
  initialLocale: Locale;
};

export function LandingPage({ initialLocale }: LandingPageProps) {
  const [locale, setLocale] = useState(initialLocale);
  const copy = landingCopy[locale];
  const docsHref = locale === "zh" ? "/zh/docs" : "/docs";

  useEffect(() => {
    document.cookie = `${localeCookieName}=${locale}; Path=/; Max-Age=31536000; SameSite=Lax`;
  }, [locale]);

  function selectLocale(nextLocale: Locale) {
    setLocale(nextLocale);
  }

  return (
    <main
      className="min-h-screen overflow-hidden bg-[#070a0f] font-sans text-white"
      lang={locale === "zh" ? "zh-CN" : "en"}
    >
      <HeroSection
        copy={copy}
        locale={locale}
        onLocaleChange={selectLocale}
      />
      <ProofSection rows={copy.proofRows} />
      <WorkflowSection copy={copy.workflow} />
      <InstallSection copy={copy.install} docsHref={docsHref} />
      <ClosingSection copy={copy.closing} docsHref={docsHref} />
    </main>
  );
}
