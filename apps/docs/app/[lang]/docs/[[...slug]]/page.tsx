import { notFound } from "next/navigation";
import { renderDocsPage } from "@/lib/docs-page";
import {
  isLocalizedDocsLanguage,
  localizedDocsLanguages,
} from "@/lib/layout.shared";
import { source } from "@/lib/source";

export const dynamic = "force-static";
export const dynamicParams = false;

export default async function Page({
  params,
}: {
  params: Promise<{ lang: string; slug?: string[] }>;
}) {
  const { slug, lang } = await params;

  if (!isLocalizedDocsLanguage(lang)) {
    notFound();
  }

  const page = source.getPage(slug, lang);

  if (!page) {
    notFound();
  }

  return renderDocsPage(page);
}

export function generateStaticParams() {
  return localizedDocsLanguages.flatMap((lang) =>
    source.getPages(lang).map((page) => ({
      lang,
      slug: page.slugs,
    })),
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string; slug?: string[] }>;
}) {
  const { slug, lang } = await params;

  if (!isLocalizedDocsLanguage(lang)) {
    notFound();
  }

  const page = source.getPage(slug, lang);

  if (!page) {
    notFound();
  }

  return {
    title: page.data.title,
    description: page.data.description,
  };
}
