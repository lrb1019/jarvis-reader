import assert from "node:assert/strict";
import test from "node:test";
import { CoverCacheService, type CoverCacheAdapter } from "../src/cover-cache-service.ts";

class MemoryCoverCacheAdapter implements CoverCacheAdapter {
  files = new Map<string, string>();
  folders = new Set<string>();
  failWrites = false;

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
    if (this.failWrites) throw new Error("Simulated write failure");
    this.files.set(path, content);
  }

  async mkdir(path: string): Promise<void> {
    this.folders.add(path);
  }

  async remove(path: string): Promise<void> {
    this.files.delete(path);
  }
}

const firstKey = "Books/Atomic.epub|100|200";
const secondKey = "Books/Deep Work.epub|300|400";
const firstEntry = { dataUrl: "data:image/jpeg;base64,AAA", updated: "2026-07-22T00:00:00.000Z", creator: "James" };
const secondEntry = { dataUrl: "data:image/png;base64,BBB", updated: "2026-07-22T01:00:00.000Z" };

test("cover cache saves and reloads each book independently", async () => {
  const adapter = new MemoryCoverCacheAdapter();
  const service = new CoverCacheService(adapter);
  await service.load();
  await service.save(firstKey, firstEntry);
  await service.save(secondKey, secondEntry);

  const reloaded = new CoverCacheService(adapter);
  assert.deepEqual(await reloaded.load(), { [firstKey]: firstEntry, [secondKey]: secondEntry });
  assert.equal([...adapter.files.keys()].filter((path) => path.includes("/cache/covers/")).length, 2);
});

test("legacy migration backs up data.json before writing independent entries", async () => {
  const adapter = new MemoryCoverCacheAdapter();
  adapter.files.set(".obsidian/plugins/jarvis-reader/data.json", JSON.stringify({ bookCoverCache: { [firstKey]: firstEntry } }));
  const service = new CoverCacheService(adapter);
  await service.load();
  const backupRoot = await service.migrateLegacy({ [firstKey]: firstEntry });

  assert.ok(backupRoot);
  assert.equal(adapter.files.has(`${backupRoot}/data.json`), true);
  assert.deepEqual(service.snapshot(), { [firstKey]: firstEntry });
});

test("failed legacy migration leaves the original data.json untouched", async () => {
  const adapter = new MemoryCoverCacheAdapter();
  const original = JSON.stringify({ bookCoverCache: { [firstKey]: firstEntry } });
  adapter.files.set(".obsidian/plugins/jarvis-reader/data.json", original);
  const service = new CoverCacheService(adapter);
  await service.load();
  adapter.failWrites = true;

  await assert.rejects(service.migrateLegacy({ [firstKey]: firstEntry }), /Simulated write failure/);
  assert.equal(adapter.files.get(".obsidian/plugins/jarvis-reader/data.json"), original);
});

test("cover cache pruning removes only entries for books no longer present", async () => {
  const adapter = new MemoryCoverCacheAdapter();
  const service = new CoverCacheService(adapter);
  await service.load();
  await service.save(firstKey, firstEntry);
  await service.save(secondKey, secondEntry);

  assert.equal(await service.prune([secondKey]), 1);
  assert.deepEqual(service.snapshot(), { [secondKey]: secondEntry });
  const reloaded = new CoverCacheService(adapter);
  assert.deepEqual(await reloaded.load(), { [secondKey]: secondEntry });
});
