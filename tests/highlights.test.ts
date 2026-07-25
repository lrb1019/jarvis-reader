import assert from "node:assert/strict";
import test from "node:test";

import { buildHighlightMetadata, buildHighlightNoteUpdate, dedupeHighlightsByCfi, formatHighlightNoteBlock } from "../src/highlight-core.ts";

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

test("formats a no-note highlight without merging the timestamp into its quote", () => {
  const block = formatHighlightNoteBlock({
    id: "h2", bookPath: "Book.epub", bookTitle: "Book", chapterTitle: "Chapter 1",
    cfiRange: "epubcfi(/6/2)", quote: "Quote only", comment: "", notePath: "Book.md",
    blockId: "ar-no-note", created: "2026-06-17T00:00:00.000Z",
  });

  assert.match(block, /> Quote only\n>\n> \*\*时间\*\*/);
  assert.doesNotMatch(block, />> \*\*时间\*\*/);
});

test("normalizes multiline chapter titles before writing callout headers", () => {
  const block = formatHighlightNoteBlock({
    id: "h3", bookPath: "Book.epub", bookTitle: "Book",
    chapterTitle: "\n          无处不在的系统\n        ",
    cfiRange: "epubcfi(/6/2)", quote: "真正的划线原文", comment: "", notePath: "Book.md",
    blockId: "ar-multiline-title", created: "2026-07-25T00:00:00.000Z",
  });

  assert.match(block, /^> \[!note\] 无处不在的系统\n> 真正的划线原文/);
  assert.doesNotMatch(block, /\n\s+无处不在的系统\s*\n/);
});

test("builds stable highlight index metadata without duplicating Markdown content", () => {
  assert.deepEqual(buildHighlightMetadata({ blockId: "block", quote: "Quote", comment: "Thought", markColor: "green" }), {
    id: "block",
    bookPath: "",
    bookTitle: "",
    chapterTitle: "",
    cfiRange: "",
    notePath: "",
    blockId: "block",
    created: "",
    updated: "",
    markColor: "green",
  });
});

test("keeps Markdown-owned quote text when updating a reloaded highlight note", () => {
  const current = {
    id: "h", blockId: "h", bookPath: "Book.epub", bookTitle: "Book", chapterTitle: "Chapter",
    cfiRange: "cfi", quote: "", comment: "", notePath: "Book.md", created: "2026-07-11T00:00:00.000Z",
  };
  const updated = buildHighlightNoteUpdate(current, { quote: "Original quote from Markdown" }, "Remaining note", "2026-07-11T01:00:00.000Z");

  assert.equal(updated.quote, "Original quote from Markdown");
  assert.equal(updated.comment, "Remaining note");
});
