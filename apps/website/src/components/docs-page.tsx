import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ComponentType, ReactNode } from "react";

import { AAdsPill } from "@/components/a-ads-pill";
import {
	DocsContent,
	DocsSidebar,
	type TOCHeading,
} from "@/components/docs-layout";
import type { SidebarNode } from "@/lib/sidebar";

// MDX components map keys to concrete-prop React components; `any` lets each
// element keep its own prop shape (children, href, id, etc.) without TS bivariance friction.
type MDXComponentsMap = Record<string, ComponentType<any>>;

type MDXContentProps = {
	components?: MDXComponentsMap;
	[key: string]: unknown;
};
type MDXContent = ComponentType<MDXContentProps>;

type DocsPageProps = {
	sidebar: SidebarNode[];
	Page: MDXContent;
	title: string;
	description?: string;
};

function slugifyHeading(raw: string): string {
	return raw
		.toLowerCase()
		.replace(/[^a-z0-9\s-]/g, "")
		.trim()
		.replace(/\s+/g, "-");
}

function HeadingH2({ children, id }: { children?: ReactNode; id?: string }) {
	const text = children?.toString() ?? "";
	return (
		<h2 id={id} tabIndex={-1} className="docs-h2 scroll-mt-24">
			{text}
			<a
				aria-label="Anchor"
				className="ml-2 align-middle text-xs text-muted-foreground/40 opacity-0 transition-opacity hover:opacity-100"
				href={`#${id ?? ""}`}
			>
				#
			</a>
		</h2>
	);
}

function HeadingH3({ children, id }: { children?: ReactNode; id?: string }) {
	const text = children?.toString() ?? "";
	return (
		<h3 id={id} tabIndex={-1} className="docs-h3 scroll-mt-24">
			{text}
			<a
				aria-label="Anchor"
				className="ml-2 align-middle text-[0.66rem] text-muted-foreground/40 opacity-0 transition-opacity hover:opacity-100"
				href={`#${id ?? ""}`}
			>
				#
			</a>
		</h3>
	);
}

function CodeFencePre({ children }: { children?: ReactNode }) {
	return <pre className="docs-pre">{children}</pre>;
}

function LinkAnchor({ href, children }: { href?: string; children?: ReactNode }) {
	const isExternal = href?.startsWith("http") || href?.startsWith("mailto:");
	if (isExternal) {
		return (
			<a className="docs-link" href={href} rel="noreferrer" target="_blank">
				{children}
			</a>
		);
	}
	return (
		<a className="docs-link" href={href}>
			{children}
		</a>
	);
}

const docsComponents: MDXComponentsMap = {
	h1: (props: { children?: ReactNode }) => <h1 className="sr-only" {...props} />,
	h2: HeadingH2,
	h3: HeadingH3,
	a: LinkAnchor,
	pre: CodeFencePre,
};

export { docsComponents };

export function DocsPage({ sidebar, Page, title, description }: DocsPageProps) {
	const articleRef = useRef<HTMLDivElement>(null);
	const [toc, setToc] = useState<TOCHeading[]>([]);

	// useLayoutEffect runs synchronously before paint to ensure h2/h3 ids are
	// present when the user sees the page (avoids a one-frame empty TOC).
	useLayoutEffect(() => {
		const root = articleRef.current;
		if (!root) return;
		const headings = Array.from(root.querySelectorAll("h2, h3")) as HTMLElement[];
		const seen = new Set<string>();
		const items: TOCHeading[] = headings.map((node) => {
			let id = node.id || slugifyHeading(node.textContent ?? "");
			let attempt = id;
			let n = 1;
			while (seen.has(attempt)) {
				attempt = `${id}-${n++}`;
			}
			seen.add(attempt);
			node.id = attempt;
			return {
				depth: Number(node.tagName.slice(1)),
				value: node.textContent ?? "",
				id: attempt,
			};
		});
		setToc(items);
	}, []);

	const compiled = useMemo(() => <Page components={docsComponents} />, [Page]);

	return (
		<div className="mx-auto flex w-full max-w-7xl gap-10 px-4 py-12 sm:px-6 lg:px-8">
			<aside className="sticky top-24 hidden h-[calc(100vh-7rem)] w-64 shrink-0 overflow-y-auto lg:block">
				<DocsSidebar sidebar={sidebar} />
				<div className="mt-4">
					<AAdsPill unitId={2448650} />
				</div>
			</aside>
			<div className="flex w-full min-w-0 flex-1 flex-col">
				<DocsContent title={title} description={description} toc={toc}>
					<div ref={articleRef}>{compiled}</div>
				</DocsContent>
				<div className="mt-8">
					<AAdsPill unitId={2448649} />
				</div>
			</div>
		</div>
	);
}
