import assert from "node:assert/strict";
import test from "node:test";

import {
  buildWordAssetFromSelection,
  findWordAssetBySurface,
  getDictionaryLookupKeys,
  getLightWordAsset,
  getTranslationAssetKey,
  getTranslationSelectionType,
  normalizeDictionaryEntry,
  normalizeWordSelection,
  parseWordAssetSidecar,
} from "../src/word-assets.ts";

const file = { path: "Books/Atomic.epub", basename: "Atomic" } as any;

test("word asset projection retains complete legacy fields and shallow references", () => {
  const asset = { lemma: "battle", display: "**meaning**", legacyFlag: false, sources: [{ bookPath: "Books/A.epub" }] };
  const projected = getLightWordAsset(asset);
  assert.notEqual(projected, asset);
  assert.deepEqual(projected, asset);
  assert.equal(projected.sources, asset.sources);
  projected.display = "changed copy";
  assert.equal(asset.display, "**meaning**");
  assert.equal(getLightWordAsset(null), null);
  assert.equal(getLightWordAsset(undefined), undefined);
});

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
    sourceType: "local-dictionary",
  });
});

test("uses isWord only to reject sentence translations", () => {
  assert.equal(getTranslationAssetKey({ quote: "existence" }, { lemma: "existence" }), "existence");
  assert.equal(getTranslationAssetKey({ cfiRange: "cfi-1", quote: "A sentence." }, { isWord: false }), "");
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
  surfaceForms: ["fracture"],
  translation: "破裂",
  display: "**中文释义**：破裂",
  phonetic: "",
  partOfSpeech: "",
  example: "",
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

test("accepts complete version 2 word asset sidecars, including old review fields", () => {
  const parsed = parseWordAssetSidecar({ version: 2, wordAssets: { fracture: { ...validSidecarAsset, mastered: false } } });

  assert.equal(parsed?.fracture?.lemma, "fracture");
  assert.equal(parseWordAssetSidecar({ version: 1, wordAssets: {} }), null);
  assert.equal(parseWordAssetSidecar({ version: 2, wordAssets: [] }), null);
  assert.equal(parseWordAssetSidecar({ version: 2, wordAssets: { fracture: { lemma: "fracture" } } }), null);
});
