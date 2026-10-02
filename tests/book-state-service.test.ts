import assert from "node:assert/strict";
import test from "node:test";
import { BookStateService, type BookStateHost } from "../src/book-state-service.ts";

import { SettingsSaveQueue } from "../src/settings-save-queue.ts";

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

test("reading location and progress save per book and reload without changing bookmarks", async () => {
  let saved = "";
  const host = makeHost(async () => { saved = JSON.stringify(host.settings); });
  host.settings.bookBookmarks = { "a.epub": [{ cfi: "mark", title: "A", created: 1 }] };
  host.settings.bookInitLocations["b.epub"] = "other";
  const service = new BookStateService(host);
  const current = progress(0.23, "A");
  await service.saveLocation("a.epub", "cfi-a");
  await service.saveProgress("a.epub", current);
  const reloaded = JSON.parse(saved);
  assert.equal(reloaded.bookInitLocations["a.epub"], "cfi-a");
  assert.equal(reloaded.bookInitLocations["b.epub"], "other");
  assert.deepEqual(reloaded.bookProgress["a.epub"], current);
  assert.deepEqual(reloaded.bookBookmarks, host.settings.bookBookmarks);
});

test("reading save failure stays visible and preserves latest in-memory reading state", async () => {
  const host = makeHost(async () => { throw new Error("write failed"); });
  const service = new BookStateService(host);
  await assert.rejects(service.saveLocation("a.epub", "latest"), /write failed/);
  const current = progress(0.12, "A");
  await assert.rejects(service.saveProgress("a.epub", current), /write failed/);
  assert.equal(host.settings.bookInitLocations["a.epub"], "latest");
  assert.equal(host.settings.bookProgress["a.epub"], current);
});

test("late failed location save does not roll back a newer reading position", async () => {
  let rejectFirst!: (error: Error) => void;
  let count = 0;
  const host = makeHost(async () => {
    if (++count === 1) await new Promise<void>((_resolve, reject) => { rejectFirst = reject; });
  });
  const service = new BookStateService(host);
  const first = service.saveLocation("a.epub", "old");
  const rejected = assert.rejects(first, /first failed/);
  await service.saveLocation("a.epub", "new");
  rejectFirst(new Error("first failed"));
  await rejected;
  assert.equal(host.settings.bookInitLocations["a.epub"], "new");
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

function controlledQueueHost() {
  let started!: () => void;
  let rejectFirst!: (error: Error) => void;
  let releaseFirst!: () => void;
  const firstStarted = new Promise<void>((resolve) => { started = resolve; });
  const firstGate = new Promise<void>((resolve, reject) => { releaseFirst = resolve; rejectFirst = reject; });
  const host = makeHost();
  const snapshots: BookStateHost["settings"][] = [];
  let persisted: BookStateHost["settings"] | null = null;
  const queue = new SettingsSaveQueue(() => ({ ...host.settings }), async (snapshot) => {
    const captured = structuredClone(snapshot);
    snapshots.push(captured);
    if (snapshots.length === 1) { started(); await firstGate; }
    persisted = captured;
  }, 0);
  host.saveSettings = () => queue.request();
  return { host, service: new BookStateService(host), firstStarted, rejectFirst, releaseFirst, snapshots,
    saved: () => { assert.ok(persisted); return persisted; } };
}

const oldBookmark = { cfi: "old", title: "Original", created: 1 };
const failedBookmark = { cfi: "failed", title: "Failed", created: 2 };
const newBookmark = { cfi: "new", title: "New", created: 3 };

const concurrentCases = [
  { name: "same-book add", first: (s: BookStateService) => s.addBookmark("a.epub", failedBookmark),
    next: (s: BookStateService) => s.addBookmark("a.epub", newBookmark), expected: { "a.epub": [oldBookmark, newBookmark] } },
  { name: "different-book add", first: (s: BookStateService) => s.addBookmark("a.epub", failedBookmark),
    next: (s: BookStateService) => s.addBookmark("b.epub", newBookmark), expected: { "a.epub": [oldBookmark], "b.epub": [newBookmark] } },
  { name: "remove followed by add", first: (s: BookStateService) => s.removeBookmark("a.epub", oldBookmark),
    next: (s: BookStateService) => s.addBookmark("a.epub", newBookmark), expected: { "a.epub": [oldBookmark, newBookmark] } },
  { name: "add followed by remove", first: (s: BookStateService) => s.addBookmark("a.epub", failedBookmark),
    next: (s: BookStateService) => s.removeBookmark("a.epub", oldBookmark), expected: {} },
  { name: "cleanup followed by another-book add", first: (s: BookStateService) => s.clearRuntimeState("a.epub"),
    next: (s: BookStateService) => s.addBookmark("b.epub", newBookmark), expected: { "a.epub": [oldBookmark], "b.epub": [newBookmark] } },
  { name: "add followed by cleanup", first: (s: BookStateService) => s.addBookmark("a.epub", failedBookmark),
    next: (s: BookStateService) => s.clearRuntimeState("a.epub"), expected: {} },
];

for (const scenario of concurrentCases) {
  test(`queued ${scenario.name} survives an earlier failed save and reloads consistently`, async () => {
    const h = controlledQueueHost();
    h.host.settings.bookBookmarks = { "a.epub": [oldBookmark] };
    h.host.settings.bookInitLocations = { "a.epub": "saved-location" };
    h.host.settings.bookProgress = { "a.epub": progress(0.2, "Saved") };
    const first = scenario.first(h.service);
    const failure = assert.rejects(first, /controlled failure/);
    await h.firstStarted;
    const next = scenario.next(h.service);
    h.rejectFirst(new Error("controlled failure"));
    await failure;
    await next;
    assert.deepEqual(h.host.settings.bookBookmarks, scenario.expected);
    assert.deepEqual(h.saved().bookBookmarks, scenario.expected);
    const reloaded = makeHost();
    reloaded.settings = structuredClone(h.saved());
    assert.deepEqual(reloaded.settings, h.host.settings);
    assert.equal(h.snapshots.length, 2);
    assert.ok(!Object.values(h.saved().bookBookmarks).flat().some((b) => b.cfi === "failed"));
  });
}

test("concurrent duplicate additions recheck after the preceding save", async () => {
  const h = controlledQueueHost();
  const first = h.service.addBookmark("a.epub", newBookmark);
  await h.firstStarted;
  const duplicate = h.service.addBookmark("a.epub", { ...newBookmark, created: 4 });
  h.releaseFirst();
  assert.deepEqual(await Promise.all([first, duplicate]), [true, false]);
  assert.equal(h.snapshots.length, 1);
  assert.deepEqual(h.saved().bookBookmarks, { "a.epub": [newBookmark] });
});

test("the same bookmark can be retried after a queued failed addition", async () => {
  const h = controlledQueueHost();
  const first = h.service.addBookmark("a.epub", newBookmark);
  const failure = assert.rejects(first, /controlled failure/);
  await h.firstStarted;
  const retry = h.service.addBookmark("a.epub", newBookmark);
  h.rejectFirst(new Error("controlled failure"));
  await failure;
  assert.equal(await retry, true);
  assert.deepEqual(h.host.settings.bookBookmarks, { "a.epub": [newBookmark] });
  assert.deepEqual(h.saved().bookBookmarks, h.host.settings.bookBookmarks);
});
