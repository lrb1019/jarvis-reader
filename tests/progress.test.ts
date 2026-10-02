import assert from "node:assert/strict";
import test from "node:test";

import {
  ensureReaderLocations,
  getReaderProgressLabel,
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

test("same reading CFI can switch from spine fallback to generated location percentage", () => {
  const relocated = { start: { cfi: "same-cfi", href: "chapter.xhtml", index: 10, displayed: { page: 1, total: 4 } } };
  const rendition = { book: {
    spine: { items: Array.from({ length: 44 }, () => ({})) },
    locations: { _locations: [] as string[], percentageFromCfi: () => 0.12 }
  } };
  assert.equal(Math.round(getReaderProgress(relocated, rendition)!.percentage * 100), 23);
  rendition.book.locations._locations.push("same-cfi");
  assert.equal(Math.round(getReaderProgress(relocated, rendition)!.percentage * 100), 12);
  assert.equal(relocated.start.cfi, "same-cfi");
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

function locationFixture(generate: () => Promise<unknown>) {
  const current = { start: { cfi: "same-cfi", index: 10, href: "chapter.xhtml", percentage: 0, displayed: { page: 1, total: 4 } } };
  const rendition = { book: { ready: Promise.resolve(),
    spine: { items: Array.from({ length: 44 }, () => ({})) },
    locations: { _locations: [] as string[], generate, percentageFromCfi: () => 0.12 } },
    currentLocation: () => current };
  return { current, rendition };
}
const drainProgressPromises = () => new Promise<void>(resolve => setImmediate(resolve));

test("pending location generation shows chapter pages and does not produce a persistable estimate", async () => {
  let complete!: () => void;
  const f = locationFixture(() => new Promise<void>(resolve => { complete = resolve; }));
  const saved: number[] = [];
  ensureReaderLocations(f.rendition, current => { const p = getReaderProgress(current, f.rendition); if (p) saved.push(p.percentage); });
  assert.equal(getReaderProgress(f.current, f.rendition), null);
  assert.equal(getReaderProgressLabel(f.current, f.rendition), "本章 1 / 4");
  await drainProgressPromises();
  f.rendition.book.locations._locations.push("same-cfi"); complete(); await drainProgressPromises();
  assert.deepEqual(saved, [0.12]);
  assert.equal(getReaderProgressLabel(f.current, f.rendition), "本章 1 / 4 全书 12%");
});

test("generation failure immediately refreshes the fallback and is not retried on the same rendition", async () => {
  let calls = 0, updates = 0;
  const f = locationFixture(async () => { calls++; throw new Error("synthetic generation failure"); });
  ensureReaderLocations(f.rendition, current => { updates++; assert.equal(Math.round(getReaderProgress(current, f.rendition)!.percentage * 100), 23); });
  await drainProgressPromises();
  assert.equal(updates, 1);
  assert.equal(getReaderProgressLabel(f.current, f.rendition), "本章 1 / 4 全书 23%");
  ensureReaderLocations(f.rendition); await drainProgressPromises(); assert.equal(calls, 1);
});

test("an empty generation result also releases the fallback without another relocation event", async () => {
  const f = locationFixture(async () => {}); let updates = 0;
  ensureReaderLocations(f.rendition, () => { updates++; }); await drainProgressPromises();
  assert.equal(updates, 1); assert.equal(Math.round(getReaderProgress(f.current, f.rendition)!.percentage * 100), 23);
});

test("late generation completion cannot refresh a retired reader", async () => {
  let complete!: () => void, active = true, updates = 0;
  const f = locationFixture(() => new Promise<void>(resolve => { complete = resolve; }));
  ensureReaderLocations(f.rendition, () => { updates++; }, () => active);
  await drainProgressPromises(); active = false; complete(); await drainProgressPromises();
  assert.equal(updates, 0);
});

test("ready locations at zero remain zero rather than switching to a spine estimate", () => {
  const f = locationFixture(async () => {});
  f.rendition.book.locations._locations.push("start");
  f.rendition.book.locations.percentageFromCfi = () => 0;
  assert.equal(getReaderProgress(f.current, f.rendition)!.percentage, 0);
});

test("accurate page-list zero is usable while locations are generating", async () => {
  let complete!: () => void;
  const f = locationFixture(() => new Promise<void>(resolve => { complete = resolve; }));
  const rendition = { ...f.rendition, book: { ...f.rendition.book, pageList: {
    pageFromCfi: () => 1, lastPage: 100, percentageFromCfi: () => 0 } } };
  ensureReaderLocations(rendition); await drainProgressPromises();
  assert.equal(getReaderProgress(f.current, rendition)!.percentage, 0);
  complete(); await drainProgressPromises();
});

test("generation updates the current position rather than its starting position", async () => {
  let complete!: () => void;
  const f = locationFixture(() => new Promise<void>(resolve => { complete = resolve; }));
  let observed = "";
  ensureReaderLocations(f.rendition, current => { observed = current.start.cfi; });
  await drainProgressPromises(); f.current.start.cfi = "next-cfi";
  complete(); await drainProgressPromises(); assert.equal(observed, "next-cfi");
});


test("partially filled locations are not treated as accurate while generation is pending", async () => {
  let complete!: () => void;
  const f = locationFixture(() => new Promise<void>(resolve => { complete = resolve; }));
  ensureReaderLocations(f.rendition); await drainProgressPromises();
  f.rendition.book.locations._locations.push("partial");
  assert.equal(getReaderProgress(f.current, f.rendition), null);
  complete(); await drainProgressPromises();
  assert.equal(getReaderProgress(f.current, f.rendition)!.percentage, 0.12);
});

test("failed generation does not use its partial location table", async () => {
  const f = locationFixture(async () => {
    f.rendition.book.locations._locations.push("partial");
    throw new Error("synthetic partial generation failure");
  });
  f.rendition.book.locations.percentageFromCfi = () => 1;
  f.current.start.percentage = 1;
  ensureReaderLocations(f.rendition); await drainProgressPromises();
  assert.equal(Math.round(getReaderProgress(f.current, f.rendition)!.percentage * 100), 23);
});
