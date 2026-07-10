import assert from "node:assert/strict";
import test from "node:test";

import {
  buildWordAssetFromSelection,
  findWordAssetBySurface,
  getDictionaryLookupKeys,
  getTranslationAssetKey,
  getTranslationSelectionType,
  normalizeDictionaryEntry,
  normalizeWordSelection,
  parseWordAssetSidecar,
} from "../src/word-assets.ts";

const file = { path: "Books/Atomic.epub", basename: "Atomic" } as any;

test("normalizes word and phrase selections", () => {
  assert.deepEqual(normalizeWordSelection("  “Atomic habits”  "), {
    lemma: "atomic habits",
    surface: "Atomic habits",
    tokens: ["Atomic", "habits"],
    isSingleWord: false,
    isPhrase: true,
  });
  assert.equal(normalizeWordSelection("not_a_word"), null);
});

test("classifies translation selections", () => {
  assert.equal(getTranslationSelectionType("compound"), "word");
  assert.equal(getTranslationSelectionType("atomic habits"), "phrase");
  assert.equal(getTranslationSelectionType("Your outcomes are lagging measures."), "sentence");
});

test("generates dictionary lookup keys for common inflections", () => {
  assert.deepEqual(getDictionaryLookupKeys("fractures"), ["fractures", "fracture"]);
  assert.deepEqual(getDictionaryLookupKeys("studied"), ["studied", "study"]);
  assert.deepEqual(getDictionaryLookupKeys("running"), ["running", "runn", "run", "runne"]);
});

test("normalizes dictionary entries into display-first cards", () => {
  assert.deepEqual(normalizeDictionaryEntry("Compound", "compound", "复合物"), {
    lemma: "compound",
    surface: "Compound",
    translation: "复合物",
    phonetic: "",
    partOfSpeech: "",
    example: "",
    display: "**中文释义**：复合物",
    isWord: true,
    sourceType: "local-dictionary",
  });
});

test("builds stable sentence asset keys from CFI and quote", () => {
  const first = getTranslationAssetKey({ cfiRange: "cfi-1", quote: "A sentence." }, { isWord: false });
  const second = getTranslationAssetKey({ cfiRange: "cfi-1", quote: "A sentence." }, { isWord: false });

  assert.match(first, /^sentence-/);
  assert.equal(first, second);
});

test("builds word assets with merged surface forms and single source", () => {
  const asset = buildWordAssetFromSelection(
    file,
    { quote: "Fractures", cfiRange: "cfi-1", chapterTitle: "Chapter" },
    { lemma: "fracture", translation: "破裂", display: "display" },
    { surfaceForms: ["fracture"], sources: [{ bookPath: "Old.epub", cfiRange: "old" }], created: "old-date" },
  );

  assert.equal(asset?.lemma, "fracture");
  assert.equal(asset?.kind, "word");
  assert.deepEqual(asset?.surfaceForms, ["fracture", "Fractures"]);
  assert.deepEqual(asset?.sources, [{ bookPath: "Old.epub", cfiRange: "old" }]);
  assert.equal(asset?.created, "old-date");
});

test("finds saved word assets by inflected surface", () => {
  const assets = {
    fracture: {
      lemma: "fracture",
      kind: "word",
      surfaceForms: ["fracture"],
      sources: [],
    },
  };

  assert.equal(findWordAssetBySurface(assets, "fractures")?.lemma, "fracture");
});

const validSidecarAsset = {
  lemma: "fracture",
  title: "Fracture",
  kind: "word",
  isWord: true,
  surfaceForms: ["fracture"],
  translation: "破裂",
  display: "**中文释义**：破裂",
  phonetic: "",
  partOfSpeech: "",
  example: "",
  mastered: false,
  sources: [{
    bookPath: "Books/Atomic.epub",
    bookTitle: "Atomic",
    chapterTitle: "Chapter",
    cfiRange: "cfi-1",
    quote: "fracture",
    created: "2026-07-10T00:00:00.000Z",
  }],
  created: "2026-07-10T00:00:00.000Z",
  updated: "2026-07-10T00:00:00.000Z",
};

test("accepts only complete version 2 word asset sidecars", () => {
  const parsed = parseWordAssetSidecar({ version: 2, wordAssets: { fracture: validSidecarAsset } });

  assert.equal(parsed?.fracture?.lemma, "fracture");
  assert.equal(parseWordAssetSidecar({ version: 1, wordAssets: {} }), null);
  assert.equal(parseWordAssetSidecar({ version: 2, wordAssets: [] }), null);
  assert.equal(parseWordAssetSidecar({ version: 2, wordAssets: { fracture: { lemma: "fracture" } } }), null);
});
