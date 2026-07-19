import type { ComponentType } from "react";

type MetaJson = {
	title?: string;
	pages?: (string | "--")[];
};

type MdxFrontmatter = {
	title: string;
	description?: string;
	icon?: string;
};

export type SidebarEntry = {
	name: string;
	href: string;
	description?: string;
	icon?: string;
};

export type SidebarFolder = {
	folder: string;
	title: string;
	entries: SidebarNode[];
};

export type SidebarNode =
	| { kind: "page"; entry: SidebarEntry }
	| { kind: "folder"; folder: SidebarFolder };

export type DocsPageModule = {
	default: ComponentType;
	frontmatter?: MdxFrontmatter;
};

const metaModules = import.meta.glob<MetaJson>("../../content/docs/**/meta.json", {
	eager: true,
});

const mdxModules = import.meta.glob<DocsPageModule>(
	"../../content/docs/**/*.mdx",
	{ eager: true },
);

function toHref(folder: string, slug: string): string {
	return folder === "" ? `/docs/${slug}` : `/docs/${folder}/${slug}`;
}

function buildFolderTree(folderPath: string): SidebarNode[] {
	const meta: MetaJson = metaModules[`../../content/docs/${folderPath}/meta.json`] ?? {};
	const ordered = meta.pages ?? [];

	const out: SidebarNode[] = [];

	for (const ref of ordered) {
		if (ref === "---") continue;

		const childMeta = metaModules[`../../content/docs/${folderPath}/${ref}/meta.json`];
		if (childMeta) {
			out.push({
				kind: "folder",
				folder: {
					folder: ref,
					title: childMeta.title ?? ref,
					entries: buildFolderTree(`${folderPath}/${ref}`),
				},
			});
			continue;
		}

		const mdx = mdxModules[`../../content/docs/${folderPath}/${ref}.mdx`];
		if (!mdx?.frontmatter) continue;

		out.push({
			kind: "page",
			entry: {
				name: mdx.frontmatter.title,
				href: toHref(folderPath, ref),
				description: mdx.frontmatter.description,
				icon: mdx.frontmatter.icon,
			},
		});
	}

	return out;
}

const rootMeta: MetaJson = metaModules["../../content/docs/meta.json"] ?? {};
const rootOrder = rootMeta.pages ?? ["index"];

const sidebar: SidebarNode[] = (() => {
	const out: SidebarNode[] = [];
	for (const ref of rootOrder) {
		if (ref === "---") continue;

		const childMeta = metaModules[`../../content/docs/${ref}/meta.json`];
		if (childMeta) {
			out.push({
				kind: "folder",
				folder: {
					folder: ref,
					title: childMeta.title ?? ref,
					entries: buildFolderTree(ref),
				},
			});
			continue;
		}

		const mdx = mdxModules[`../../content/docs/${ref}.mdx`];
		if (mdx?.frontmatter) {
			out.push({
				kind: "page",
				entry: {
					name: mdx.frontmatter.title,
					href: ref === "index" ? "/docs" : `/docs/${ref}`,
					description: mdx.frontmatter.description,
					icon: mdx.frontmatter.icon,
				},
			});
		}
	}
	return out;
})();

export default sidebar;

export type { MdxFrontmatter };

export function isPageNode(node: SidebarNode): node is {
	kind: "page";
	entry: SidebarEntry;
} {
	return node.kind === "page";
}

export function isFolderNode(node: SidebarNode): node is {
	kind: "folder";
	folder: SidebarFolder;
} {
	return node.kind === "folder";
}

export function lookupPage(href: string): DocsPageModule | undefined {
	const cleaned = href.replace(/^\/docs\/?/, "");
	if (cleaned === "" || cleaned === "/" || cleaned === "index") {
		return mdxModules["../../content/docs/index.mdx"];
	}

	const parts = cleaned.split("/").filter(Boolean);

	let cursorFolder = "";
	let cursorList: SidebarNode[] = sidebar;

	for (let i = 0; i < parts.length; i += 1) {
		const expected = `/docs/${parts.slice(0, i + 1).join("/")}`;
		const match = cursorList.find(
			(node) =>
				(node.kind === "folder" && node.folder.folder === parts[i]) ||
				(node.kind === "page" && node.entry.href === expected),
		);

		if (!match) return undefined;

		if (match.kind === "folder") {
			cursorFolder = `${cursorFolder}/${match.folder.folder}`.replace(/^\//, "");
			cursorList = match.folder.entries;
			continue;
		}

		const relativePath = `../../content/docs/${cursorFolder}/${parts[i]}.mdx`;
		return mdxModules[relativePath];
	}

	return undefined;
}
