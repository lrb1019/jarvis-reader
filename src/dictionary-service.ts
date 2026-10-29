// Use the same browser bundle as epub.js instead of shipping a second ZIP implementation.
import JSZip from "jszip/dist/jszip.js";
import type { App } from "obsidian";
import { DICTIONARY_PACKAGE_LIMIT, DICTIONARY_SHARDS, parseDictionaryManifest, parseDictionaryShard } from "./dictionary-package.ts";

export interface DictionaryAdapter {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
  write(path: string, data: string): Promise<void>;
  mkdir(path: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
  rmdir(path: string, recursive: boolean): Promise<void>;
}

export type DictionaryStatus =
  | { state: "ready"; folder: string; version: string }
  | { state: "missing" | "invalid"; message: string };

export class OfflineDictionaryError extends Error {}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

// JSZip 3.10 exposes internalStream on ZipObject, but omits it from its type declaration.
// Stream each known file with a size bound instead of inflating an arbitrary archive in memory.
function readZipFile(file: JSZip.JSZipObject, limit: number): Promise<Uint8Array> {
  const stream = (file as JSZip.JSZipObject & {
    internalStream(type: "uint8array"): JSZip.JSZipStreamHelper<Uint8Array>;
  }).internalStream("uint8array");
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let size = 0;
    stream.on("data", chunk => {
      size += chunk.length;
      if (size > limit) { stream.pause(); reject(new Error(`词典文件过大：${file.name}`)); return; }
      chunks.push(chunk);
    }).on("error", reject).on("end", () => {
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      resolve(bytes);
    }).resume();
  });
}

export class OfflineDictionaryService {
  private statusCache: DictionaryStatus | null = null;
  private readonly cache = new Map<string, Record<string, unknown>>();
  private importing = false;
  readonly root: string;
  private readonly activePath: string;

  constructor(privateAdapter: DictionaryAdapter, pluginDir: string) {
    this.adapter = privateAdapter;
    this.root = `${pluginDir}/dictionaries`;
    this.activePath = `${this.root}/installed.json`;
  }
  private readonly adapter: DictionaryAdapter;

  private async ensureFolder(path: string): Promise<void> {
    let parent = "";
    for (const part of path.split("/")) {
      parent = parent ? `${parent}/${part}` : part;
      if (!await this.adapter.exists(parent)) await this.adapter.mkdir(parent);
    }
  }

  async status(refresh = false): Promise<DictionaryStatus> {
    if (this.statusCache && !refresh) return this.statusCache;
    try {
      // Recover an interrupted pointer replacement; dictionary directories are immutable.
      if (!await this.adapter.exists(this.activePath) && await this.adapter.exists(`${this.activePath}.bak`)) {
        await this.adapter.rename(`${this.activePath}.bak`, this.activePath);
      }
      let folder = `${this.root}/ecdict`, version = "旧版 ECDICT";
      if (await this.adapter.exists(this.activePath)) {
        const pointer: unknown = JSON.parse(await this.adapter.read(this.activePath));
        if (!pointer || typeof pointer !== "object" || !("folder" in pointer)
          || typeof pointer.folder !== "string" || !/^import-[a-f0-9-]+$/.test(pointer.folder)) throw new Error("词典安装记录无效，请重新导入词典包。");
        folder = `${this.root}/${pointer.folder}`;
        version = parseDictionaryManifest(await this.adapter.read(`${folder}/dictionary.json`)).version;
      } else if (!await this.adapter.exists(folder)) {
        return this.statusCache = { state: "missing", message: "尚未安装离线词典，请在 Jarvis Reader 设置中导入词典包。" };
      }
      const complete = (await Promise.all(DICTIONARY_SHARDS.map(name => this.adapter.exists(`${folder}/${name}`)))).every(Boolean);
      this.statusCache = complete ? { state: "ready", folder, version }
        : { state: "invalid", message: "离线词典文件不完整，请在 Jarvis Reader 设置中重新导入词典包。" };
    } catch {
      this.statusCache = { state: "invalid", message: "离线词典安装记录或文件无法读取，请重新导入词典包。" };
    }
    return this.statusCache;
  }

  async readShard(letter: string): Promise<Record<string, unknown> | null> {
    if (!/^[a-z]$/.test(letter)) return null;
    const status = await this.status();
    if (status.state !== "ready") throw new OfflineDictionaryError(status.message);
    const path = `${status.folder}/${letter}.json`;
    const cached = this.cache.get(path);
    if (cached) return cached;
    try {
      const data = parseDictionaryShard(await this.adapter.read(path), `${letter}.json`);
      this.cache.set(path, data);
      return data;
    } catch {
      throw new OfflineDictionaryError("离线词典数据无法读取，请在 Jarvis Reader 设置中重新导入词典包。");
    }
  }

  async importPackage(bytes: ArrayBuffer, progress: (done: number) => void = () => {}): Promise<string> {
    if (this.importing) throw new Error("词典正在导入，请稍候。");
    if (!bytes.byteLength || bytes.byteLength > DICTIONARY_PACKAGE_LIMIT) throw new Error("请选择不超过 64 MB 的 Jarvis Reader 词典 ZIP 包。");
    this.importing = true;
    let staging = "", activated = false;
    try {
      const zip = await JSZip.loadAsync(bytes).catch(() => { throw new Error("无法读取词典 ZIP，请重新下载后导入。"); });
      const expected = new Set(["dictionary.json", "LICENSE", ...DICTIONARY_SHARDS]);
      const files = Object.values(zip.files);
      if (files.length !== expected.size || files.some(file => file.dir || !expected.has(file.name)
        || (file.unsafeOriginalName && file.unsafeOriginalName !== file.name))) throw new Error("词典包文件不匹配，请选择独立的 ECDICT 词典包。");
      const manifestText = new TextDecoder("utf-8", { fatal: true }).decode(await readZipFile(zip.file("dictionary.json")!, 16384));
      const manifest = parseDictionaryManifest(manifestText);
      const license = new TextDecoder("utf-8", { fatal: true }).decode(await readZipFile(zip.file("LICENSE")!, 16384));
      if (!license.includes("MIT License") || !license.includes("Permission is hereby granted")) throw new Error("词典包缺少 MIT 许可声明。");
      await this.ensureFolder(this.root);
      const folder = `import-${globalThis.crypto.randomUUID()}`;
      staging = `${this.root}/${folder}`;
      await this.adapter.mkdir(staging);
      for (let index = 0; index < DICTIONARY_SHARDS.length; index++) {
        const name = DICTIONARY_SHARDS[index]!;
        const entry = manifest.files[name]!;
        const data = await readZipFile(zip.file(name)!, entry.bytes);
        if (data.byteLength !== entry.bytes || await sha256(data) !== entry.sha256) throw new Error(`词典文件校验失败：${name}`);
        const text = new TextDecoder("utf-8", { fatal: true }).decode(data);
        parseDictionaryShard(text, name);
        await this.adapter.write(`${staging}/${name}`, text);
        const saved = await this.adapter.read(`${staging}/${name}`);
        if (await sha256(new TextEncoder().encode(saved)) !== entry.sha256) throw new Error(`词典文件保存校验失败：${name}`);
        progress(index + 1);
      }
      await this.adapter.write(`${staging}/dictionary.json`, manifestText);
      if (await this.adapter.read(`${staging}/dictionary.json`) !== manifestText) throw new Error("词典清单保存校验失败。");
      await this.adapter.write(`${staging}/LICENSE`, license);
      if (await this.adapter.read(`${staging}/LICENSE`) !== license) throw new Error("词典许可保存校验失败。");
      await this.activate(folder);
      activated = true;
      this.cache.clear();
      this.statusCache = null;
      return manifest.version;
    } finally {
      this.importing = false;
      if (staging && !activated && await this.adapter.exists(staging)) await this.adapter.rmdir(staging, true);
    }
  }

  private async activate(folder: string): Promise<void> {
    const temp = `${this.activePath}.tmp`, backup = `${this.activePath}.bak`;
    // Preserve the old pointer until the complete, verified new dictionary is ready.
    await this.status(true);
    const old = await this.adapter.exists(this.activePath) ? await this.adapter.read(this.activePath) : null;
    await this.adapter.write(temp, JSON.stringify({ folder }));
    if (JSON.parse(await this.adapter.read(temp)).folder !== folder) throw new Error("词典安装记录保存失败。");
    if (old !== null) {
      await this.adapter.write(backup, old);
      if (await this.adapter.read(backup) !== old) throw new Error("原词典安装记录备份失败。");
    }
    let moved = false;
    try {
      if (old !== null) { await this.adapter.remove(this.activePath); moved = true; }
      await this.adapter.rename(temp, this.activePath);
    } catch (error) {
      if (moved && !await this.adapter.exists(this.activePath)) await this.adapter.rename(backup, this.activePath);
      throw error;
    }
  }
}

const services = new WeakMap<object, OfflineDictionaryService>();
export function getOfflineDictionaryService(app: App): OfflineDictionaryService {
  const adapter = app.vault.adapter;
  let service = services.get(adapter);
  if (!service) {
    service = new OfflineDictionaryService(adapter, `${app.vault.configDir}/plugins/jarvis-reader`);
    services.set(adapter, service);
  }
  return service;
}
