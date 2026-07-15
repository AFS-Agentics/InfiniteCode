import defaultMdxComponents, { createRelativeLink } from "fumadocs-ui/mdx";
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
} from "fumadocs-ui/page";
import { source } from "@/lib/source";

type DocsPageEntry = NonNullable<ReturnType<typeof source.getPage>>;

export function renderDocsPage(page: DocsPageEntry) {
  const MDX = page.data.body;
  const components = {
    ...defaultMdxComponents,
    a: createRelativeLink(source, page),
  };

  return (
    <DocsPage toc={page.data.toc}>
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription>{page.data.description}</DocsDescription>
      <DocsBody>
        <MDX components={components} />
      </DocsBody>
    </DocsPage>
  );
}
