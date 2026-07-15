import { ArrowRightIcon, CpuIcon, KeyIcon, SparklesIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

const features = [
	{
		title: "AI-Powered",
		description: "Advanced AI assistance that understands your codebase and helps you ship faster.",
		icon: SparklesIcon,
	},
	{
		title: "Privacy First",
		description: "Your code never leaves your machine. Runs locally with full control.",
		icon: KeyIcon,
	},
	{
		title: "Universal",
		description: "Works with any language, framework, or workflow. CLI, desktop, and web.",
		icon: CpuIcon,
	},
]

export function HomePage() {
	return (
		<div className="flex flex-col items-center min-h-screen">
			{/* Hero */}
			<section className="flex flex-col items-center justify-center px-4 pt-32 pb-16 text-center">
				<h1 className="text-5xl font-bold tracking-tight sm:text-6xl">
					Infinite{" "}
					<span className="text-primary">Code</span>
				</h1>
				<p className="mt-6 max-w-2xl text-lg text-muted-foreground">
					The AI coding assistant that works the way you do. Fast, private, and built
					for real development workflows.
				</p>
				<div className="mt-8 flex gap-4">
					<Button size="lg">
						Get Started
						<ArrowRightIcon />
					</Button>
					<Button variant="outline" size="lg">
						Learn More
					</Button>
				</div>
			</section>

			{/* Features */}
			<section className="w-full max-w-5xl px-4 pb-32">
				<div className="grid gap-6 md:grid-cols-3">
					{features.map((feature) => {
						const Icon = feature.icon
						return (
							<Card key={feature.title}>
								<CardHeader>
									<div className="mb-2 flex size-10 items-center justify-center rounded-lg bg-primary/10">
										<Icon className="size-5 text-primary" />
									</div>
									<CardTitle>{feature.title}</CardTitle>
									<CardDescription>{feature.description}</CardDescription>
								</CardHeader>
							</Card>
						)
					})}
				</div>
			</section>
		</div>
	)
}
