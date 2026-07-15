import type { Tokenizer } from "@orama/orama";
import { createFromSource } from "fumadocs-core/search/server";
import { source } from "@/lib/source";

const cjkTokenizer: Tokenizer = {
  language: "zh",
  normalizationCache: new Map(),
  tokenize(raw) {
    const tokens = new Set<string>();
    const normalized = raw.normalize("NFKC").toLowerCase();
    const parts =
      normalized.match(/[\p{Script=Han}]+|[a-z0-9_'-]+/gu) ?? [];

    for (const part of parts) {
      if (/^[a-z0-9_'-]+$/u.test(part)) {
        tokens.add(part);
        continue;
      }

      const chars = Array.from(part);

      tokens.add(part);

      for (let index = 0; index < chars.length - 1; index += 1) {
        tokens.add(`${chars[index]}${chars[index + 1]}`);
      }
    }

    return Array.from(tokens);
  },
};

export const { GET } = createFromSource(source, {
  localeMap: {
    zh: {
      tokenizer: cjkTokenizer,
    },
  },
});
