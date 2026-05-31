import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import defaultMdxComponents from "fumadocs-ui/mdx";
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
} from "fumadocs-ui/page";
import { localeCookieName, preferredLocale } from "@/lib/locale";
import { source } from "@/lib/source";

async function redirectToPreferredDocsLocale(slug: string[] | undefined) {
  const cookieStore = await cookies();
  const headerStore = await headers();
  const locale = preferredLocale(
    cookieStore.get(localeCookieName)?.value,
    headerStore.get("accept-language"),
  );

  if (locale !== "zh") {
    return;
  }

  redirect(`/zh/docs${slug?.length ? `/${slug.join("/")}` : ""}`);
}

export default async function Page({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}) {
  const { slug } = await params;
  await redirectToPreferredDocsLocale(slug);

  const page = source.getPage(slug, "en");

  if (!page) {
    notFound();
  }

  const MDX = page.data.body;

  return (
    <DocsPage toc={page.data.toc}>
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription>{page.data.description}</DocsDescription>
      <DocsBody>
        <MDX components={defaultMdxComponents} />
      </DocsBody>
    </DocsPage>
  );
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
