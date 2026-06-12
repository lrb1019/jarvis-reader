import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTranslationEndpoint,
  buildTranslationPromptText,
  extractTranslationResponseText,
  normalizeTranslationResult,
  parseTranslationResponseText,
} from "../src/translation/core.ts";
import { getDictionaryLookupKeys, lookupEcdict } from "../src/translation/dictionary.ts";
import { translateSelection } from "../src/translation/service.ts";
import { createSettings } from "./storage-fixtures.ts";

test("parses strict and fenced translation JSON and normalizes display", () => {
  const strict = parseTranslationResponseText('{"lemma":"compound","translation":"积累","display":"line 1\\nline 2","isWord":true}');
  assert.equal(strict?.lemma, "compound");
  const fenced = parseTranslationResponseText('```json\n{"translation":"译文"}\n```');
  assert.equal(fenced?.translation, "译文");
  const result = normalizeTranslationResult("Compounds", strict || {}, "word");
  assert.equal(result.lemma, "compound");
  assert.equal(result.display, "line 1\nline 2");
});

test("sentence normalization never leaks word-card fields", () => {
  const result = normalizeTranslationResult(
    "This is a sentence.",
    { lemma: "wrong", translation: "这是一个句子。", display: "ignored", isWord: true },
    "sentence",
  );
  assert.equal(result.lemma, "");
  assert.equal(result.display, "这是一个句子。");
  assert.equal(result.isWord, false);
});

test("builds provider endpoints, prompts and response envelopes", () => {
  assert.equal(
    buildTranslationEndpoint({ provider: "anthropic", baseUrl: "https://api.test/anthropic", apiKey: "key", model: "m" }),
    "https://api.test/anthropic/v1/messages",
  );
  assert.match(buildTranslationPromptText("{{word}}|{{selectionType}}|{{sentence}}", "compound", "context"), /^compound\|word\|context$/);
  assert.equal(extractTranslationResponseText("anthropic", { content: [{ text: "ok" }] }), "ok");
  assert.equal(extractTranslationResponseText("openai-compatible", { choices: [{ message: { content: "ok" } }] }), "ok");
});

test("ECDICT lookup loads only the matching shard and supports inflections", async () => {
  assert.deepEqual(getDictionaryLookupKeys("multiplied").slice(0, 2), ["multiplied", "multiply"]);
  const reads: string[] = [];
  const result = await lookupEcdict(
    {
      async read(path) {
        reads.push(path);
        return JSON.stringify({ multiply: { translation: "增加", display: "**中文释义**：增加" } });
      },
    },
    "multiplied",
  );
  assert.equal(result?.lemma, "multiply");
  assert.ok(reads.every((path) => path.endsWith("/m.json")));
});

test("translation service prefers ECDICT before HTTP", async () => {
  const settings = createSettings();
  let posted = false;
  const result = await translateSelection(
    settings,
    "compound",
    "context",
    { read: async () => JSON.stringify({ compound: { translation: "积累", display: "**中文释义**：积累" } }) },
    { post: async () => { posted = true; return {}; } },
  );
  assert.equal(result.sourceType, "local-dictionary");
  assert.equal(posted, false);
});
