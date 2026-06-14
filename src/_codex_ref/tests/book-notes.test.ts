import assert from "node:assert/strict";
import test from "node:test";
import { getBookNotePath, normalizeBookNoteFolder, renderBookNoteContent } from "../src/core/book-notes.ts";

const book = { basename: "Atomic Habits", extension: "epub", parentPath: "Books" };

test("builds book note paths from configured or source folders", () => {
  assert.equal(getBookNotePath(book), "Books/Atomic Habits.md");
  assert.equal(getBookNotePath(book, { bookNoteFolder: " Notes\\Reading/ " }), "Notes/Reading/Atomic Habits.md");
  assert.equal(normalizeBookNoteFolder("/Notes\\Reading/"), "Notes/Reading");
});

test("renders the stable default book note content", () => {
  const content = renderBookNoteContent(book, "# Chapter 1", {}, new Date(2026, 5, 13, 9, 8, 7));
  assert.equal(content, "---\nbookname: \"[[Atomic Habits.epub]]\"\ncreated: 2026-06-13 09:08:07\n---\n\n# Chapter 1");
});

test("renders all supported book note template variables", () => {
  const content = renderBookNoteContent(book, "# Chapter 1", {
    bookNoteTemplate: "{{title}}|{{bookname}}|{{extension}}|{{created}}\n{{toc}}",
  }, new Date(2026, 5, 13, 9, 8, 7));
  assert.equal(content, "Atomic Habits|Atomic Habits.epub|epub|2026-06-13 09:08:07\n# Chapter 1");
});
