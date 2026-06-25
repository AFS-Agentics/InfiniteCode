import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { ToolCard } from "./tool-card"

describe("ToolCard", () => {
	test("renders without a left-edge category accent", () => {
		const markup = renderToStaticMarkup(
			<ToolCard icon={<span data-testid="icon" />} title="Shell" category="run" />,
		)

		expect({
			hasTitle: markup.includes(">Shell<"),
			hasLeftBorderAccent: markup.includes("border-l-"),
		}).toEqual({
			hasTitle: true,
			hasLeftBorderAccent: false,
		})
	})
})
