import assert from "node:assert/strict";
import test from "node:test";

import { buildHighlightMetadata, dedupeHighlightsByCfi, formatHighlightNoteBlock } from "../src/highlight-core.ts";

test("dedupes highlights by CFI and keeps the latest record", () => {
  const list = [
    { id: "old", cfiRange: "epubcfi(/6/2!/4/1:0)" },
    { id: "other", cfiRange: "epubcfi(/6/4!/4/1:0)" },
    { id: "new", cfiRange: "epubcfi(/6/2!/4/1:0)" },
  ];

  assert.deepEqual(dedupeHighlightsByCfi(list).map((item) => item.id), ["new", "other"]);
});

test("preserves no-CFI highlights while deduping CFI-backed records", () => {
  const list = [
    { id: "legacy-a", cfiRange: "" },
    { id: "old", cfiRange: "same" },
    { id: "legacy-b" },
    { id: "new", cfiRange: "same" },
  ];

  assert.deepEqual(dedupeHighlightsByCfi(list).map((item) => item.id), ["legacy-a", "legacy-b", "new"]);
});

test("formats highlight note blocks without leaking template placeholders", () => {
  const block = formatHighlightNoteBlock({
    id: "h1",
    bookPath: "Book.epub",
    bookTitle: "Book",
    chapterTitle: "Chapter 1",
    cfiRange: "epubcfi(/6/2)",
    quote: "First line\nSecond line",
    comment: "A thought",
    notePath: "Book.md",
    blockId: "ar-test",
    created: "2026-06-17T00:00:00.000Z",
  });

  assert.match(block, /> \[!note\] Chapter 1/);
  assert.match(block, /> First line/);
  assert.match(block, /> \*\*笔记\*\*/);
  assert.match(block, /\^ar-test$/);
  assert.doesNotMatch(block, /\{highlight\./);
});

test("builds stable highlight metadata with id and blockId fallbacks", () => {
  assert.deepEqual(buildHighlightMetadata({ blockId: "block", quote: "Quote" }), {
    id: "block",
    bookPath: "",
    bookTitle: "",
    chapterTitle: "",
    cfiRange: "",
    quote: "Quote",
    comment: "",
    notePath: "",
    blockId: "block",
    created: "",
    updated: "",
  });
});
