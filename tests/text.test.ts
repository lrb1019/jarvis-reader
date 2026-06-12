import assert from "node:assert/strict";
import test from "node:test";
import {
  getTranslationAssetKey,
  getTranslationAssetKind,
  getTranslationAssetStorageKey,
  getTranslationSelectionType,
  getWordBlockId,
  isWordInflectionOf,
  mergeStringList,
  normalizeHighlightQuote,
  normalizeWordDisplayText,
  normalizeWordSelection,
  sanitizeWordAssetFilename,
} from "../src/core/text.ts";

test("normalizes highlight whitespace", () => {
  assert.equal(normalizeHighlightQuote("  one\n\t two  "), "one two");
  assert.equal(normalizeHighlightQuote(null), "");
});

test("normalizes English words and phrases exactly like the stable bundle", () => {
  assert.deepEqual(normalizeWordSelection(" “Earth–shattering!” "), {
    lemma: "earth-shattering",
    surface: "Earth-shattering",
    tokens: ["Earth-shattering"],
    isSingleWord: true,
    isPhrase: false,
  });
  assert.equal(normalizeWordSelection("in spite of" )?.lemma, "in spite of");
  assert.equal(normalizeWordSelection("one two three four five"), null);
  assert.equal(normalizeWordSelection("中文"), null);
  assert.equal(normalizeWordSelection("word_2")?.lemma, "word");
});

test("classifies selections and assets", () => {
  assert.equal(getTranslationSelectionType("underestimate"), "word");
  assert.equal(getTranslationSelectionType("in spite of"), "phrase");
  assert.equal(getTranslationSelectionType("This is a sentence."), "sentence");
  assert.equal(getTranslationSelectionType("这是中文"), "sentence");
  assert.equal(getTranslationAssetKind({ kind: "sentence", isWord: true }), "sentence");
  assert.equal(getTranslationAssetKind("compound", { isWord: false }), "sentence");
  assert.equal(getTranslationAssetKind("in front of", { isWord: true }), "phrase");
});

test("generates stable storage keys and block ids", () => {
  assert.equal(
    getTranslationAssetKey({ quote: "Compounds" }, { lemma: "Compound", isWord: true }),
    "compound",
  );
  assert.equal(
    getTranslationAssetKey(
      { quote: "This compounds over time.", cfiRange: "epubcfi(/6/2!/4/2)" },
      { isWord: false },
    ),
    "sentence-qlfcvr",
  );
  assert.equal(
    getTranslationAssetStorageKey({ lemma: "Earth-Shattering", kind: "phrase" }),
    "earth-shattering",
  );
  assert.equal(
    getTranslationAssetStorageKey({ lemma: "sentence-abc", kind: "sentence" }),
    "sentence-abc",
  );
  assert.equal(getWordBlockId("in spite of"), "jr-word-in-spite-of");
  assert.equal(getWordBlockId("中文"), "jr-word-word");
});

test("preserves filename, display and word-form behavior", () => {
  assert.equal(sanitizeWordAssetFilename(' a/b:*?  c '), "a-b--- c");
  assert.equal(normalizeWordDisplayText("line 1\\r\\nline 2\\nline 3"), "line 1\nline 2\nline 3");
  assert.deepEqual(mergeStringList(["a", "b"], "b"), ["a", "b"]);
  assert.equal(mergeStringList(Array.from({ length: 12 }, (_, i) => String(i)), "12").length, 12);
  assert.equal(isWordInflectionOf("multiplied", "multiply"), true);
  assert.equal(isWordInflectionOf("making", "make"), true);
  assert.equal(isWordInflectionOf("made", "make"), false);
});
