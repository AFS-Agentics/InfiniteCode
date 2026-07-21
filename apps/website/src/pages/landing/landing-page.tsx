import { useEffect, useState } from "react";
import { AAdsPill } from "@/components/a-ads-pill";
import { AgenticsSection } from "./agentics-section";
import { ClosingSection } from "./closing-section";
import { ComparisonSection } from "./comparison-section";
import { EnterpriseSection } from "./enterprise-section";
import { landingCopy, localeCookieName, type Locale } from "./data";
import { HeroSection } from "./hero-section";
import { ProofSection } from "./proof-section";
import { WorkflowSection } from "./workflow-section";

type LandingPageProps = {
	initialLocale?: Locale;
};

export function LandingPage({ initialLocale = "en" }: LandingPageProps) {
	const [locale, setLocale] = useState<Locale>(initialLocale);
	const copy = landingCopy[locale];
	const docsHref = locale === "zh" ? "/zh/docs" : "/docs";

	useEffect(() => {
		document.cookie = `${localeCookieName}=${locale}; Path=/; Max-Age=31536000; SameSite=Lax`;
	}, [locale]);

	return (
		<main className="min-h-screen overflow-hidden bg-[#070a0f] font-sans text-white" lang={locale === "zh" ? "zh-CN" : "en"}>
			<AAdsPill unitId={2448649} />
			<HeroSection copy={copy} locale={locale} onLocaleChange={setLocale} />
			<AAdsPill unitId={2448654} />
			<ComparisonSection copy={copy.comparison} />
			<AAdsPill unitId={2448656} />
			<ProofSection rows={copy.proofRows} />
			<AAdsPill unitId={2448655} />
			<AgenticsSection copy={copy.agentics} locale={locale} />
			<AAdsPill unitId={2448657} />
			<WorkflowSection copy={copy.workflow} />
			<AAdsPill unitId={2448653} />
			<EnterpriseSection copy={copy.enterprise} />
			<AAdsPill unitId={2448652} />
			<ClosingSection copy={copy.closing} docsHref={docsHref} />
			<AAdsPill unitId={2448650} />
			<AAdsPill unitId={2448651} />
			<AAdsPill unitId={2448648} />
		</main>
	);
}
