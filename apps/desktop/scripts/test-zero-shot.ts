import { pipeline } from "@xenova/transformers"

const DATING_TEXTS = [
  "Meet beautiful women near you tonight",
  "Looking for women to date",
  "Meet attractive women nearby for dating",
  "Ukrainian girls for men",
  "Anna is looking for someone tonight",
]

async function testLabels(classifier: any, labels: string[], texts: string[]) {
  for (const text of texts) {
    const r = await classifier(text, labels)
    console.log(`"${text}"`)
    for (let i = 0; i < r.labels.length; i++) {
      console.log(`  ${r.labels[i]}: ${(r.scores[i] * 100).toFixed(1)}%`)
    }
    console.log()
  }
}

async function main() {
  const classifier = await pipeline(
    "zero-shot-classification",
    "Xenova/nli-deberta-v3-small",
  ) as any

  console.log("=== Attempt 1: current label ===")
  await testLabels(classifier, ["dating ad", "legitimate business"], DATING_TEXTS)

  console.log("=== Attempt 2: 'personal ad' ===")
  await testLabels(classifier, ["personal ad", "legitimate business"], DATING_TEXTS)

  console.log("=== Attempt 3: 'meeting women for dating' ===")
  await testLabels(classifier, ["meeting women for dating", "legitimate business"], DATING_TEXTS)

  console.log("=== Attempt 4: 'seeking romantic partner' ===")
  await testLabels(classifier, ["seeking romantic partner", "legitimate business"], DATING_TEXTS)

  console.log("=== Attempt 5: 'matchmaking or dating service' ===")
  await testLabels(classifier, ["matchmaking or dating service", "legitimate business"], DATING_TEXTS)

  console.log("=== Attempt 6: 'dating website' ===")
  await testLabels(classifier, ["dating website", "legitimate business"], DATING_TEXTS)
}

main().catch(console.error)
