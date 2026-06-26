import { readFileSync } from "node:fs"
import { describe, expect, test } from "bun:test"

const messageSource = readFileSync(
	new URL("../../../../packages/ui/src/components/ai-elements/message.tsx", import.meta.url),
	"utf8",
)
const rendererCssSource = readFileSync(new URL("../../index.css", import.meta.url), "utf8")

describe("MessageResponse markdown surfaces", () => {
	test("uses desktop dark theme surfaces for streamdown markdown cells", () => {
		expect({
			responseClass: messageSource.includes("devo-message-response"),
			codeBlockSurface: rendererCssSource.includes('[data-streamdown="code-block"]'),
			codeBlockBodySurface: rendererCssSource.includes('[data-streamdown="code-block-body"]'),
			tableHeaderSurface: rendererCssSource.includes('[data-streamdown="table-header"]'),
		}).toEqual({
			responseClass: true,
			codeBlockSurface: true,
			codeBlockBodySurface: true,
			tableHeaderSurface: true,
		})
	})
})
