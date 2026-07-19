import { Link, Route, Routes, useLocation } from "react-router-dom";

import { DocsPage, docsComponents } from "@/components/docs-page";
import sidebar, {
	isFolderNode,
	isPageNode,
	lookupPage,
	type MdxFrontmatter,
} from "@/lib/sidebar";

function NotFound() {
	return (
		<div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-24 sm:px-6 lg:px-8">
			<h1 className="text-3xl font-bold text-foreground">Page not found</h1>
			<p className="text-muted-foreground">
				The page you're looking for has moved, been renamed, or doesn't exist yet.
			</p>
			<Link className="text-primary underline-offset-4 hover:underline" to="/docs">
				Back to documentation
			</Link>
		</div>
	);
}

function RootMdxRenderer({ frontmatter }: { frontmatter?: MdxFrontmatter }) {
	const rootMdx = lookupPage("/docs");
	if (!rootMdx) return null;
	const Page = rootMdx.default as MDXContent;
	return (
		<div className="docs-prose">
			<Page components={docsComponents} />
		</div>
	);
}

function DocsIndex() {
	const rootEntry = sidebar.find(isPageNode);
	const firstFolder = sidebar.find(isFolderNode);
	const firstPage = firstFolder?.folder.entries.find(isPageNode);
	const rootMdx = lookupPage("/docs");

	return (
		<div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-16 sm:px-6 lg:px-8">
			<h1 className="text-3xl font-bold text-foreground">
				{rootEntry?.entry.name ?? "Documentation"}
			</h1>
			{rootEntry?.entry.description ? (
				<p className="text-base leading-relaxed text-muted-foreground">
					{rootEntry.entry.description}
				</p>
			) : null}
			{rootMdx ? (
				<RootMdxRenderer frontmatter={rootMdx.frontmatter} />
			) : (
				<div className="docs-prose text-base leading-relaxed text-muted-foreground">
					<p>
						Pick a section from the sidebar. New users should start with{" "}
						<Link
							className="text-primary underline-offset-4 hover:underline"
							to="/docs/get-started/quickstart"
						>
							Quickstart
						</Link>
						.
					</p>
					{firstPage ? (
						<p className="mt-3 text-sm">
							Or jump straight to{" "}
							<Link
								className="text-primary underline-offset-4 hover:underline"
								to={firstPage.entry.href}
							>
								{firstPage.entry.name}
							</Link>
							.
						</p>
					) : null}
				</div>
			)}
		</div>
	);
}

type MDXContentProps = {
	components?: Record<string, React.ComponentType<any>>;
	[key: string]: unknown;
};
type MDXContent = React.ComponentType<MDXContentProps>;

function DocsRouteRenderer() {
	const location = useLocation();
	const path = location.pathname.replace(/^\/docs\/?/, "");
	const target = path === "" || path === "/" ? "/docs" : `/docs/${path}`;

	const mdx = lookupPage(target);
	if (mdx) {
		const Page = mdx.default as MDXContent;
		return (
			<DocsPage
				sidebar={sidebar}
				title={mdx.frontmatter?.title ?? "Untitled"}
				description={mdx.frontmatter?.description}
				Page={Page}
			/>
		);
	}

	if (target === "/docs") {
		return <DocsIndex />;
	}

	return <NotFound />;
}

export function DocsRoutes() {
	return (
		<Routes>
			<Route path="*" element={<DocsRouteRenderer />} />
		</Routes>
	);
}
