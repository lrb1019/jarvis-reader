import assert from "node:assert/strict";
import test from "node:test";
import {
  clampReaderLineHeight,
  clampReaderZoom,
  findChapterTitle,
  formatReaderProgressLabel,
  getEpubTocMarkdown,
  getReaderOptions,
  getReaderProgress,
  normalizeReaderMode,
} from "../src/reader/core.ts";

test("converts nested EPUB toc to Markdown and resolves chapter href", () => {
  const toc = [
    {
      label: " Part\u0000 One ",
      href: "text/part.xhtml#start",
      subitems: [{ label: "Chapter 1", href: "text/chapter.xhtml" }],
    },
  ];
  assert.equal(getEpubTocMarkdown(toc), "# Part One\n\n## Chapter 1");
  assert.equal(findChapterTitle(toc, "OPS/text/chapter.xhtml?x=1"), "Chapter 1");
});

test("clamps reader display settings to stable limits", () => {
  assert.equal(clampReaderZoom(0.1), 0.6);
  assert.equal(clampReaderZoom(1.234), 1.25);
  assert.equal(clampReaderZoom(3), 2);
  assert.equal(clampReaderLineHeight(0.5), 1.1);
  assert.equal(clampReaderLineHeight(1.63), 1.65);
  assert.equal(clampReaderLineHeight(3), 2.4);
});

test("normalizes dual, paged single and scrolled single modes", () => {
  assert.deepEqual(normalizeReaderMode({ singlePage: false, scrolled: true }), {
    singlePage: false,
    scrolled: false,
  });
  assert.deepEqual(getReaderOptions({ singlePage: false, scrolled: true }), {
    allowPopups: false,
  });
  assert.deepEqual(getReaderOptions({ singlePage: true, scrolled: false }), {
    allowPopups: false,
    spread: "none",
  });
  assert.deepEqual(getReaderOptions({ singlePage: true, scrolled: true }), {
    allowPopups: false,
    flow: "scrolled",
    manager: "continuous",
  });
});

test("prefers EPUB page-list progress and formats its label", () => {
  const progress = getReaderProgress(
    {
      start: {
        cfi: "epubcfi(1)",
        href: "chapter.xhtml",
        index: 1,
        percentage: 0.1,
        displayed: { page: 2, total: 5 },
      },
    },
    {
      book: {
        pageList: {
          pageFromCfi: () => 42,
          percentageFromCfi: () => 0.5,
          lastPage: 84,
        },
        spine: { items: [{}, {}] },
      },
    },
    "Chapter",
    () => "2026-06-12T12:00:00.000Z",
  );
  assert.deepEqual(progress, {
    percentage: 0.5,
    href: "chapter.xhtml",
    updated: "2026-06-12T12:00:00.000Z",
    page: 2,
    total: 5,
    chapterPage: { page: 2, total: 5 },
    bookPage: { page: 42, total: 84 },
    label: "页 42 / 84 全书 50%",
    chapterTitle: "Chapter",
  });
});

test("falls back from locations to spine progress", () => {
  const progress = getReaderProgress(
    { start: { cfi: "cfi", index: 2, percentage: 0, displayed: { page: 3, total: 4 } } },
    { book: { locations: { _locations: [] }, spine: { items: [{}, {}, {}, {}] } } },
    "",
    () => "now",
  );
  assert.equal(progress?.percentage, 0.625);
  assert.equal(progress?.label, "本章 3 / 4 全书 63%");
  assert.equal(formatReaderProgressLabel(null), "");
});
