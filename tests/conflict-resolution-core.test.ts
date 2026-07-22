import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyConflictFiles,
  hasConflictFiles,
  mergeHighlightPayload,
  mergeSettingsPayload,
  mergeWordAssetPayload,
} from "../src/conflict-resolution-core.ts";

test("conflict detection classifies only supported conflict copies", () => {
  const files = classifyConflictFiles(
    [
      ".obsidian/plugins/jarvis-reader/index/word-assets.json",
      ".obsidian/plugins/jarvis-reader/index/word-assets-a1.json",
      ".obsidian/plugins/jarvis-reader/index/highlights (conflict).json",
      ".obsidian/plugins/jarvis-reader/index/unrelated.json",
    ],
    [
      ".obsidian/plugins/jarvis-reader/data.json",
      ".obsidian/plugins/jarvis-reader/data-conflict.json",
    ],
  );
  assert.deepEqual(files.wordAssets, [".obsidian/plugins/jarvis-reader/index/word-assets-a1.json"]);
  assert.deepEqual(files.highlights, [".obsidian/plugins/jarvis-reader/index/highlights (conflict).json"]);
  assert.deepEqual(files.settings, [".obsidian/plugins/jarvis-reader/data-conflict.json"]);
  assert.equal(hasConflictFiles(files), true);
});

test("word conflict merge keeps newer content and merges distinct sources", () => {
  const merged = mergeWordAssetPayload({
    habit: { lemma: "habit", translation: "旧", updated: "2026-01-01", sources: [{ bookPath: "a.epub", cfiRange: "a" }] },
  }, {
    wordAssets: {
      habit: { lemma: "habit", translation: "新", updated: "2026-02-01", sources: [{ bookPath: "b.epub", cfiRange: "b" }] },
    },
  });
  assert.equal((merged?.habit as Record<string, unknown>).translation, "新");
  assert.equal(((merged?.habit as Record<string, unknown>).sources as unknown[]).length, 2);
});

test("highlight conflict merge accepts only index fields and keeps newer metadata", () => {
  const merged = mergeHighlightPayload({
    "a.epub": [{ id: "h1", cfiRange: "c1", chapterTitle: "旧", updated: "2026-01-01" }],
  }, {
    bookHighlights: {
      "a.epub": [{ id: "h1", blockId: "h1", cfiRange: "c1", chapterTitle: "新", updated: "2026-02-01", quote: "不得进入索引" }],
    },
  });
  const entry = merged?.["a.epub"][0] as Record<string, unknown>;
  assert.equal(entry.chapterTitle, "新");
  assert.equal("quote" in entry, false);
});

test("settings conflict merge does not double-count overlapping reading snapshots", () => {
  const merged = mergeSettingsPayload({
    readingStats: { "2026-07-22": { "a.epub": 120 } },
    wordReviewStats: { "2026-07-22": { reviewCount: 3, reviewTimeMs: 1000 } },
    bookProgress: { "a.epub": { updated: "2026-07-21", percentage: 20 } },
  }, {
    readingStats: { "2026-07-22": { "a.epub": 100, "b.epub": 40 } },
    wordReviewStats: { "2026-07-22": { reviewCount: 2, reviewTimeMs: 1500 } },
    bookProgress: { "a.epub": { updated: "2026-07-22", percentage: 30 } },
  });
  assert.deepEqual(merged?.readingStats["2026-07-22"], { "a.epub": 120, "b.epub": 40 });
  assert.deepEqual(merged?.wordReviewStats["2026-07-22"], { reviewCount: 3, reviewTimeMs: 1500 });
  assert.equal(merged?.bookProgress["a.epub"].percentage, 30);
});

test("invalid conflict payloads stop before mutation", () => {
  assert.equal(mergeWordAssetPayload({}, { wordAssets: [] }), null);
  assert.equal(mergeHighlightPayload({}, { bookHighlights: { book: "invalid" } }), null);
  assert.equal(mergeSettingsPayload({ readingStats: {}, wordReviewStats: {}, bookProgress: {} }, { readingStats: { day: { book: "invalid" } } }), null);
});
