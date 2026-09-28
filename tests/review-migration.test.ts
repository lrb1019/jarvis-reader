import assert from "node:assert/strict";
import test from "node:test";

import { removeReviewData } from "../src/review-migration.ts";

const asset = {
  lemma: "fracture",
  title: "Fracture",
  kind: "word" as const,
  surfaceForms: ["fracture"],
  translation: "破裂",
  display: "破裂",
  phonetic: "",
  partOfSpeech: "",
  example: "",
  sources: [],
  created: "2026-07-11T00:00:00.000Z",
  updated: "2026-07-11T00:00:00.000Z",
};

test("review migration removes only review fields", () => {
  const source = {
    wordAssets: {
      fracture: { ...asset, mastered: false, interval: 3, ease: 2.5, reviews: 1 },
    },
    wordReviewStats: { "2026-07-11": { reviewCount: 1 } },
    sm2MaxInterval: 365,
    readingStats: { "2026-07-11": { "Book.epub": 120 } },
    unknownSetting: "kept",
  };

  const result = removeReviewData(source.wordAssets, source);

  assert.equal("mastered" in result.wordAssets.fracture, false);
  assert.equal("interval" in result.wordAssets.fracture, false);
  assert.equal(result.wordAssets.fracture.translation, "破裂");
  assert.equal(result.changed, true);
  assert.deepEqual(result.settings.readingStats, source.readingStats);
  assert.equal(result.settings.unknownSetting, "kept");
  assert.equal("isWord" in result.wordAssets.fracture, false);
});

test("review migration removes legacy sentence records and sentence color", () => {
  const settings = {
    wordAssets: {
      fracture: asset,
      "sentence-1": { ...asset, lemma: "sentence-1", kind: "sentence" as any, isWord: false },
    },
    highlightColors: { word: "#1", sentence: "#2" },
  };
  const result = removeReviewData(settings.wordAssets as any, settings);

  assert.equal(result.changed, true);
  assert.deepEqual(result.wordAssets, { fracture: asset });
  assert.deepEqual(result.settings.highlightColors, { word: "#1" });
});

test("review migration is a no-op when no review data exists", () => {
  const settings = { wordAssets: { fracture: asset }, readingStats: {} };
  const result = removeReviewData(settings.wordAssets, settings);

  assert.equal(result.changed, false);
  assert.equal(result.wordAssets, settings.wordAssets);
  assert.equal(result.settings, settings);
});
