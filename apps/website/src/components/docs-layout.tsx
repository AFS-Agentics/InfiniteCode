import { Link, useLocation } from "react-router-dom";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import {
	isFolderNode,
	type SidebarEntry,
	type SidebarNode,
} from "@/lib/sidebar";

type DocsLayoutProps = {
	sidebar: SidebarNode[];
	children: ReactNode;
};

function PageLink({ entry, isActive }: { entry: SidebarEntry; isActive: boolean }) {
	return (
		<Link
			to={entry.href}
			className={cn(
				"flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors",
				isActive
					? "bg-primary/15 text-primary"
					: "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
			)}
		>
			<span
				aria-hidden="true"
				className="size-1.5 rounded-full bg-muted-foreground/40"
			/>
			<span className="truncate">{entry.name}</span>
		</Link>
	);
}

function SidebarItem({
	node,
	pathKey,
}: {
	node: SidebarNode;
	pathKey: string;
}) {
	const location = useLocation();

	if (isFolderNode(node)) {
		return (
			<div className="mt-2 flex flex-col gap-0.5">
				<p className="px-2.5 pb-1 pt-2 text-[0.66rem] font-semibold uppercase tracking-wider text-foreground/55">
					{node.folder.title}
				</p>
				{node.folder.entries.map((child, idx) => {
					const childKey = isFolderNode(child)
						? `${pathKey}/f/${child.folder.folder}/${idx}`
						: `${pathKey}/p/${child.entry.href}`;
					return (
						<SidebarItem key={childKey} node={child} pathKey={childKey} />
					);
				})}
			</div>
		);
	}

	const isActive = location.pathname === node.entry.href;
	return <PageLink entry={node.entry} isActive={isActive} />;
}

export function DocsSidebar({ sidebar }: { sidebar: SidebarNode[] }) {
	return (
		<nav className="flex flex-col gap-1 pb-12">
			<Link
				to="/docs"
				className="mb-2 flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[0.66rem] font-bold uppercase tracking-wider text-foreground/55 hover:text-foreground"
			>
				<span aria-hidden="true">←</span> Documentation
			</Link>
			{sidebar.map((node, i) => {
				const pathKey = isFolderNode(node)
					? `root/f/${node.folder.folder}/${i}`
					: `root/p/${node.entry.href}`;
				return <SidebarItem key={pathKey} node={node} pathKey={pathKey} />;
			})}
		</nav>
	);
}

type TOCHeading = {
	depth: number;
	value: string;
	id: string;
};

type DocsContentProps = {
	title: string;
	description?: string;
	toc?: TOCHeading[];
	children: ReactNode;
};

export function DocsContent({ title, description, toc, children }: DocsContentProps) {
	return (
		<article className="docs-prose relative flex w-full min-w-0 flex-col gap-6 pb-20">
			<header className="flex flex-col gap-2">
				<h1 className="text-balance text-3xl font-bold leading-tight tracking-tight text-foreground sm:text-4xl">
					{title}
				</h1>
				{description ? (
					<p className="max-w-2xl text-base leading-relaxed text-muted-foreground">{description}</p>
				) : null}
			</header>
			<div className="docs-prose-body">{children}</div>
			{toc && toc.length > 0 ? (
				<aside className="sticky top-24 hidden max-h-[calc(100vh-7rem)] w-64 self-start overflow-y-auto pl-4 text-sm xl:block">
					<p className="mb-2 text-[0.66rem] font-bold uppercase tracking-wider text-muted-foreground">
						On this page
					</p>
					<ul className="flex flex-col gap-1 border-l border-border pl-3">
						{toc.map((heading) => (
							<li key={heading.id}>
								<a
									className={cn(
										"block leading-snug transition-colors hover:text-foreground",
										heading.depth === 3
											? "pl-3 text-xs text-muted-foreground/80"
											: "text-sm text-muted-foreground",
									)}
									href={`#${heading.id}`}
								>
									{heading.value}
								</a>
							</li>
						))}
					</ul>
				</aside>
			) : null}
		</article>
	);
}

export type { TOCHeading };
