import assert from "node:assert/strict";
import test from "node:test";
import {
  HighlightTransactionService,
  type HighlightTransactionAdapter,
  type HighlightTransactionHost,
} from "../src/highlight-transaction-service.ts";
import type { BookHighlight } from "../src/types.ts";

class MemoryTransactionAdapter implements HighlightTransactionAdapter {
  files = new Map<string, string>();
  folders = new Set<string>();
  failRemoveOnce = false;

  async exists(path: string): Promise<boolean> {
    return this.files.has(path) || this.folders.has(path);
  }

  async list(path: string): Promise<{ files: string[]; folders: string[] }> {
    const prefix = `${path}/`;
    return {
      files: [...this.files.keys()].filter((item) => item.startsWith(prefix)),
      folders: [...this.folders].filter((item) => item.startsWith(prefix)),
    };
  }

  async write(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }

  async read(path: string): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) throw new Error(`Missing file: ${path}`);
    return content;
  }

  async mkdir(path: string): Promise<void> {
    this.folders.add(path);
  }

  async remove(path: string): Promise<void> {
    if (this.failRemoveOnce) {
      this.failRemoveOnce = false;
      throw new Error("Simulated remove failure");
    }
    this.files.delete(path);
  }
}

const previousHighlight: BookHighlight = {
  id: "h1",
  blockId: "h1",
  bookPath: "Books/a.epub",
  bookTitle: "A",
  chapterTitle: "One",
  cfiRange: "cfi-1",
  quote: "before",
  comment: "",
  notePath: "Notes/a.md",
  created: "2026-07-22T00:00:00.000Z",
  updated: "2026-07-22T00:00:00.000Z",
};

const nextHighlight: BookHighlight = {
  ...previousHighlight,
  comment: "after",
  updated: "2026-07-22T01:00:00.000Z",
};

function createHost(adapter: MemoryTransactionAdapter) {
  let note = "before markdown";
  let highlights = [previousHighlight];
  let failIndex = false;
  let failNoteWrite = false;
  const host: HighlightTransactionHost = {
    adapter,
    readNote: async () => note,
    writeNote: async (_path, content) => {
      if (failNoteWrite) throw new Error("Simulated note rollback failure");
      note = content;
    },
    getBookHighlights: () => highlights,
    replaceBookHighlights: async (_bookPath, next) => {
      if (failIndex) throw new Error("Simulated index failure");
      highlights = structuredClone(next);
    },
  };
  return {
    host,
    get note() { return note; },
    set note(value: string) { note = value; },
    get highlights() { return highlights; },
    set failIndex(value: boolean) { failIndex = value; },
    set failNoteWrite(value: boolean) { failNoteWrite = value; },
  };
}

function pendingFiles(adapter: MemoryTransactionAdapter): string[] {
  return [...adapter.files.keys()].filter((path) => path.includes("/pending/highlights/"));
}

test("highlight transaction commits Markdown and index before clearing its recovery record", async () => {
  const adapter = new MemoryTransactionAdapter();
  const state = createHost(adapter);
  const service = new HighlightTransactionService(state.host);

  await service.execute({
    bookPath: previousHighlight.bookPath,
    notePath: previousHighlight.notePath,
    reason: "update-highlight",
    previousHighlights: [previousHighlight],
    nextHighlights: [nextHighlight],
    applyMarkdown: async () => { state.note = "after markdown"; },
  });

  assert.equal(state.note, "after markdown");
  assert.equal(state.highlights[0].updated, nextHighlight.updated);
  assert.equal(pendingFiles(adapter).length, 0);
});

test("index failure restores the previous Markdown and removes the resolved recovery record", async () => {
  const adapter = new MemoryTransactionAdapter();
  const state = createHost(adapter);
  state.failIndex = true;
  const service = new HighlightTransactionService(state.host);

  await assert.rejects(service.execute({
    bookPath: previousHighlight.bookPath,
    notePath: previousHighlight.notePath,
    reason: "update-highlight",
    previousHighlights: [previousHighlight],
    nextHighlights: [nextHighlight],
    applyMarkdown: async () => { state.note = "after markdown"; },
  }), /Simulated index failure/);

  assert.equal(state.note, "before markdown");
  assert.equal(state.highlights[0].updated, previousHighlight.updated);
  assert.equal(pendingFiles(adapter).length, 0);
});

test("startup recovery rolls back Markdown left by an interrupted transaction", async () => {
  const adapter = new MemoryTransactionAdapter();
  const state = createHost(adapter);
  state.failIndex = true;
  state.failNoteWrite = true;
  const service = new HighlightTransactionService(state.host);

  await assert.rejects(service.execute({
    bookPath: previousHighlight.bookPath,
    notePath: previousHighlight.notePath,
    reason: "update-highlight",
    previousHighlights: [previousHighlight],
    nextHighlights: [nextHighlight],
    applyMarkdown: async () => { state.note = "after markdown"; },
  }), /恢复记录已保留/);
  assert.equal(pendingFiles(adapter).length, 1);

  state.failIndex = false;
  state.failNoteWrite = false;
  const recovery = await service.recoverPending();
  assert.deepEqual(recovery, { finalized: 0, rolledBack: 1, errors: [] });
  assert.equal(state.note, "before markdown");
  assert.equal(pendingFiles(adapter).length, 0);
});

test("startup recovery finalizes a committed transaction whose marker cleanup was interrupted", async () => {
  const adapter = new MemoryTransactionAdapter();
  const state = createHost(adapter);
  adapter.failRemoveOnce = true;
  const service = new HighlightTransactionService(state.host);

  await service.execute({
    bookPath: previousHighlight.bookPath,
    notePath: previousHighlight.notePath,
    reason: "update-highlight",
    previousHighlights: [previousHighlight],
    nextHighlights: [nextHighlight],
    applyMarkdown: async () => { state.note = "after markdown"; },
  });
  assert.equal(pendingFiles(adapter).length, 1);

  const recovery = await service.recoverPending();
  assert.deepEqual(recovery, { finalized: 1, rolledBack: 0, errors: [] });
  assert.equal(state.note, "after markdown");
  assert.equal(pendingFiles(adapter).length, 0);
});
