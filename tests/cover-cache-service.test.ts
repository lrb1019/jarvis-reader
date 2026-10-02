import assert from "node:assert/strict";
import test from "node:test";
import { CoverCacheService, saveCustomBookCover, type CustomCoverStorage, type CoverCacheAdapter } from "../src/cover-cache-service.ts";

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

function customCoverFixture() {
  const images = new Map<string, ArrayBuffer>();
  const folders = new Set<string>();
  const storage: CustomCoverStorage = {
    async stat(path) { return images.has(path) ? { type: "file" } : folders.has(path) ? { type: "folder" } : null; },
    async mkdir(path) { folders.add(path); },
    async writeBinary(path, data) { images.set(path, data); return path; }
  };
  return { images, folders, storage };
}

test("custom cover create and replace preserve naming, metadata and reload", async () => {
  const fixture = customCoverFixture();
  const adapter = new MemoryCoverCacheAdapter();
  const service = new CoverCacheService(adapter);
  const book = { path: "Books/A.epub", basename: "A:B", stat: { mtime: 1, size: 2 } };
  const key = "Books/A.epub|1|2";
  const cache = { [key]: { creator: "Author", dataUrl: "old", updated: "old" } };
  const first = new Uint8Array([1, 2]).buffer;
  const second = new Uint8Array([3, 4]).buffer;
  const persist = (key: string, entry: Parameters<CoverCacheService["save"]>[1]) => service.save(key, entry);
  await saveCustomBookCover(fixture.storage, book, "Books/Cover", first, cache, persist);
  await saveCustomBookCover(fixture.storage, book, "Books/Cover", second, service.snapshot(), persist);
  assert.equal(fixture.images.size, 1);
  assert.equal(fixture.images.get("Books/Cover/cover_A_B.jpg"), second);
  assert.deepEqual([...fixture.folders], ["Books", "Books/Cover"]);
  const entry = (await new CoverCacheService(adapter).load())[key]!;
  assert.equal(entry.creator, "Author");
  assert.equal(entry.dataUrl, "old");
  assert.equal(entry.vaultPath, "Books/Cover/cover_A_B.jpg");
  assert.equal(entry.isCustom, true);
  assert.ok(Number.isFinite(Date.parse(entry.updated)));
  assert.equal(cache[key].updated, "old");
});

test("custom cover accepts vault root and empty book stat", async () => {
  const fixture = customCoverFixture();
  let savedKey = "";
  await saveCustomBookCover(fixture.storage, { path: "A.epub", basename: "A" }, "", new ArrayBuffer(1), {}, async key => { savedKey = key; });
  assert.equal(savedKey, "A.epub|0|0");
  assert.ok(fixture.images.has("cover_A.jpg"));
  assert.equal(fixture.folders.size, 0);
});

test("custom cover caches the actual path returned by storage", async () => {
  const fixture = customCoverFixture();
  fixture.storage.writeBinary = async () => "Resolved/cover_A.jpg";
  let savedPath = "";
  await saveCustomBookCover(fixture.storage, { path: "A.epub", basename: "A" }, "Cover", new ArrayBuffer(1), {}, async (_key, entry) => { savedPath = entry.vaultPath!; });
  assert.equal(savedPath, "Resolved/cover_A.jpg");
});

test("custom cover directory collision stops image and cache writes", async () => {
  const fixture = customCoverFixture();
  fixture.images.set("Cover", new ArrayBuffer(1));
  let committed = false;
  await assert.rejects(saveCustomBookCover(fixture.storage, { path: "A.epub", basename: "A" }, "Cover", new ArrayBuffer(2), {}, async () => { committed = true; }), /路径已被文件占用/);
  assert.equal(fixture.images.size, 1);
  assert.equal(committed, false);
});

test("custom cover image write failure does not register cache", async () => {
  const fixture = customCoverFixture();
  fixture.storage.writeBinary = async () => { throw new Error("image failure"); };
  let committed = false;
  await assert.rejects(saveCustomBookCover(fixture.storage, { path: "A.epub", basename: "A" }, "Cover", new ArrayBuffer(1), {}, async () => { committed = true; }), /image failure/);
  assert.equal(committed, false);
});

test("custom cover cache failure remains visible and retains image without overwriting cache", async () => {
  const fixture = customCoverFixture();
  const adapter = new MemoryCoverCacheAdapter();
  const service = new CoverCacheService(adapter);
  await service.save(firstKey, firstEntry);
  const before = service.snapshot();
  adapter.failWrites = true;
  const path = "Cover/cover_Atomic.jpg";
  fixture.images.set(path, new ArrayBuffer(2));
  const replacement = new ArrayBuffer(1);
  await assert.rejects(saveCustomBookCover(fixture.storage, { path: "Books/Atomic.epub", basename: "Atomic", stat: { mtime: 100, size: 200 } }, "Cover", replacement, before, (key, entry) => service.save(key, entry)), error => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /封面图片已写入 Cover\/cover_Atomic.jpg，但缓存登记失败/);
    assert.ok(error.cause instanceof Error);
    assert.match(error.cause.message, /Simulated write failure/);
    return true;
  });
  assert.equal(fixture.images.get(path), replacement);
  assert.deepEqual(service.snapshot(), before);
  assert.deepEqual(await new CoverCacheService(adapter).load(), before);
});

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

test("restore original cover preserves EPUB image, metadata and uploaded file across reload", async () => {
  const adapter = new MemoryCoverCacheAdapter();
  const service = new CoverCacheService(adapter);
  adapter.files.set("Cover/custom.jpg", "uploaded-image");
  await service.save(firstKey, { ...firstEntry, vaultPath: "Cover/custom.jpg", isCustom: true });
  await service.restoreOriginal(firstKey);
  const reloaded = new CoverCacheService(adapter);
  const restored = (await reloaded.load())[firstKey];
  assert.equal(restored.dataUrl, firstEntry.dataUrl);
  assert.equal(restored.creator, firstEntry.creator);
  assert.equal(restored.vaultPath, undefined);
  assert.equal(restored.isCustom, undefined);
  assert.equal(adapter.files.get("Cover/custom.jpg"), "uploaded-image");
  await reloaded.restoreOriginal(firstKey);
  await reloaded.restoreOriginal("missing");
});

test("failed restoration retains the custom cover in memory and on disk", async () => {
  const adapter = new MemoryCoverCacheAdapter();
  const service = new CoverCacheService(adapter);
  const custom = { ...firstEntry, vaultPath: "Cover/custom.jpg", isCustom: true };
  await service.save(firstKey, custom);
  adapter.failWrites = true;
  await assert.rejects(service.restoreOriginal(firstKey), /write failure/);
  assert.deepEqual(service.snapshot()[firstKey], custom);
  assert.deepEqual((await new CoverCacheService(adapter).load())[firstKey], custom);
});

test("restoration without an extracted EPUB image leaves it eligible for extraction", async () => {
  const service = new CoverCacheService(new MemoryCoverCacheAdapter());
  await service.save(firstKey, { vaultPath: "Cover/custom.jpg", isCustom: true, updated: "old" });
  await service.restoreOriginal(firstKey);
  assert.equal(service.snapshot()[firstKey].dataUrl, undefined);
  assert.equal(service.snapshot()[firstKey].vaultPath, undefined);
});
