import { pipeline } from "@xenova/transformers"
import { createLogger } from "./logger"

const log = createLogger("moderation")

// All moderation is ML-only via zero-shot classification.
// No regex patterns — they're brittle and miss edge cases.

const BAD_LABELS = [
	"dating ad",
	"pharmacy ad",
	"scam",
	"gambling ad",
	"weight loss scheme",
]

const ALL_LABELS = [...BAD_LABELS, "legitimate business", "software product"]

const SINGLE_LABEL_THRESHOLD = 0.25

// Aggregate rule (see `checkAdText`): flag if the cumulative bad-label
// score exceeds this threshold even when no single bad label crosses
// SINGLE_LABEL_THRESHOLD. Catches blended policy concerns that the
// single-label rule misses (e.g. 4 distinct bad categories each scoring
// ~15% = ~60% combined spirit). 0.5 means at least half of the model's
// allocated probability mass falls on one of the bad categories.
const SUM_BAD_THRESHOLD = 0.5

let classifier: Awaited<ReturnType<typeof pipeline>> | null = null
let classifierLoading: Promise<void> | null = null

async function ensureClassifier(): Promise<void> {
	if (classifier) return
	if (classifierLoading) return classifierLoading

	classifierLoading = (async () => {
		try {
			log.info("Loading zero-shot classifier...")
			classifier = await pipeline(
				"zero-shot-classification",
				"Xenova/nli-deberta-v3-small",
			) as any
			log.info("Zero-shot classifier loaded")
		} catch (err) {
			log.error("Failed to load classifier", err)
			classifierLoading = null
			throw err
		}
	})()

	return classifierLoading
}

export interface ModerationResult {
	flagged: boolean
	reason: string
	/** Peak single bad-label confidence. 0 means "no bad label present". */
	score: number
	/**
	 * Cumulative bad-label probability mass across all bad categories.
	 * Only set when the aggregate rule fires — i.e. when the peak
	 * single-label rule didn't fire, but the cumulative sum of bad-label
	 * scores still exceeded `SUM_BAD_THRESHOLD`. Always `flagged: true`
	 * when present. Lets callers distinguish an aggregate flag from a
	 * high-confidence single-label flag at-a-glance without re-running
	 * the model.
	 */
	cumulativeScore?: number
}

export async function checkAdText(text: string): Promise<ModerationResult> {
	if (!text || text.trim().length === 0) {
		return { flagged: false, reason: "Empty", score: 0 }
	}

	// Stage 1: Zero-shot classification (ML only, no regex)
	try {
		await ensureClassifier()
		if (!classifier) {
			return { flagged: false, reason: "Model unavailable", score: 0 }
		}

		const result = await (classifier as any)(text, ALL_LABELS) as {
			labels: string[]
			scores: number[]
		}

		let topBad = { label: "", score: 0 }
		let sumBad = 0
		for (let i = 0; i < result.labels.length; i++) {
			if (BAD_LABELS.indexOf(result.labels[i]) !== -1) {
				if (result.scores[i] > topBad.score) {
					topBad = { label: result.labels[i], score: result.scores[i] }
				}
				sumBad += result.scores[i]
			}
		}

		// Lifted once so every return path reads from a single source of
		// truth; `score` is uniformly the peak single bad-label confidence
		// across all three verdict paths.
		const peak = topBad.score

		// Single-label rule: high-confidence flag on the top bad label.
		if (peak >= SINGLE_LABEL_THRESHOLD) {
			return {
				flagged: true,
				reason: `Policy violation (${topBad.label}: ${(peak * 100).toFixed(0)}%)`,
				score: peak,
			}
		}

		// Aggregate rule: catch blended cases where multiple bad labels
		// each score weakly individually but collectively indicate policy
		// concern. Threshold of 0.5 means at least half the model's
		// allocated probability mass falls on bad categories.
		if (sumBad >= SUM_BAD_THRESHOLD) {
			return {
				flagged: true,
				reason: `Aggregate policy concern (sum of bad labels ${(sumBad * 100).toFixed(0)}%, top label ${topBad.label} ${(peak * 100).toFixed(0)}%)`,
				score: peak,
				cumulativeScore: sumBad,
			}
		}

		return { flagged: false, reason: "Safe", score: peak }
	} catch (err) {
		log.error("ML classification failed", err)
		return { flagged: false, reason: "Classification error", score: 0 }
	}
}

export function preloadClassifier(): void {
	ensureClassifier().catch((err) => {
		log.warn("Background classifier preload failed", err)
	})
}
