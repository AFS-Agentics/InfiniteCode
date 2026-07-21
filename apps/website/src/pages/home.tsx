import {
	ArrowRightIcon,
	CheckIcon,
	CpuIcon,
	GitBranchIcon,
	GithubIcon,
	GlobeIcon,
	LockIcon,
	MonitorIcon,
	ShieldIcon,
	TerminalIcon,
	XIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card"
import {
	Accordion,
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
} from "@/components/ui/accordion"

// Docs landing page sections (added alongside original content)
import { ProofSection } from "@/pages/landing/proof-section"
import { WorkflowSection } from "@/pages/landing/workflow-section"
import { EnterpriseSection } from "@/pages/landing/enterprise-section"
import { ClosingSection } from "@/pages/landing/closing-section"
import { landingCopy } from "@/pages/landing/data"

// ──────────────────────────────────────────────
// Data
// ──────────────────────────────────────────────

const features = [
	{
		icon: CpuIcon,
		title: "Multi-model",
		desc: "DeepSeek, Llama, CodeQwen — use any open model locally, or bring your own API key.",
	},
	{
		icon: LockIcon,
		title: "Runs locally",
		desc: "Your code never leaves your machine. Full offline support with local models.",
	},
	{
		icon: MonitorIcon,
		title: "Desktop native",
		desc: "Native macOS and Linux app with transparent windows, terminal, and smart context.",
	},
	{
		icon: GitBranchIcon,
		title: "Works with any stack",
		desc: "Drop it in any project — Rust, Python, TypeScript, Go. No config files needed.",
	},
	{
		icon: ShieldIcon,
		title: "Open source",
		desc: "MIT licensed. Audit the code, fork it, build on it. No black boxes.",
	},
	{
		icon: GlobeIcon,
		title: "CLI + Desktop + Web",
		desc: "Terminal agent, native desktop app, and browser-based web version — same engine everywhere.",
	},
]

const comparisonTools = [
	{ name: "InfiniteCode", free: true, oss: true, local: true, desktop: true, unlimited: true, price: "$0" },
	{ name: "Freebuff", free: true, oss: true, local: true, desktop: true, unlimited: false, price: "$0" },
	{ name: "Cursor", free: false, oss: false, local: true, desktop: true, unlimited: false, price: "$720/yr" },
	{ name: "Claude Code", free: false, oss: false, local: true, desktop: false, unlimited: false, price: "$1,200/yr" },
	{ name: "GitHub Copilot", free: false, oss: false, local: true, desktop: false, unlimited: false, price: "$120/yr" },
]

const faqItems = [
	{
		q: "What's the difference between InfiniteCode and Freebuff?",
		a: "Both are free and open-source, but Freebuff limits usage to 5 sessions of 1 hour per day (5 hours total) in most countries. InfiniteCode has no daily limits — use it as much as you want, whenever you want. No caps, no sessions, no clock watching.",
	},
	{
		q: "Do you capture my code or session data?",
		a: "No — InfiniteCode never captures your code, sessions, or telemetry. There's no analytics endpoint, no upload, no recording. Other agentic tools, including Freebuff, do capture session logs and code fragments for analytics and product improvement. That's how they keep the free tier funded. We don't do that.",
	},
	{
		q: "Do I need an API key?",
		a: "No. InfiniteCode works out of the box with built-in open-source models. You can optionally add your own API keys for proprietary models.",
	},
	{
		q: "What models does InfiniteCode support?",
		a: "DeepSeek V4, Llama 4, CodeQwen, and more. New models are added regularly. You can also configure custom OpenAI-compatible endpoints.",
	},
	{
		q: "Can I use it offline?",
		a: "Yes. With local models, InfiniteCode runs fully offline. Your code never touches a remote server unless you explicitly configure a cloud model.",
	},
	{
		q: "Is it really free forever?",
		a: "Yes. InfiniteCode is MIT-licensed open-source. Free forever, for anyone, for any use — personal or commercial.",
	},
	{
		q: "What platforms are supported?",
		a: "macOS, Linux, and the web. The CLI works everywhere, the desktop app runs on macOS and Linux, and the web version works in any modern browser — no install needed. Windows support is in development.",
	},
]

// ──────────────────────────────────────────────
// Components
// ──────────────────────────────────────────────

function Nav() {
	return (
		<header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-md">
			<div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
				<a href="/" className="flex items-center gap-2 text-sm font-semibold">
					<CpuIcon className="size-5 text-primary" />
					InfiniteCode
				</a>
				<nav className="hidden items-center gap-6 sm:flex">
					{["Features", "Compare", "CLI", "Desktop", "Web", "FAQ"].map((label) => (
						<a
							key={label}
							href={`#${label.toLowerCase()}`}
							className="text-sm text-muted-foreground transition-colors hover:text-foreground"
						>
							{label}
						</a>
					))}
				</nav>
				<Button size="sm">Get Started</Button>
			</div>
		</header>
	)
}

function HeroSection() {
	return (
		<section className="relative overflow-hidden border-b border-border">
			<div className="mx-auto grid max-w-6xl px-4 py-20 sm:py-28 sm:grid-cols-2 sm:gap-12">
				<div className="flex flex-col justify-center">
					<div className="mb-4 inline-flex w-fit items-center gap-1.5 rounded-full border border-border bg-muted/50 px-3 py-1 text-xs text-muted-foreground">
						<CpuIcon className="size-3" />
						Open-source AI coding agent
					</div>
					<h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
						Code faster with AI that actually runs locally
					</h1>
					<p className="mt-4 text-muted-foreground leading-relaxed">
						InfiniteCode is an open-source AI coding assistant for your terminal and
						desktop. Works with any project, any language, any model. No subscriptions.
						No telemetry. No vendor lock-in.
					</p>
					<div className="mt-6 flex flex-wrap gap-3">
						<Button size="lg">
							<TerminalIcon className="size-4" />
							npx infinitecode
						</Button>
						<Button variant="outline" size="lg">
							<GithubIcon className="size-4" />
							Star on GitHub
						</Button>
					</div>
					<p className="mt-3 text-xs text-muted-foreground">
						No install. No API key. Just Node.js.
					</p>
				</div>
				<div className="mt-8 hidden sm:mt-0 sm:flex sm:items-center">
					<div className="w-full overflow-hidden rounded-xl border border-border bg-black/90 shadow-2xl">
						<div className="flex items-center gap-1.5 border-b border-white/10 px-4 py-2">
							<span className="size-2.5 rounded-full bg-red-500" />
							<span className="size-2.5 rounded-full bg-yellow-500" />
							<span className="size-2.5 rounded-full bg-green-500" />
							<span className="ml-2 text-xs text-white/40">bash</span>
						</div>
						<div className="p-4 font-mono text-xs leading-relaxed text-gray-300">
							<p className="text-green-400">$ npx infinitecode</p>
							<p className="mt-1 text-blue-300">DeepSeek V4 · ~/src/my-app</p>
							<p className="mt-2 text-white/60">Read 156 files · mapped project structure</p>
							<p className="text-white/60">Detected: Next.js, Prisma, tRPC</p>
							<p className="mt-2">
								<span className="text-white/80">›</span> add rate limiting to the API
							</p>
							<p className="mt-2 text-white/50">
								<span className="text-green-400">✔</span> Edit src/app/api/trpc/route.ts
								+18 -2
							</p>
							<p className="text-white/50">
								<span className="text-green-400">✔</span> Edit src/lib/rate-limit.ts
								+34 -0
							</p>
							<p className="mt-1 text-white/60">Done in 14s · 2 files changed</p>
						</div>
					</div>
				</div>
			</div>
		</section>
	)
}

function ReplacesSection() {
	const tools = [
		{ name: "Codex", paid: 240 },
		{ name: "Cursor", paid: 720 },
		{ name: "Claude Code", paid: 1200 },
		{ name: "Devin", paid: 2400 },
		{ name: "GitHub Copilot", paid: 120 },
	]
	return (
		<section className="border-b border-border py-10">
			<div className="mx-auto max-w-4xl px-4 text-center">
				<p className="mb-5 text-xs uppercase tracking-widest text-muted-foreground">
					Replaces these paid tools
				</p>
				<div className="flex flex-wrap justify-center gap-x-8 gap-y-3">
					{tools.map((tool) => (
						<div key={tool.name} className="flex items-center gap-2">
							<span className="text-sm font-medium text-foreground">{tool.name}</span>
							<span className="rounded-md border border-border bg-muted/50 px-1.5 py-0.5 text-xs text-muted-foreground line-through decoration-red-500/60">
								${tool.paid}/yr
							</span>
						</div>
					))}
				</div>
				<p className="mt-4 text-xs text-muted-foreground">
					All of them cost money. InfiniteCode is free.
				</p>
			</div>
		</section>
	)
}

function FeatureGrid() {
	return (
		<section id="features" className="mx-auto max-w-6xl px-4 py-20">
			<div className="mb-12 text-center">
				<h2 className="text-3xl font-bold">Everything you need, nothing you don't</h2>
				<p className="mt-2 text-muted-foreground">
					A coding agent that respects your privacy, your workflow, and your wallet.
				</p>
			</div>
			<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
				{features.map((f) => {
					const Icon = f.icon
					return (
						<Card key={f.title}>
							<CardHeader>
								<div className="mb-2 flex size-10 items-center justify-center rounded-lg bg-primary/10">
									<Icon className="size-5 text-primary" />
								</div>
								<CardTitle className="text-base">{f.title}</CardTitle>
								<CardDescription>{f.desc}</CardDescription>
							</CardHeader>
						</Card>
					)
				})}
			</div>
		</section>
	)
}

function ComparisonSection() {
	return (
		<section id="compare" className="border-y border-border py-16">
			<div className="mx-auto max-w-4xl px-4">
				<h2 className="mb-2 text-center text-2xl font-bold">
					How InfiniteCode stacks up
				</h2>
				<p className="mb-8 text-center text-sm text-muted-foreground">
					No marketing spin — just the facts
				</p>
				<div className="overflow-x-auto">
					<table className="w-full text-sm">
						<thead>
							<tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
								<th className="pb-3 pr-3 font-medium">Tool</th>
								<th className="pb-3 pr-3 font-medium">Unlimited</th>
								<th className="pb-3 pr-3 font-medium">Open Source</th>
								<th className="pb-3 pr-3 font-medium">Runs Local</th>
								<th className="pb-3 pr-3 font-medium">Desktop App</th>
								<th className="pb-3 font-medium">Price</th>
							</tr>
						</thead>
						<tbody>
							{comparisonTools.map((tool) => (
								<tr
									key={tool.name}
									className={`border-b border-border last:border-0 ${
										tool.name === "InfiniteCode" ? "bg-primary/5" : ""
									}`}
								>
									<td className="py-3 pr-4 font-medium">
										{tool.name === "InfiniteCode" ? (
											<span className="flex items-center gap-1.5">
												<CpuIcon className="size-3.5 text-primary" />
												{tool.name}
											</span>
										) : (
											tool.name
										)}
									</td>
									<td className="py-3 pr-3">
										{tool.unlimited ? (
											<CheckIcon className="size-4 text-green-500" />
										) : (
											<XIcon className="size-4 text-red-500" />
										)}
									</td>
									<td className="py-3 pr-4">
										{tool.oss ? (
											<CheckIcon className="size-4 text-green-500" />
										) : (
											<XIcon className="size-4 text-red-500" />
										)}
									</td>
									<td className="py-3 pr-4">
										{tool.local ? (
											<CheckIcon className="size-4 text-green-500" />
										) : (
											<XIcon className="size-4 text-red-500" />
										)}
									</td>
									<td className="py-3 pr-4">
										{tool.desktop ? (
											<CheckIcon className="size-4 text-green-500" />
										) : (
											<XIcon className="size-4 text-red-500" />
										)}
									</td>
									<td className="py-3 font-medium">{tool.price}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</div>
		</section>
	)
}

function PrivacySection() {
	const rows = [
		{
			who: "InfiniteCode",
			good: true,
			body: "No analytics. No code upload. No session recording. Your conversations and code stay on your machine — only stored in your project's local cache. Plus a single opaque lockfile (~/Library/Application Support/infinitecode/session.lock.json on macOS, equivalent on Linux/Windows) that records your process id and start timestamp for the strict single-session guard.",
		},
		{
			who: "Most other tools (incl. Freebuff)",
			good: false,
			body: "Capture session logs, code fragments, and usage metrics. Transmitted off-device to vendor servers for analytics, model improvement, and capacity planning.",
		},
	]
	return (
		<section
			id="privacy"
			className="relative overflow-hidden border-y border-border bg-gradient-to-b from-background via-background to-muted/40 py-20"
		>
			<div className="pointer-events-none absolute inset-0 -z-10 opacity-60">
				<div className="absolute -top-24 left-1/2 size-[28rem] -translate-x-1/2 rounded-full bg-primary/10 blur-3xl" />
			</div>
			<div className="mx-auto max-w-5xl px-4">
				<div className="mb-10 text-center">
					<div className="mb-3 inline-flex w-fit items-center gap-1.5 rounded-full border border-border bg-muted/50 px-3 py-1 text-xs text-muted-foreground">
						<ShieldIcon className="size-3" />
						Privacy by default
					</div>
					<h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
						We don't capture your data. Most tools do.
					</h2>
					<p className="mx-auto mt-3 max-w-2xl text-muted-foreground leading-relaxed">
						InfiniteCode never sends your code, sessions, or telemetry anywhere.
						Other agentic tools — including Freebuff — routinely capture session
						logs and code fragments for analytics and product improvement.
					</p>
				</div>
				<div className="grid gap-4 sm:grid-cols-2">
					{rows.map((r) => (
						<Card className={r.good ? "border-emerald-500/30 bg-emerald-500/5" : "border-red-500/25 bg-red-500/5"} key={r.who}>
							<CardHeader>
								<div className="mb-2 flex size-10 items-center justify-center rounded-lg bg-background/60 ring-1 ring-border">
									{r.good ? (
										<CheckIcon className="size-5 text-emerald-500" />
									) : (
										<XIcon className="size-5 text-red-500" />
									)}
								</div>
								<CardTitle className="text-base">{r.who}</CardTitle>
								<CardDescription className="leading-relaxed">{r.body}</CardDescription>
							</CardHeader>
						</Card>
					))}
				</div>
				<p className="mt-8 text-center text-xs text-muted-foreground">
					Audit it yourself — InfiniteCode is MIT-licensed. The whole runtime is
					readable, forkable, and replaceable.
				</p>
			</div>
		</section>
	)
}

function CliSection() {
	return (
		<section id="cli" className="mx-auto max-w-4xl px-4 py-20">
			<div className="grid items-center gap-10 sm:grid-cols-2">
				<div>
					<h2 className="text-2xl font-bold">Terminal-native agent</h2>
					<p className="mt-2 text-muted-foreground leading-relaxed">
						Drop into any project, describe what you want, and let the agent handle the
						rest. It reads your codebase, plans the changes, and writes the code — all
						from your terminal.
					</p>
					<ul className="mt-4 space-y-2 text-sm">
						{[
							"Reads and understands your entire project structure",
							"Makes precise surgical edits, not blanket rewrites",
							"Supports sub-agents for code review and debugging",
							"Works with git — review every change before committing",
						].map((item) => (
							<li key={item} className="flex items-start gap-2">
								<CheckIcon className="mt-0.5 size-4 shrink-0 text-green-500" />
								<span className="text-muted-foreground">{item}</span>
							</li>
						))}
					</ul>
					<div className="mt-6">
						<Button variant="outline" size="sm">
							<TerminalIcon className="size-4" />
							npm install -g infinitecode
						</Button>
					</div>
				</div>
				<div className="overflow-hidden rounded-xl border border-border bg-black/90">
					<div className="flex items-center gap-1.5 border-b border-white/10 px-4 py-2">
						<span className="size-2.5 rounded-full bg-red-500" />
						<span className="size-2.5 rounded-full bg-yellow-500" />
						<span className="size-2.5 rounded-full bg-green-500" />
					</div>
					<div className="p-4 font-mono text-xs leading-relaxed text-gray-300">
						<p className="text-green-400">$ infinitecode</p>
						<p className="mt-1 text-blue-300">Using deepseek-v4 · ~/project</p>
						<p className="mt-2 text-white/60">Mapping project structure...</p>
						<p className="text-white/60">Found 238 source files</p>
						<p className="mt-1">
							<span className="text-white/80">›</span> refactor the database layer
						</p>
						<p className="mt-2 text-white/50" data-prefix="Planning">
							Planning 3 changes...
						</p>
						<p className="text-white/50">
							<span className="text-green-400">✔</span> src/db/client.ts +22 -8
						</p>
						<p className="text-white/50">
							<span className="text-green-400">✔</span> src/db/migrations/ +1 file
						</p>
						<p className="text-white/50">
							<span className="text-green-400">✔</span> src/lib/queries.ts +15 -3
						</p>
						<p className="mt-1 text-white/60">
							<span className="text-yellow-400">●</span> Run `git diff` to review
						</p>
					</div>
				</div>
			</div>
		</section>
	)
}

function DesktopSection() {
	return (
		<section id="desktop" className="border-y border-border py-16">
			<div className="mx-auto max-w-4xl px-4">
				<div className="grid items-center gap-10 sm:grid-cols-2">
					<div className="order-2 sm:order-1">
						<div className="flex items-center gap-2 rounded-lg border border-border bg-muted/50 px-4 py-20 text-center sm:py-28">
							<MonitorIcon className="mx-auto size-8 text-muted-foreground" />
						</div>
					</div>
					<div className="order-1 sm:order-2">
						<h2 className="text-2xl font-bold">Desktop app with native superpowers</h2>
						<p className="mt-2 text-muted-foreground leading-relaxed">
							Beyond the terminal — InfiniteCode Desktop gives you transparent windows,
							system-native chrome, a built-in terminal emulator, and persistent project
							context that survives restarts.
						</p>
						<ul className="mt-4 space-y-2 text-sm">
							{[
								"Liquid glass transparency on macOS",
								"Built-in xterm terminal emulator",
								"Smart context window — see what the agent sees",
								"Multi-model chat alongside code editing",
							].map((item) => (
								<li key={item} className="flex items-start gap-2">
									<CheckIcon className="mt-0.5 size-4 shrink-0 text-green-500" />
									<span className="text-muted-foreground">{item}</span>
								</li>
							))}
						</ul>
						<div className="mt-6 flex gap-3">
							<Button size="sm">Download for macOS</Button>
							<Button variant="outline" size="sm">
								Download for Linux
							</Button>
						</div>
					</div>
				</div>
			</div>
		</section>
	)
}

function WebSection() {
	return (
		<section id="web" className="border-y border-border py-16">
			<div className="mx-auto max-w-4xl px-4">
				<div className="grid items-center gap-10 sm:grid-cols-2">
					<div>
						<div className="flex items-center gap-2 text-sm text-muted-foreground">
							<GlobeIcon className="size-4" />
							<span>No install required</span>
						</div>
						<h2 className="mt-3 text-2xl font-bold">InfiniteCode in your browser</h2>
						<p className="mt-2 text-muted-foreground leading-relaxed">
							Same powerful agent, zero setup. Open a tab, sign in, and start coding
							immediately. All your projects, models, and context follow you across
							devices — no terminal, no install, no friction.
						</p>
						<ul className="mt-4 space-y-2 text-sm">
							{[
								"Works in Chrome, Firefox, Safari, Edge",
								"Persistent project context across sessions",
								"Built-in sandboxed terminal in the browser",
								"Syncs with your desktop and CLI sessions",
							].map((item) => (
								<li key={item} className="flex items-start gap-2">
									<CheckIcon className="mt-0.5 size-4 shrink-0 text-green-500" />
									<span className="text-muted-foreground">{item}</span>
								</li>
							))}
						</ul>
						<div className="mt-6">
							<Button size="sm" asChild>
								<a href="https://web-muub0r26l-shahrukh-yousafzais-projects.vercel.app" target="_blank" rel="noreferrer">
									<GlobeIcon className="size-4" />
									Try on Web
								</a>
							</Button>
						</div>
					</div>
					<div className="overflow-hidden rounded-xl border border-border bg-black/90">
						<div className="flex items-center gap-1.5 border-b border-white/10 px-4 py-2">
							<div className="flex items-center gap-1.5">
								<span className="size-2.5 rounded-full bg-red-500" />
								<span className="size-2.5 rounded-full bg-yellow-500" />
								<span className="size-2.5 rounded-full bg-green-500" />
							</div>
							<span className="ml-3 text-xs text-white/40">
								app.infinitecode.dev
							</span>
						</div>
						<div className="p-4 font-mono text-xs leading-relaxed text-gray-300">
							<div className="flex items-center gap-2 border-b border-white/10 pb-3">
								<span className="rounded bg-primary/20 px-2 py-0.5 text-[10px] text-primary">
									Connected
								</span>
								<span className="text-white/40">deepseek-v4</span>
								<span className="ml-auto text-white/30">~/project</span>
							</div>
							<div className="mt-3 space-y-2">
								<div className="flex items-center gap-2 text-white/50">
									<span className="size-1.5 rounded-full bg-green-500" />
									Session restored from desktop
								</div>
								<p className="text-white/60">Mapping project structure...</p>
								<p className="text-white/60">Found 238 source files</p>
								<p className="mt-2">
									<span className="text-white/80">›</span> refactor the database
									layer
								</p>
								<p className="mt-1 text-white/50">
									<span className="text-green-400">✔</span> src/db/client.ts +22 -8
								</p>
								<p className="text-white/50">
									<span className="text-green-400">✔</span> src/db/migrations/ +1
									file
								</p>
								<p className="flex items-center gap-2 text-white/40">
									<span className="inline-block size-2 animate-pulse rounded-full bg-blue-400" />
									Thinking...
								</p>
							</div>
						</div>
					</div>
				</div>
			</div>
		</section>
	)
}

function StatsSection() {
	return (
		<section className="mx-auto max-w-4xl px-4 py-16 text-center">
			<div className="grid gap-8 sm:grid-cols-3">
				{[
					{ value: "84K+", label: "Developers" },
					{ value: "12K+", label: "GitHub stars" },
					{ value: "100%", label: "Free and open source" },
				].map((stat) => (
					<div key={stat.label}>
						<div className="text-4xl font-bold text-primary">{stat.value}</div>
						<div className="mt-1 text-sm text-muted-foreground">{stat.label}</div>
					</div>
				))}
			</div>
		</section>
	)
}

function CtaSection() {
	return (
		<section className="border-y border-border py-16">
			<div className="mx-auto max-w-2xl px-4 text-center">
				<h2 className="text-2xl font-bold">Start coding with AI, not against it</h2>
				<p className="mt-2 text-muted-foreground">
					No sign-up. No credit card. No data collection. Just a terminal and your project.
				</p>
				<div className="mt-6 flex flex-wrap justify-center gap-3">
					<Button size="lg">
						<TerminalIcon className="size-4" />
						npx infinitecode
					</Button>
					<Button variant="outline" size="lg">
						<GithubIcon className="size-4" />
						View on GitHub
					</Button>
				</div>
			</div>
		</section>
	)
}

function FaqSection() {
	return (
		<section id="faq" className="mx-auto max-w-2xl px-4 py-16">
			<h2 className="mb-8 text-center text-2xl font-bold">Frequently asked questions</h2>
			<Accordion type="single" collapsible className="w-full">
				{faqItems.map((item, i) => (
					<AccordionItem key={i} value={`faq-${i}`}>
						<AccordionTrigger className="text-left">{item.q}</AccordionTrigger>
						<AccordionContent className="text-muted-foreground leading-relaxed">
							{item.a}
						</AccordionContent>
					</AccordionItem>
				))}
			</Accordion>
		</section>
	)
}

function FooterSection() {
	return (
		<footer className="border-t border-border py-10">
			<div className="mx-auto flex max-w-6xl flex-col items-center gap-4 px-4 text-center sm:flex-row sm:justify-between">
				<div className="flex items-center gap-2 text-sm">
					<CpuIcon className="size-4 text-primary" />
					<span className="font-semibold">InfiniteCode</span>
				</div>
				<div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
					<a href="#features" className="hover:text-foreground">Features</a>
					<a href="#compare" className="hover:text-foreground">Compare</a>
					<a href="#cli" className="hover:text-foreground">CLI</a>
					<a href="#desktop" className="hover:text-foreground">Desktop</a>
					<a href="#faq" className="hover:text-foreground">FAQ</a>
					<a href="https://github.com" className="inline-flex items-center gap-1 hover:text-foreground">
						<GithubIcon className="size-3" />
						GitHub
					</a>
				</div>
			</div>
			<p className="mt-6 text-center text-xs text-muted-foreground">
				© 2026 InfiniteCode. MIT License. Built in the open.
			</p>
		</footer>
	)
}

// ──────────────────────────────────────────────
// Page
// ──────────────────────────────────────────────

export function HomePage() {
	return (
		<div className="min-h-screen bg-background text-foreground">
			<Nav />
			<main>
				<HeroSection />
				<ReplacesSection />
				<FeatureGrid />
				<ComparisonSection />
				<PrivacySection />
				<CliSection />
				<DesktopSection />
				<WebSection />
				<StatsSection />
				<CtaSection />
				{/* Adsterra fallback ad */}
				<div id="container-ba7ceb35501edf7bae9f9a9e268cb6ca" className="mx-auto my-8" />
				{/* A-Ads unit (anonymous ads) */}
				<div id="frame" className="mx-auto my-8" style={{ width: "100%", position: "relative", zIndex: 99998 }}>
					<iframe
						data-aa="2448645"
						src="//acceptable.a-ads.com/2448645/?size=Adaptive"
						style={{ border: 0, padding: 0, width: "70%", height: "auto", overflow: "hidden", display: "block", margin: "auto" }}
						title="A-Ads"
					/>
				</div>
				{/* Docs landing page sections added below */}
				<ProofSection rows={landingCopy.en.proofRows} />
				<WorkflowSection copy={landingCopy.en.workflow} />
				<EnterpriseSection copy={landingCopy.en.enterprise} />
				<ClosingSection copy={landingCopy.en.closing} docsHref="/docs" />
				<FaqSection />
			</main>
			<FooterSection />
		</div>
	)
}
