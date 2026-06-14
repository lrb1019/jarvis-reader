import assert from "node:assert/strict";
import test from "node:test";
import {
  createBookHighlight,
  deleteBookHighlight,
  deleteHighlightNoteBlock,
  formatHighlightNoteBlock,
  HIGHLIGHT_COLOR_STYLES,
  normalizeHighlightColor,
  updateBookHighlight,
  upsertBookHighlight,
  upsertHighlightNoteBlock,
} from "../src/core/highlights.ts";

const now = "2026-06-12T12:00:00.000Z";

test("normalizes the five highlight colors and defaults legacy data to yellow", () => {
  for (const color of ["yellow", "green", "blue", "pink", "purple"] as const) {
    assert.equal(normalizeHighlightColor(color), color);
    assert.ok(HIGHLIGHT_COLOR_STYLES[color]);
  }
  assert.equal(normalizeHighlightColor(undefined), "yellow");
  assert.equal(normalizeHighlightColor("orange"), "yellow");
});

test("creates, updates, upserts and deletes a highlight without changing its identity", () => {
  const created = createBookHighlight(
    {
      bookPath: "Book.epub",
      bookTitle: "Book",
      chapterTitle: "Chapter 1",
      cfiRange: "epubcfi(/6/2)",
      quote: "  selected\n text ",
      comment: " first thought ",
      markColor: "green",
      notePath: "Book.md",
    },
    { id: "ar-fixed", now },
  );
  assert.equal(created.quote, "selected text");
  assert.equal(created.comment, "first thought");
  assert.equal(created.markColor, "green");

  const updated = updateBookHighlight(
    created,
    { comment: " revised ", markColor: "purple" },
    "2026-06-12T13:00:00.000Z",
  );
  assert.equal(updated.id, created.id);
  assert.equal(updated.blockId, created.blockId);
  assert.equal(updated.comment, "revised");
  assert.equal(updated.markColor, "purple");
  assert.deepEqual(upsertBookHighlight([created], updated), [updated]);
  assert.deepEqual(deleteBookHighlight([updated], updated.id), []);
});

test("rejects highlights without quote or CFI", () => {
  const base = {
    bookPath: "Book.epub",
    bookTitle: "Book",
    chapterTitle: "Chapter",
    cfiRange: "epubcfi(1)",
    quote: "Quote",
  };
  assert.throws(() => createBookHighlight({ ...base, quote: "" }), /quote and CFI/);
  assert.throws(() => createBookHighlight({ ...base, cfiRange: "" }), /quote and CFI/);
});

test("highlight Markdown block supports create, update and delete", () => {
  const created = createBookHighlight(
    {
      bookPath: "Book.epub",
      bookTitle: "Book",
      chapterTitle: "Chapter",
      cfiRange: "epubcfi(1)",
      quote: "Quote",
      comment: "Thought",
      notePath: "Book.md",
    },
    { id: "ar-fixed", now },
  );
  const initial = upsertHighlightNoteBlock("# Book\n", created);
  assert.match(initial, /## Chapter/);
  assert.match(initial, /> \[!note\] Chapter/);
  assert.match(initial, /> \*\*想法\*\*/);
  assert.match(initial, /\^ar-fixed/);
  assert.equal((initial.match(/\^ar-fixed/g) || []).length, 1);

  const updated = updateBookHighlight(created, { comment: "Revised", markColor: "blue" }, now);
  const replaced = upsertHighlightNoteBlock(initial, updated);
  assert.match(replaced, /> Revised/);
  assert.doesNotMatch(replaced, /> Thought/);
  assert.equal((replaced.match(/\^ar-fixed/g) || []).length, 1);
  assert.equal(formatHighlightNoteBlock(updated).endsWith("^ar-fixed"), true);

  const deleted = deleteHighlightNoteBlock(replaced, updated.blockId);
  assert.equal(deleted, "# Book\n\n## Chapter\n");
  assert.doesNotMatch(deleted, /\^ar-fixed/);
});

test("new blocks are inserted inside an existing chapter section", () => {
  const highlight = createBookHighlight(
    {
      bookPath: "Book.epub",
      bookTitle: "Book",
      chapterTitle: "Chapter 1",
      cfiRange: "epubcfi(1)",
      quote: "Quote",
    },
    { id: "ar-section", now },
  );
  const content = "# Book\n\n## Chapter 1\n\nExisting\n\n## Chapter 2\n\nLater\n";
  const updated = upsertHighlightNoteBlock(content, highlight);
  assert.ok(updated.indexOf("^ar-section") < updated.indexOf("## Chapter 2"));
  assert.equal((updated.match(/## Chapter 1/g) || []).length, 1);
});
