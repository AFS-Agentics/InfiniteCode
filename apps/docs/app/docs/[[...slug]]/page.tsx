import { notFound } from "next/navigation";
import { renderDocsPage } from "@/lib/docs-page";
import { source } from "@/lib/source";

export const dynamic = "force-static";
export const dynamicParams = false;

export default async function Page({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}) {
  const { slug } = await params;
  const page = source.getPage(slug, "en");

  if (!page) {
    notFound();
  }

  return renderDocsPage(page);
}

export function generateStaticParams() {
  return source.getPages("en").map((page) => ({
    slug: page.slugs,
  }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}) {
  const { slug } = await params;
  const page = source.getPage(slug, "en");

  if (!page) {
    notFound();
  }

  return {
    title: page.data.title,
    description: page.data.description,
  };
}
