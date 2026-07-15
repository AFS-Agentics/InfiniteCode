import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { WelcomeStep } from "./welcome-step"

describe("WelcomeStep", () => {
	test("presents InfiniteCode as a prominent onboarding brand mark", () => {
		const markup = renderToStaticMarkup(<WelcomeStep onContinue={() => {}} />)

		expect({
			hasBrandMark: markup.includes('data-slot="welcome-brand-mark"'),
			hasProminentBrandSize: markup.includes("size-16"),
			hasInfiniteCodeHeading: markup.includes("<h2") && markup.includes(">InfiniteCode</h2>"),
		}).toEqual({
			hasBrandMark: true,
			hasProminentBrandSize: true,
			hasInfiniteCodeHeading: true,
		})
	})
})
