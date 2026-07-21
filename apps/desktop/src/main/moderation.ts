import OpenAI from "openai"
import { getSettings } from "./settings-store"
import { createLogger } from "./logger"

const log = createLogger("moderation")

// ── Categories we consider "inappropriate for an ad" ──
// OpenAI returns scores for 13 categories; we only flag the ones
// that an ad-network context should never show.
const AD_POLICY_CATEGORIES = new Set([
	"sexual",
	"harassment",
	"harassment/threatening",
	"hate",
	"hate/threatening",
	"illicit",
	"illicit/violent",
	"self-harm",
	"self-harm/intent",
	"self-harm/instructions",
	"violence/graphic",
] as const)

// Re-export the same interface the rest of the codebase expects.
export interface ModerationResult {
	flagged: boolean
	reason: string
	score: number
	cumulativeScore?: number
}

let client: OpenAI | null = null

function getClient(): OpenAI | null {
	if (client) return client
	const apiKey = getSettings().voice.openaiApiKey
	if (!apiKey) {
		log.warn("openaiApiKey not set — moderation unavailable")
		return null
	}
	client = new OpenAI({ apiKey })
	return client
}

export async function checkAdText(text: string): Promise<ModerationResult> {
	if (!text || text.trim().length === 0) {
		return { flagged: false, reason: "Empty", score: 0 }
	}

	const c = getClient()
	if (!c) {
		return { flagged: false, reason: "API key not configured", score: 0 }
	}

	try {
		const response = await c.moderations.create({
			model: "omni-moderation-latest",
			input: text,
		})

		const r = response.results[0]

		// Collect per-category details for the reason string
		const triggered: string[] = []
		let maxScore = 0

		for (const [cat, flagged] of Object.entries(r.categories)) {
			if (flagged && AD_POLICY_CATEGORIES.has(cat)) {
				triggered.push(cat)
				const score =
					r.category_scores[cat as keyof typeof r.category_scores] ?? 0
				if (score > maxScore) maxScore = score
			}
		}

		if (triggered.length > 0) {
			return {
				flagged: true,
				reason: `Policy violation (${triggered.join(", ")})`,
				score: maxScore,
				cumulativeScore: undefined,
			}
		}

		return { flagged: false, reason: "Safe", score: 0 }
	} catch (err) {
		log.error("OpenAI moderation call failed", err)
		return { flagged: false, reason: "Moderation error", score: 0 }
	}
}
