import type { ReactNode } from "react";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { RootProvider } from "fumadocs-ui/provider/next";
import { DocsLanguageSwitch } from "@/app/_components/docs-language-switch";
import { docsI18nProvider } from "@/lib/layout.shared";
import { source } from "@/lib/source";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <RootProvider i18n={docsI18nProvider("en")}>
      <DocsLayout
        i18n={false}
        tree={source.getPageTree("en")}
        nav={{
          title: "Devo",
          children: <DocsLanguageSwitch locale="en" />,
        }}
      >
        {children}
      </DocsLayout>
    </RootProvider>
  );
}
