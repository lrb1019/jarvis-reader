import assert from "node:assert/strict";
import test from "node:test";
import { getLibraryHighlightLinks, getLibraryHighlightNoteEntries, type LibraryHighlight } from "../src/library/library-highlight-core.ts";

const indexOnlyHighlight = {
  id: "h-1",
  blockId: "h-1",
  bookPath: "a.epub",
  bookTitle: "A",
  chapterTitle: "第一章",
  cfiRange: "cfi-1",
  notePath: "missing.md",
  created: "2026-07-22T00:00:00.000Z",
  updated: "",
} satisfies LibraryHighlight;

test("index-only highlights render as empty details instead of throwing", () => {
  assert.deepEqual(getLibraryHighlightNoteEntries(indexOnlyHighlight), []);
  assert.deepEqual(getLibraryHighlightLinks(indexOnlyHighlight), []);
});

test("fallback comments and associated links are normalized for the library", () => {
  const highlight: LibraryHighlight = {
    ...indexOnlyHighlight,
    comment: "第一条\n\n第二条",
    aiSections: [{ title: "关联文章", text: "", links: ["知识/A", "知识/A", ""] }],
  };
  assert.deepEqual(getLibraryHighlightNoteEntries(highlight).map((entry) => entry.text), ["第一条", "第二条"]);
  assert.deepEqual(getLibraryHighlightLinks(highlight), ["知识/A"]);
});
