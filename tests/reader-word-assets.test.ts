import assert from "node:assert/strict";
import test from "node:test";
import type { WordAsset } from "../src/domain/index.ts";
import {
  removeWordAssetMarks,
  renderWordAssets,
  type WordAssetRenditionLike,
} from "../src/reader/word-assets.ts";

function asset(kind: WordAsset["kind"] = "word"): WordAsset {
  return {
    lemma: kind === "sentence" ? "sentence-1" : "compound",
    title: "compound",
    kind,
    isWord: kind !== "sentence",
    surfaceForms: [],
    translation: "积累",
    display: "积累",
    phonetic: "",
    partOfSpeech: "",
    example: "",
    notePath: "Words.md",
    blockId: "jr-word-compound",
    mastered: false,
    sources: [{ bookPath: "Book.epub", bookTitle: "Book", chapterTitle: "Chapter", cfiRange: "epubcfi(1)", quote: "compound", created: "now" }],
    created: "now",
    updated: "now",
  };
}

test("renders one DOM-safe underline per saved source", () => {
  const calls: Array<{ className: string; stroke: string }> = [];
  const rendition: WordAssetRenditionLike = {
    annotations: {
      underline: (_cfi, _data, _callback, className, styles) => {
        calls.push({ className, stroke: styles.stroke || "" });
      },
      remove: () => undefined,
    },
  };
  renderWordAssets(rendition, [asset("word")], "Book.epub", () => undefined);
  renderWordAssets(rendition, [asset("word")], "Book.epub", () => undefined);
  assert.deepEqual(calls, [{ className: "jarvis-reader-word-word", stroke: "#3b82f6" }]);
});

test("removal clears the underline identity for future rendering", () => {
  let count = 0;
  const rendition: WordAssetRenditionLike = {
    annotations: { underline: () => { count += 1; }, remove: () => undefined },
  };
  const saved = asset("phrase");
  renderWordAssets(rendition, [saved], "Book.epub", () => undefined);
  removeWordAssetMarks(rendition, saved, "Book.epub");
  renderWordAssets(rendition, [saved], "Book.epub", () => undefined);
  assert.equal(count, 2);
});
