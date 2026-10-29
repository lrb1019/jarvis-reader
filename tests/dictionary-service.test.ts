import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import JSZip from "jszip";
import type { App } from "obsidian";
import { DICTIONARY_SHARDS, DICTIONARY_SOURCE, parseDictionaryManifest, type DictionaryManifest } from "../src/dictionary-package.ts";
import { OfflineDictionaryError, OfflineDictionaryService, type DictionaryAdapter } from "../src/dictionary-service.ts";
import { lookupLocalDictionary } from "../src/word-assets.ts";

const root = ".obsidian/plugins/jarvis-reader";
const license = "MIT License\nCopyright test fixture\nPermission is hereby granted";
class MemoryDictionaryAdapter implements DictionaryAdapter {
  files = new Map<string, string>();
  folders = new Set<string>();
  failWrite: (path: string) => boolean = () => false;
  failRename: (from: string) => boolean = () => false;
  async exists(path: string) { return this.files.has(path) || this.folders.has(path); }
  async read(path: string) {
    const text = this.files.get(path);
    if (text === undefined) throw new Error("Missing fixture file");
    return text;
  }
  async write(path: string, text: string) {
    if (this.failWrite(path)) throw new Error("Write failed");
    this.files.set(path, text);
  }
  async mkdir(path: string) { this.folders.add(path); }
  async rename(from: string, to: string) {
    if (this.failRename(from)) throw new Error("Rename failed");
    if (await this.exists(to)) throw new Error("Target exists");
    this.files.set(to, await this.read(from)); this.files.delete(from);
  }
  async remove(path: string) { this.files.delete(path); }
  async rmdir(path: string) {
    for (const key of this.files.keys()) if (key.startsWith(`${path}/`)) this.files.delete(key);
    this.folders.delete(path);
  }
  legacy(pluginDir = root) {
    this.folders.add(`${pluginDir}/dictionaries/ecdict`);
    for (const name of DICTIONARY_SHARDS) this.files.set(`${pluginDir}/dictionaries/ecdict/${name}`, shard(name, "old"));
  }
}
function shard(name: string, meaning: string) { return JSON.stringify({ [`${name[0]}word`]: { translation: meaning, display: meaning } }); }
async function archive(meaning = "new", mutate?: (zip: JSZip, manifest: DictionaryManifest) => void) {
  const zip = new JSZip();
  const manifest: DictionaryManifest = { format: "jarvis-reader-ecdict-v1", version: "ecdict-111111111111", source: DICTIONARY_SOURCE, license: "MIT", files: {} };
  for (const name of DICTIONARY_SHARDS) {
    const text = shard(name, meaning);
    manifest.files[name] = { bytes: Buffer.byteLength(text), sha256: createHash("sha256").update(text).digest("hex") };
    zip.file(name, text);
  }
  zip.file("LICENSE", license);
  mutate?.(zip, manifest);
  zip.file("dictionary.json", JSON.stringify(manifest));
  return zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" });
}

test("missing, incomplete and corrupt dictionaries have distinct errors without writes", async () => {
  const storage = new MemoryDictionaryAdapter(), service = new OfflineDictionaryService(storage, root);
  assert.equal((await service.status()).state, "missing");
  await assert.rejects(service.readShard("a"), /尚未安装/);
  assert.equal(storage.files.size, 0);
  storage.legacy(); storage.files.delete(`${root}/dictionaries/ecdict/z.json`);
  assert.equal((await service.status(true)).state, "invalid");
  storage.files.set(`${root}/dictionaries/installed.json`, "broken json");
  assert.equal((await service.status(true)).state, "invalid");
  assert.equal(storage.files.get(`${root}/dictionaries/installed.json`), "broken json");
});

test("existing legacy dictionary works, corrupt shard remains intact", async () => {
  const storage = new MemoryDictionaryAdapter(); storage.legacy();
  const service = new OfflineDictionaryService(storage, root);
  assert.equal((await service.status()).state, "ready");
  assert.deepEqual((await service.readShard("a"))?.aword, { translation: "old", display: "old" });
  storage.files.set(`${root}/dictionaries/ecdict/b.json`, "not json");
  await assert.rejects(service.readShard("b"), OfflineDictionaryError);
  assert.equal(storage.files.get(`${root}/dictionaries/ecdict/b.json`), "not json");
});

test("import verifies 26 shards, preserves legacy files, reloads and refreshes cached results", async () => {
  const storage = new MemoryDictionaryAdapter(); storage.legacy();
  const service = new OfflineDictionaryService(storage, root), progress: number[] = [];
  await service.readShard("a");
  await service.importPackage(await archive(), done => progress.push(done));
  assert.equal(progress.length, 26);
  assert.equal(storage.files.get(`${root}/dictionaries/ecdict/a.json`), shard("a.json", "old"));
  assert.deepEqual((await service.readShard("a"))?.aword, { translation: "new", display: "new" });
  const reloaded = new OfflineDictionaryService(storage, root);
  assert.deepEqual((await reloaded.readShard("a"))?.aword, { translation: "new", display: "new" });
  await reloaded.importPackage(await archive("updated"));
  assert.deepEqual((await reloaded.readShard("a"))?.aword, { translation: "updated", display: "updated" });
});

test("missing shards, checksum errors, unsafe paths, bad data and unsupported packages preserve old dictionary", async () => {
  const cases: Array<(zip: JSZip, manifest: DictionaryManifest) => void> = [
    zip => { zip.remove("a.json"); },
    zip => { zip.file("a.json", "changed"); },
    zip => { zip.file("../escape.json", "{}"); },
    (_zip, manifest) => { manifest.format = "unsupported" as DictionaryManifest["format"]; },
    (zip, manifest) => {
      const bad = JSON.stringify({ aword: { phonetic: "only" } });
      zip.file("a.json", bad);
      manifest.files["a.json"] = { bytes: Buffer.byteLength(bad), sha256: createHash("sha256").update(bad).digest("hex") };
    },
    zip => { zip.file("LICENSE", "missing license"); },
  ];
  for (const mutate of cases) {
    const storage = new MemoryDictionaryAdapter(); storage.legacy();
    const service = new OfflineDictionaryService(storage, root);
    await assert.rejects(service.importPackage(await archive("new", mutate)));
    assert.equal(await storage.exists(`${root}/dictionaries/installed.json`), false);
    assert.deepEqual((await service.readShard("a"))?.aword, { translation: "old", display: "old" });
  }
});

test("failed file save leaves a previous installation and user files untouched", async () => {
  const storage = new MemoryDictionaryAdapter(), service = new OfflineDictionaryService(storage, root);
  await service.importPackage(await archive("first"));
  const pointer = storage.files.get(`${root}/dictionaries/installed.json`);
  storage.files.set("Reading Notes/Test.md", "user content");
  storage.failWrite = path => path.endsWith("/c.json");
  await assert.rejects(service.importPackage(await archive("second")), /Write failed/);
  assert.equal(storage.files.get(`${root}/dictionaries/installed.json`), pointer);
  assert.equal(storage.files.get("Reading Notes/Test.md"), "user content");
  assert.deepEqual((await new OfflineDictionaryService(storage, root).readShard("a"))?.aword, { translation: "first", display: "first" });
});

test("failed pointer activation rolls back and interrupted replacement recovers on reload", async () => {
  const storage = new MemoryDictionaryAdapter(), service = new OfflineDictionaryService(storage, root);
  await service.importPackage(await archive("first"));
  const pointer = storage.files.get(`${root}/dictionaries/installed.json`)!;
  storage.failRename = from => from.endsWith("installed.json.tmp");
  await assert.rejects(service.importPackage(await archive("second")), /Rename failed/);
  assert.equal(storage.files.get(`${root}/dictionaries/installed.json`), pointer);
  storage.failRename = () => false;
  storage.files.set(`${root}/dictionaries/installed.json.bak`, pointer);
  storage.files.delete(`${root}/dictionaries/installed.json`);
  const reloaded = new OfflineDictionaryService(storage, root);
  assert.equal((await reloaded.status()).state, "ready");
  assert.deepEqual((await reloaded.readShard("a"))?.aword, { translation: "first", display: "first" });
});

test("lookup respects custom config directory and distinguishes a miss from missing installation", async () => {
  const storage = new MemoryDictionaryAdapter();
  const app = { vault: { adapter: storage, configDir: ".custom" } } as unknown as App;
  await assert.rejects(lookupLocalDictionary({}, "aword", app), /尚未安装/);
  storage.legacy(".custom/plugins/jarvis-reader");
  // A fresh app adapter models plugin reload without relying on a stale missing-status cache.
  const other = new MemoryDictionaryAdapter(); other.legacy(".custom/plugins/jarvis-reader");
  const readyApp = { vault: { adapter: other, configDir: ".custom" } } as unknown as App;
  assert.equal((await lookupLocalDictionary({}, "aword", readyApp)).translation, "old");
  assert.equal(await lookupLocalDictionary({}, "absent", readyApp), null);
});

test("manifest rejects oversized decompressed resources before extraction", async () => {
  const bytes = await archive("x", (_zip, manifest) => { manifest.files["a.json"]!.bytes = 100 * 1024 * 1024; });
  await assert.rejects(new OfflineDictionaryService(new MemoryDictionaryAdapter(), root).importPackage(bytes), /清单无效/);
  assert.throws(() => parseDictionaryManifest("[]"), /格式不支持/);
});

test("unreadable ZIP and failed manifest or license saves never activate an import", async () => {
  const storage = new MemoryDictionaryAdapter(); storage.legacy();
  const service = new OfflineDictionaryService(storage, root);
  await assert.rejects(service.importPackage(new TextEncoder().encode("not a zip").buffer), /无法读取词典 ZIP/);
  for (const name of ["dictionary.json", "LICENSE"]) {
    storage.failWrite = path => path.endsWith(`/${name}`);
    await assert.rejects(service.importPackage(await archive()), /Write failed/);
    assert.equal(await storage.exists(`${root}/dictionaries/installed.json`), false);
    assert.equal((await service.status(true)).state, "ready");
  }
});

test("silent save corruption is detected before replacing the installed dictionary", async () => {
  for (const suffix of ["/a.json", "/dictionary.json", "/LICENSE", "installed.json.tmp", "installed.json.bak"]) {
    const storage = new MemoryDictionaryAdapter(), service = new OfflineDictionaryService(storage, root);
    await service.importPackage(await archive("first"));
    const pointer = storage.files.get(`${root}/dictionaries/installed.json`);
    const write = storage.write.bind(storage);
    storage.write = (path, text) => write(path, path.endsWith(suffix) ? "{}" : text);
    await assert.rejects(service.importPackage(await archive("second")));
    assert.equal(storage.files.get(`${root}/dictionaries/installed.json`), pointer);
    assert.deepEqual((await new OfflineDictionaryService(storage, root).readShard("a"))?.aword, { translation: "first", display: "first" });
  }
});
