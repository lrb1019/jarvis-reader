import assert from "node:assert/strict";
import test from "node:test";
import {
  createConflictBackup,
  mergeConfirmedConflicts,
  type ConflictAdapter,
  type ConflictResolutionHost,
} from "../src/conflict-resolution-service.ts";
import type { ConflictFileSet } from "../src/conflict-resolution-core.ts";
import type { BookHighlightsMap, WordAssetMap } from "../src/types.ts";

class MemoryConflictAdapter implements ConflictAdapter {
  files = new Map<string, string>();
  folders = new Set<string>();
  trashed: string[] = [];

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

  async read(path: string): Promise<string> {
    const value = this.files.get(path);
    if (value === undefined) throw new Error(`Missing file: ${path}`);
    return value;
  }

  async write(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }

  async mkdir(path: string): Promise<void> {
    this.folders.add(path);
  }

  async trashSystem(path: string): Promise<boolean> {
    this.trashed.push(path);
    this.files.delete(path);
    return true;
  }
}

const files: ConflictFileSet = {
  wordAssets: [".obsidian/plugins/jarvis-reader/index/word-assets-conflict.json"],
  highlights: [],
  settings: [".obsidian/plugins/jarvis-reader/data-conflict.json"],
};

function createPlugin(adapter: MemoryConflictAdapter, failSettings = false): ConflictResolutionHost & { reasons: string[] } {
  const reasons: string[] = [];
  const settings: ConflictResolutionHost["settings"] = {
    wordAssets: {},
    bookHighlights: {},
    readingStats: { "2026-07-22": { "a.epub": 120 } },
    wordReviewStats: {},
    bookProgress: {},
  };
  return {
    app: { vault: { adapter } },
    settings,
    reasons,
    wordAssetSidecarUnavailable: false,
    highlightSidecarUnavailable: false,
    wordAssetService: {
      async replaceAll(assets: WordAssetMap, reason: string) {
        reasons.push(reason);
        settings.wordAssets = structuredClone(assets);
      },
    },
    highlightService: {
      async replaceAll(highlights: BookHighlightsMap, reason: string) {
        reasons.push(reason);
        settings.bookHighlights = structuredClone(highlights);
      },
    },
    async saveSettingsData() {
      if (failSettings) throw new Error("settings write failed");
    },
  };
}

function seedFiles(adapter: MemoryConflictAdapter): void {
  adapter.files.set(".obsidian/plugins/jarvis-reader/index/word-assets.json", JSON.stringify({ version: 2, wordAssets: {} }));
  adapter.files.set(".obsidian/plugins/jarvis-reader/data.json", JSON.stringify({ readingStats: {} }));
  adapter.files.set(files.wordAssets[0], JSON.stringify({
    version: 2,
    wordAssets: { habit: { lemma: "habit", updated: "2026-07-22", sources: [] } },
  }));
  adapter.files.set(files.settings[0], JSON.stringify({ readingStats: { "2026-07-22": { "a.epub": 100, "b.epub": 40 } } }));
}

test("conflict backup copies canonical files and every detected conflict", async () => {
  const adapter = new MemoryConflictAdapter();
  seedFiles(adapter);
  const root = await createConflictBackup(adapter, files);
  const backedUpSources = [...adapter.files.keys()].filter((path) => path.startsWith(root));
  assert.equal(backedUpSources.length, 4);
  assert.equal(adapter.trashed.length, 0);
  assert.equal(adapter.files.has(files.wordAssets[0]), true);
});

test("confirmed conflict merge backs up first and trashes copies only after successful commits", async () => {
  const adapter = new MemoryConflictAdapter();
  seedFiles(adapter);
  const plugin = createPlugin(adapter);
  const backupRoot = await mergeConfirmedConflicts(plugin, files);

  assert.equal(plugin.settings.wordAssets?.habit?.lemma, "habit");
  assert.deepEqual(plugin.settings.readingStats?.["2026-07-22"], { "a.epub": 120, "b.epub": 40 });
  assert.deepEqual(adapter.trashed.sort(), [files.settings[0], files.wordAssets[0]].sort());
  assert.equal([...adapter.files.keys()].some((path) => path.startsWith(backupRoot)), true);
});

test("failed conflict commits restore memory and keep conflict copies", async () => {
  const adapter = new MemoryConflictAdapter();
  seedFiles(adapter);
  const plugin = createPlugin(adapter, true);

  await assert.rejects(mergeConfirmedConflicts(plugin, files), /settings write failed|自动回滚不完整/);
  assert.deepEqual(plugin.settings.wordAssets, {});
  assert.deepEqual(plugin.settings.readingStats, { "2026-07-22": { "a.epub": 120 } });
  assert.equal(adapter.trashed.length, 0);
  assert.equal(adapter.files.has(files.wordAssets[0]), true);
  assert.equal(adapter.files.has(files.settings[0]), true);
});
