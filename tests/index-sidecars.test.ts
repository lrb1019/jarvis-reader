import assert from "node:assert/strict";
import test from "node:test";

import {
  readHighlightSidecar,
  readWordAssetSidecar,
  writeHighlightSidecar,
  writeWordAssetSidecar,
} from "../src/index-sidecars.ts";
import type { PersistedBookHighlightsMap, WordAssetMap } from "../src/types.ts";

class MemorySidecarAdapter {
  files = new Map<string, string>();
  folders = new Set<string>();
  failWrites = false;
  partialWrites = false;
  failRenames = false;
  failRenameAt = 0;
  renameCalls = 0;
  rejectOverwrite = true;

  async exists(path: string): Promise<boolean> {
    return this.files.has(path) || this.folders.has(path);
  }

  async read(path: string): Promise<string> {
    const value = this.files.get(path);
    if (value === undefined) throw new Error(`Missing memory file: ${path}`);
    return value;
  }

  async write(path: string, content: string): Promise<void> {
    if (this.failWrites) throw new Error("Simulated write failure");
    this.files.set(path, this.partialWrites ? content.slice(0, Math.max(1, Math.floor(content.length / 2))) : content);
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    this.renameCalls += 1;
    if (this.failRenames || this.renameCalls === this.failRenameAt) throw new Error("Simulated rename failure");
    const content = this.files.get(oldPath);
    if (content === undefined) throw new Error(`Missing memory file: ${oldPath}`);
    if (this.rejectOverwrite && this.files.has(newPath)) throw new Error(`Destination already exists: ${newPath}`);
    this.files.set(newPath, content);
    this.files.delete(oldPath);
  }

  async remove(path: string): Promise<void> {
    this.files.delete(path);
  }

  async mkdir(path: string): Promise<void> {
    this.folders.add(path);
  }
}

const wordAssetPath = "index/word-assets.json";
const highlightPath = "index/highlights.json";

const wordAssets: WordAssetMap = {
  fracture: {
    lemma: "fracture",
    title: "Fracture",
    kind: "word",
    isWord: true,
    surfaceForms: ["fracture"],
    translation: "破裂",
    display: "**中文释义**：破裂",
    phonetic: "",
    partOfSpeech: "",
    example: "",
    mastered: false,
    sources: [{
      bookPath: "Books/Atomic.epub",
      bookTitle: "Atomic",
      chapterTitle: "Chapter",
      cfiRange: "cfi-1",
      quote: "fracture",
      created: "2026-07-10T00:00:00.000Z",
    }],
    created: "2026-07-10T00:00:00.000Z",
    updated: "2026-07-10T00:00:00.000Z",
  },
};

const bookHighlights: PersistedBookHighlightsMap = {
  "Books/Atomic.epub": [{
    id: "highlight-1",
      bookPath: "Books/Atomic.epub",
      bookTitle: "Atomic",
      chapterTitle: "Chapter",
      cfiRange: "cfi-1",
      notePath: "Books/Atomic.md",
    blockId: "highlight-1",
    created: "2026-07-10T00:00:00.000Z",
    updated: "",
  }],
};

test("missing sidecars initialize as empty and reload without legacy data", async () => {
  const adapter = new MemorySidecarAdapter();

  assert.deepEqual(await readWordAssetSidecar(adapter, wordAssetPath), { status: "missing" });
  assert.deepEqual(await readHighlightSidecar(adapter, highlightPath), { status: "missing" });

  await writeWordAssetSidecar(adapter, wordAssetPath, {}, "2026-07-10T00:00:00.000Z");
  await writeHighlightSidecar(adapter, highlightPath, {}, "2026-07-10T00:00:00.000Z");

  assert.deepEqual(await readWordAssetSidecar(adapter, wordAssetPath), { status: "ready", value: {} });
  assert.deepEqual(await readHighlightSidecar(adapter, highlightPath), { status: "ready", value: {} });
});

test("invalid sidecars are rejected without modifying their original content", async () => {
  const adapter = new MemorySidecarAdapter();
  const invalidWordContent = "{not valid json";
  const invalidHighlightContent = JSON.stringify({ version: 1, bookHighlights: { book: [{}] } });
  adapter.files.set(wordAssetPath, invalidWordContent);
  adapter.files.set(highlightPath, invalidHighlightContent);

  assert.deepEqual(await readWordAssetSidecar(adapter, wordAssetPath), { status: "invalid" });
  assert.deepEqual(await readHighlightSidecar(adapter, highlightPath), { status: "invalid" });
  assert.equal(adapter.files.get(wordAssetPath), invalidWordContent);
  assert.equal(adapter.files.get(highlightPath), invalidHighlightContent);
});

test("highlight sidecars reload index metadata without Markdown content copies", async () => {
  const adapter = new MemorySidecarAdapter();
  const indexOnlyHighlights = {
    "Books/Atomic.epub": [{
      id: "highlight-1",
      bookPath: "Books/Atomic.epub",
      bookTitle: "Atomic",
      chapterTitle: "Chapter",
      cfiRange: "cfi-1",
      notePath: "Books/Atomic.md",
      blockId: "highlight-1",
      created: "2026-07-10T00:00:00.000Z",
      updated: "",
      markColor: "green",
    }],
  } satisfies PersistedBookHighlightsMap;

  await writeHighlightSidecar(adapter, highlightPath, indexOnlyHighlights, "2026-07-10T00:00:00.000Z");
  assert.deepEqual(await readHighlightSidecar(adapter, highlightPath), { status: "ready", value: indexOnlyHighlights });
});

test("failed writes keep the last valid sidecar unchanged", async () => {
  const adapter = new MemorySidecarAdapter();
  await writeWordAssetSidecar(adapter, wordAssetPath, wordAssets, "2026-07-10T00:00:00.000Z");
  await writeHighlightSidecar(adapter, highlightPath, bookHighlights, "2026-07-10T00:00:00.000Z");
  const previousWordContent = adapter.files.get(wordAssetPath);
  const previousHighlightContent = adapter.files.get(highlightPath);
  adapter.failWrites = true;

  await assert.rejects(writeWordAssetSidecar(adapter, wordAssetPath, {}, "2026-07-10T01:00:00.000Z"));
  await assert.rejects(writeHighlightSidecar(adapter, highlightPath, {}, "2026-07-10T01:00:00.000Z"));
  assert.equal(adapter.files.get(wordAssetPath), previousWordContent);
  assert.equal(adapter.files.get(highlightPath), previousHighlightContent);
  assert.deepEqual(await readWordAssetSidecar(adapter, wordAssetPath), { status: "ready", value: wordAssets });
  assert.deepEqual(await readHighlightSidecar(adapter, highlightPath), { status: "ready", value: bookHighlights });
});

test("partial temporary writes fail validation without replacing the last valid sidecar", async () => {
  const adapter = new MemorySidecarAdapter();
  await writeWordAssetSidecar(adapter, wordAssetPath, wordAssets, "2026-07-10T00:00:00.000Z");
  const previous = adapter.files.get(wordAssetPath);
  adapter.partialWrites = true;

  await assert.rejects(writeWordAssetSidecar(adapter, wordAssetPath, {}, "2026-07-10T01:00:00.000Z"));
  assert.equal(adapter.files.get(wordAssetPath), previous);
  assert.equal(adapter.files.has(`${wordAssetPath}.tmp`), false);
});

test("failed atomic replacement keeps the last valid sidecar and removes its temporary file", async () => {
  const adapter = new MemorySidecarAdapter();
  await writeHighlightSidecar(adapter, highlightPath, bookHighlights, "2026-07-10T00:00:00.000Z");
  const previous = adapter.files.get(highlightPath);
  adapter.failRenames = true;

  await assert.rejects(writeHighlightSidecar(adapter, highlightPath, {}, "2026-07-10T01:00:00.000Z"), /rename failure/);
  assert.equal(adapter.files.get(highlightPath), previous);
  assert.equal(adapter.files.has(`${highlightPath}.tmp`), false);
  assert.equal(adapter.files.has(`${highlightPath}.bak`), false);
});

test("replacement works when the adapter rejects renaming over an existing file", async () => {
  const adapter = new MemorySidecarAdapter();
  await writeHighlightSidecar(adapter, highlightPath, bookHighlights, "2026-07-10T00:00:00.000Z");
  await writeHighlightSidecar(adapter, highlightPath, {}, "2026-07-10T01:00:00.000Z");
  assert.deepEqual(await readHighlightSidecar(adapter, highlightPath), { status: "ready", value: {} });
  assert.equal(adapter.files.has(`${highlightPath}.bak`), false);
});

test("failure after moving the original restores the last valid sidecar", async () => {
  const adapter = new MemorySidecarAdapter();
  await writeHighlightSidecar(adapter, highlightPath, bookHighlights, "2026-07-10T00:00:00.000Z");
  const previous = adapter.files.get(highlightPath);
  adapter.failRenameAt = adapter.renameCalls + 2;
  await assert.rejects(writeHighlightSidecar(adapter, highlightPath, {}, "2026-07-10T01:00:00.000Z"), /rename failure/);
  assert.equal(adapter.files.get(highlightPath), previous);
  assert.equal(adapter.files.has(`${highlightPath}.tmp`), false);
  assert.equal(adapter.files.has(`${highlightPath}.bak`), false);
});

test("deleting all sidecar records persists an empty state after reload", async () => {
  const adapter = new MemorySidecarAdapter();
  await writeWordAssetSidecar(adapter, wordAssetPath, wordAssets, "2026-07-10T00:00:00.000Z");
  await writeHighlightSidecar(adapter, highlightPath, bookHighlights, "2026-07-10T00:00:00.000Z");

  await writeWordAssetSidecar(adapter, wordAssetPath, {}, "2026-07-10T01:00:00.000Z");
  await writeHighlightSidecar(adapter, highlightPath, {}, "2026-07-10T01:00:00.000Z");

  assert.deepEqual(await readWordAssetSidecar(adapter, wordAssetPath), { status: "ready", value: {} });
  assert.deepEqual(await readHighlightSidecar(adapter, highlightPath), { status: "ready", value: {} });
});
