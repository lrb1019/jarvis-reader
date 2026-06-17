import assert from "node:assert/strict";
import test from "node:test";

import {
  clampProgressValue,
  findChapterTitle,
  formatReaderProgressLabel,
  getBookshelfProgressLabel,
  getPageListProgress,
  getReaderProgress,
  normalizeEpubHref,
} from "../src/progress.ts";

test("normalizes EPUB hrefs before TOC matching", () => {
  assert.equal(normalizeEpubHref("chapter.xhtml#frag?ignored"), "chapter.xhtml");
  assert.equal(normalizeEpubHref("chapter.xhtml?x=1#frag"), "chapter.xhtml");
});

test("finds nested chapter titles by href", () => {
  const toc = [
    { href: "cover.xhtml", label: "Cover", subitems: [] },
    {
      href: "part.xhtml",
      label: "Part",
      subitems: [{ href: "chapter-1.xhtml#start", label: "Chapter 1", subitems: [] }],
    },
  ];

  assert.equal(findChapterTitle(toc, "OPS/chapter-1.xhtml#p2"), "Chapter 1");
});

test("clamps progress values", () => {
  assert.equal(clampProgressValue(-0.2), 0);
  assert.equal(clampProgressValue(1.2), 1);
  assert.equal(clampProgressValue(Number.NaN), null);
  assert.equal(clampProgressValue("0.5"), null);
});

test("uses page list progress when available", () => {
  const relocated = { start: { cfi: "cfi-12" } };
  const rendition = {
    book: {
      pageList: {
        lastPage: 300,
        pageFromCfi: (cfi: string) => cfi === "cfi-12" ? 120 : null,
        percentageFromCfi: () => 0.4,
      },
    },
  };

  assert.deepEqual(getPageListProgress(relocated, rendition), {
    page: 120,
    total: 300,
    percentage: 0.4,
  });
});

test("formats reader progress labels by available page source", () => {
  assert.equal(formatReaderProgressLabel({ percentage: 0.41, bookPage: { page: 123, total: 300 } }), "页 123 / 300 全书 41%");
  assert.equal(formatReaderProgressLabel({ percentage: 0.41, chapterPage: { page: 22, total: 25 } }), "本章 22 / 25 全书 41%");
  assert.equal(formatReaderProgressLabel({ percentage: 0.41 }), "全书 41%");
});

test("falls back to spine progress when no page list or locations exist", () => {
  const progress = getReaderProgress(
    {
      start: {
        href: "chapter.xhtml",
        index: 2,
        displayed: { page: 5, total: 10 },
      },
    },
    { book: { spine: { items: [{}, {}, {}, {}] } } },
  );

  assert.equal(progress?.percentage, 0.6);
  assert.equal(progress?.label, "本章 5 / 10 全书 60%");
});

test("formats bookshelf progress with optional chapter title", () => {
  assert.equal(getBookshelfProgressLabel(null), "0%");
  assert.equal(getBookshelfProgressLabel({ percentage: 0.25, chapterTitle: "" } as any), "25%");
  assert.equal(getBookshelfProgressLabel({ percentage: 0.25, chapterTitle: "Intro" } as any), "Intro 25%");
});
