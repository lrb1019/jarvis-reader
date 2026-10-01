import test from "node:test";
import assert from "node:assert/strict";
import { BookPathService, planBookRename, resolveBookPath, type BookPathState } from "../src/book-path-service.ts";
function fixture(): BookPathState {
  return {
    bookBookmarks: { "a.epub": [{ cfi: "cfi", title: "one", created: 1 }] },
    bookInitLocations: { "a.epub": "position", "other.epub": "other" },
    bookProgress: {}, readingStats: { "2026-10-01": { "a.epub": 123, "other.epub": 44 } },
    bookHighlights: { "a.epub": [{ id: "h", blockId: "b", bookPath: "a.epub", bookTitle: "A", chapterTitle: "C", cfiRange: "cfi", notePath: "notes/A.md", quote: "user quote", comment: "user note", created: "now" }] },
    wordAssets: {}, bookCoverCache: { "a.epub|10|20": { updated: "now", isCustom: true, vaultPath: "covers/custom.png" } },
  };
}
function host(state = fixture()) {
  let pending: string | null = null; let disk = structuredClone(state); let fail = false;
  return {
    state: () => state,
    persist: async () => { if (fail) { fail = false; throw new Error("save failed"); } disk = structuredClone(state); },
    readPending: async () => pending,
    writePending: async (content: string) => { pending = content; },
    clearPending: async () => { pending = null; },
    fail: () => { fail = true; }, disk: () => disk,
  };
}
test("EPUB rename preserves positions, bookmarks, seconds, source IDs and custom covers across reload", async () => {
  const h = host(); await new BookPathService(h).rename("a.epub", "books/B.epub", "notes/A.md");
  const state = h.disk();
  assert.equal(state.bookInitLocations["books/B.epub"], "position"); assert.equal(state.bookInitLocations["a.epub"], undefined);
  assert.equal(state.readingStats?.["2026-10-01"]["books/B.epub"], 123);
  assert.equal(state.readingStats?.["2026-10-01"]["other.epub"], 44);
  assert.equal(state.bookHighlights["books/B.epub"][0].bookPath, "books/B.epub");
  assert.equal(state.bookHighlights["books/B.epub"][0].blockId, "b");
  assert.equal(state.bookNotePaths?.["books/B.epub"], "notes/A.md");
  assert.equal(state.bookCoverCache["books/B.epub|10|20"].vaultPath, "covers/custom.png");
  assert.equal(resolveBookPath("a.epub", state.bookPathAliases), "books/B.epub");
  assert.equal(await h.readPending(), null);
});
test("rename failure rolls back records and retains a recoverable operation", async () => {
  const h = host(); const before = h.disk(); h.fail();
  await assert.rejects(new BookPathService(h).rename("a.epub", "b.epub"), /save failed/);
  assert.deepEqual(h.disk().bookInitLocations, before.bookInitLocations);
  assert.ok(await h.readPending());
  assert.equal(await new BookPathService(h).recover(), true);
  assert.equal(h.disk().bookInitLocations["b.epub"], "position");
});
test("partial saves resume idempotently after reload, preserving user Markdown outside the index", async () => {
  const h = host(); const plan = planBookRename(h.state(), "a.epub", "b.epub");
  await h.writePending(JSON.stringify(plan));
  const state = h.state(); state.bookInitLocations["b.epub"] = state.bookInitLocations["a.epub"]; delete state.bookInitLocations["a.epub"];
  // Sidecar metadata intentionally lacks quote/comment; Markdown remains authoritative.
  state.bookHighlights["a.epub"] = state.bookHighlights["a.epub"].map(({ quote, comment, ...metadata }) => metadata) as typeof state.bookHighlights[string];
  await new BookPathService(h).recover(); assert.equal(h.disk().bookInitLocations["b.epub"], "position");
  assert.equal(h.disk().bookHighlights["b.epub"][0].notePath, "notes/A.md");
});
test("collision, corrupt journal and stale recovery never overwrite current records", async () => {
  const h = host(); h.state().bookBookmarks["b.epub"] = [];
  await assert.rejects(new BookPathService(h).rename("a.epub", "b.epub"), /已有记录/);
  assert.equal(await h.readPending(), null);
  await h.writePending("broken"); await assert.rejects(new BookPathService(h).recover()); assert.equal(await h.readPending(), "broken");
  delete h.state().bookBookmarks["b.epub"];
  await h.writePending(JSON.stringify(planBookRename(h.state(), "a.epub", "b.epub")));
  h.state().bookInitLocations["a.epub"] = "user-edited";
  await assert.rejects(new BookPathService(h).recover(), /冲突/); assert.equal(h.state().bookInitLocations["a.epub"], "user-edited");
});
test("untracked books and repeated rename/back retain valid flattened aliases", async () => {
  const h = host(); await new BookPathService(h).rename("a.epub", "b.epub");
  await new BookPathService(h).rename("b.epub", "c.epub");
  assert.equal(resolveBookPath("a.epub", h.state().bookPathAliases), "c.epub");
  await new BookPathService(h).rename("c.epub", "a.epub");
  assert.equal(resolveBookPath("b.epub", h.state().bookPathAliases), "a.epub");
  assert.equal(resolveBookPath("a.epub", h.state().bookPathAliases), "a.epub");
  await new BookPathService(h).rename("untracked.epub", "new.epub");
  assert.equal(await new BookPathService(h).recover(), false);
});

test("word sources follow the book without changing definitions or other sources", async () => {
  const h = host();
  h.state().wordAssets.test = {
    lemma: "test", title: "Test", kind: "word", surfaceForms: ["tests"], translation: "meaning", display: "meaning", phonetic: "", partOfSpeech: "noun", example: "", created: "now", updated: "now",
    sources: ["a.epub", "other.epub"].map(bookPath => ({ bookPath, bookTitle: "A", chapterTitle: "C", cfiRange: "cfi", quote: "quote", created: "now" })),
  };
  await new BookPathService(h).rename("a.epub", "b.epub");
  const asset = h.disk().wordAssets.test;
  assert.equal(asset.translation, "meaning"); assert.deepEqual(asset.sources.map(s => s.bookPath), ["b.epub", "other.epub"]);
});
test("failed rollback and incomplete journal writes retain recovery evidence without losing identity", async () => {
  const h = host();
  const broken = { ...h, persist: async () => { throw new Error("disk full"); } };
  await assert.rejects(new BookPathService(broken).rename("a.epub", "b.epub"), /回滚保存失败/);
  assert.ok(await h.readPending()); assert.equal(h.state().bookInitLocations["a.epub"], "position");
  await new BookPathService(h).recover(); assert.equal(h.state().bookInitLocations["b.epub"], "position");
  const incomplete = host();
  await assert.rejects(new BookPathService({ ...incomplete, writePending: async text => incomplete.writePending(text.slice(0, 30)) }).rename("a.epub", "b.epub"), /校验失败/);
  assert.equal(incomplete.state().bookInitLocations["a.epub"], "position");
  await assert.rejects(new BookPathService(incomplete).recover());
});

test("moving a book note follows both associations and highlight locations without changing IDs, content, books or stats", async () => {
  const h = host(); h.state().bookNotePaths = { "a.epub": "notes/A.md" };
  const before = structuredClone(h.state());
  await new BookPathService(h).renameNote("notes/A.md", "Reading Notes/Renamed.md");
  const highlight = h.state().bookHighlights["a.epub"][0];
  assert.equal(h.state().bookNotePaths["a.epub"], "Reading Notes/Renamed.md");
  assert.equal(highlight.notePath, "Reading Notes/Renamed.md");
  assert.equal(highlight.quote, "user quote"); assert.equal(highlight.comment, "user note");
  assert.equal(highlight.id, "h"); assert.equal(highlight.blockId, "b");
  assert.deepEqual(h.state().bookBookmarks, before.bookBookmarks);
  assert.deepEqual(h.state().readingStats, before.readingStats);
  assert.deepEqual(h.state().bookCoverCache, before.bookCoverCache);
  assert.equal(await h.readPending(), null);
});
test("note path failure rolls back and recovers after reload; unrelated notes and delete do not reassign records", async () => {
  const h = host(); h.state().bookNotePaths = { "a.epub": "notes/A.md" };
  h.fail();
  await assert.rejects(new BookPathService(h).renameNote("notes/A.md", "Notes/B.md"), /save failed/);
  assert.equal(h.state().bookNotePaths["a.epub"], "notes/A.md");
  assert.equal(h.state().bookHighlights["a.epub"][0].notePath, "notes/A.md");
  assert.equal(h.state().bookHighlights["a.epub"][0].quote, "user quote");
  await new BookPathService(h).recover();
  assert.equal(h.disk().bookNotePaths?.["a.epub"], "Notes/B.md");
  const before = structuredClone(h.state());
  await new BookPathService(h).renameNote("Unrelated.md", "Other.md");
  assert.deepEqual(h.state(), before);
  await assert.rejects(new BookPathService(h).renameNote("Notes/B.md", "deleted"), /无效/);
});
test("note path recovery with stale edits refuses overwrite and retains its journal", async () => {
  const h = host(); h.state().bookNotePaths = { "a.epub": "notes/A.md" };
  h.fail(); await assert.rejects(new BookPathService(h).renameNote("notes/A.md", "Notes/B.md"));
  h.state().bookNotePaths["a.epub"] = "UserChoice.md";
  await assert.rejects(new BookPathService(h).recover(), /冲突/);
  assert.equal(h.state().bookNotePaths["a.epub"], "UserChoice.md");
  assert.ok(await h.readPending());
});
