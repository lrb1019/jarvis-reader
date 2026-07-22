import assert from "node:assert/strict";
import test from "node:test";
import { BookStateService, type BookStateHost } from "../src/book-state-service.ts";

function makeHost(save: () => Promise<void> = async () => {}): BookStateHost {
  return {
    settings: {
      bookBookmarks: {},
      bookInitLocations: {},
      bookProgress: {},
    },
    saveSettings: save,
  };
}

function progress(percentage: number, chapterTitle: string) {
  return {
    percentage,
    href: "chapter.xhtml",
    updated: "now",
    page: null,
    total: null,
    chapterPage: null,
    bookPage: null,
    label: `${percentage}%`,
    chapterTitle,
  };
}

test("adds a bookmark once and persists it", async () => {
  let saves = 0;
  const host = makeHost(async () => { saves++; });
  const service = new BookStateService(host);
  const bookmark = { cfi: "cfi-1", title: "第一章", created: 1 };
  assert.equal(await service.addBookmark("a.epub", bookmark), true);
  assert.equal(await service.addBookmark("a.epub", { ...bookmark, created: 2 }), false);
  assert.deepEqual(host.settings.bookBookmarks["a.epub"], [bookmark]);
  assert.equal(saves, 1);
});

test("removes only the selected bookmark", async () => {
  const host = makeHost();
  host.settings.bookBookmarks["a.epub"] = [
    { cfi: "same", title: "旧", created: 1 },
    { cfi: "same", title: "新", created: 2 },
  ];
  const service = new BookStateService(host);
  assert.equal(await service.removeBookmark("a.epub", { cfi: "same", created: 2 }), true);
  assert.deepEqual(host.settings.bookBookmarks["a.epub"], [{ cfi: "same", title: "旧", created: 1 }]);
});

test("failed bookmark persistence restores the previous state", async () => {
  const host = makeHost(async () => { throw new Error("disk full"); });
  const original = [{ cfi: "cfi-1", title: "第一章", created: 1 }];
  host.settings.bookBookmarks["a.epub"] = original;
  const service = new BookStateService(host);
  await assert.rejects(() => service.removeBookmark("a.epub", original[0]), /disk full/);
  assert.equal(host.settings.bookBookmarks["a.epub"], original);
});

test("book removal clears only transient reader state and retains other books", async () => {
  const host = makeHost();
  host.settings.bookBookmarks = { "a.epub": [{ cfi: "a", title: "A", created: 1 }], "b.epub": [] };
  host.settings.bookInitLocations = { "a.epub": "cfi-a", "b.epub": "cfi-b" };
  host.settings.bookProgress = {
    "a.epub": progress(10, "A"),
    "b.epub": progress(20, "B"),
  };
  await new BookStateService(host).clearRuntimeState("a.epub");
  assert.equal(host.settings.bookBookmarks["a.epub"], undefined);
  assert.equal(host.settings.bookInitLocations["a.epub"], undefined);
  assert.equal(host.settings.bookProgress["a.epub"], undefined);
  assert.equal(host.settings.bookInitLocations["b.epub"], "cfi-b");
});

test("failed runtime cleanup restores every map", async () => {
  const host = makeHost(async () => { throw new Error("write failed"); });
  host.settings.bookBookmarks = { "a.epub": [{ cfi: "a", title: "A", created: 1 }] };
  host.settings.bookInitLocations = { "a.epub": "cfi-a" };
  host.settings.bookProgress = { "a.epub": progress(10, "A") };
  const previous = { ...host.settings };
  await assert.rejects(() => new BookStateService(host).clearRuntimeState("a.epub"), /write failed/);
  assert.equal(host.settings.bookBookmarks, previous.bookBookmarks);
  assert.equal(host.settings.bookInitLocations, previous.bookInitLocations);
  assert.equal(host.settings.bookProgress, previous.bookProgress);
});
