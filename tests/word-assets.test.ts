import assert from "node:assert/strict";
import test from "node:test";
import { buildWordAsset, findWordAssetBySurface, getWordBookNotePath } from "../src/core/word-assets.ts";
import { createSettings } from "./storage-fixtures.ts";

const result = {
  lemma: "compound",
  surface: "Compound",
  translation: "积累",
  display: "**中文释义**：积累",
  phonetic: "/kəmˈpaʊnd/",
  partOfSpeech: "v.",
  example: "Benefits compound.",
  isWord: true,
  sourceType: "ai" as const,
};

test("builds a complete word asset with one stable source", () => {
  const settings = createSettings();
  const asset = buildWordAsset(
    { path: "Books/Book.epub", title: "Book" },
    { quote: "Compounds", chapterTitle: "Chapter", cfiRange: "epubcfi(1)" },
    result,
    settings,
    undefined,
    "2026-06-12T00:00:00.000Z",
  );
  assert.equal(asset.lemma, "compound");
  assert.equal(asset.kind, "word");
  assert.equal(asset.display, result.display);
  assert.equal(asset.notePath, "09 Books/Words/Book.md");
  assert.deepEqual(asset.surfaceForms, ["compound", "Compounds"]);
  assert.equal(asset.sources.length, 1);
});

test("sentence assets use internal keys and Chinese sentence sections", () => {
  const settings = createSettings();
  const asset = buildWordAsset(
    { path: "Books/Book.epub", title: "Book" },
    { quote: "This is a sentence.", chapterTitle: "Chapter", cfiRange: "epubcfi(2)" },
    { ...result, lemma: "", surface: "This is a sentence.", translation: "这是一个句子。", display: "这是一个句子。", isWord: false },
    settings,
    undefined,
    "2026-06-12T00:00:00.000Z",
  );
  assert.match(asset.lemma, /^sentence-/);
  assert.equal(asset.kind, "sentence");
  assert.equal(asset.title, "This is a sentence.");
});

test("word note path is aggregated by book and sanitized", () => {
  assert.equal(getWordBookNotePath('A/B: Book', createSettings()), "09 Books/Words/A-B- Book.md");
});

test("global lookup resolves direct forms and common inflections", () => {
  const settings = createSettings();
  const saved = buildWordAsset(
    { path: "Books/Book.epub", title: "Book" },
    { quote: "compound", chapterTitle: "Chapter", cfiRange: "epubcfi(1)" },
    result,
    settings,
    undefined,
    "2026-06-12T00:00:00.000Z",
  );
  assert.equal(findWordAssetBySurface({ compound: saved }, "compounds")?.lemma, "compound");
  assert.equal(findWordAssetBySurface({ compound: saved }, "unknown"), null);
});

test("saving the same word at a new CFI appends a unique source", () => {
  const settings = createSettings();
  const first = buildWordAsset(
    { path: "Books/Book.epub", title: "Book" },
    { quote: "compound", chapterTitle: "One", cfiRange: "epubcfi(1)" },
    result,
    settings,
    undefined,
    "2026-06-12T00:00:00.000Z",
  );
  const second = buildWordAsset(
    { path: "Books/Book.epub", title: "Book" },
    { quote: "compound", chapterTitle: "Two", cfiRange: "epubcfi(2)" },
    result,
    settings,
    first,
    "2026-06-12T01:00:00.000Z",
  );
  assert.equal(second.sources.length, 2);
  const duplicate = buildWordAsset(
    { path: "Books/Book.epub", title: "Book" },
    { quote: "compound", chapterTitle: "Two", cfiRange: "epubcfi(2)" },
    result,
    settings,
    second,
    "2026-06-12T02:00:00.000Z",
  );
  assert.equal(duplicate.sources.length, 2);
});
