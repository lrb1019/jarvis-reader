import type { BookCoverCache, BookCoverCacheEntry } from "./types.ts";

export interface CoverCacheAdapter {
  exists(path: string): Promise<boolean>;
  list(path: string): Promise<{ files: string[]; folders: string[] }>;
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
  mkdir(path: string): Promise<void>;
  remove(path: string): Promise<void>;
}

interface PersistedCoverCacheEntry {
  version: 1;
  key: string;
  entry: BookCoverCacheEntry;
}

const CACHE_FOLDER = ".obsidian/plugins/jarvis-reader/cache/covers";
const DATA_PATH = ".obsidian/plugins/jarvis-reader/data.json";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseEntry(payload: unknown): PersistedCoverCacheEntry | null {
  if (!isRecord(payload) || payload.version !== 1 || typeof payload.key !== "string" || !isRecord(payload.entry)) return null;
  const entry = payload.entry;
  if (typeof entry.updated !== "string" || (entry.dataUrl !== undefined && typeof entry.dataUrl !== "string")) return null;
  return payload as unknown as PersistedCoverCacheEntry;
}

function hashPart(value: string, seed: number): string {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function getCoverCachePath(key: string): string {
  const reversed = [...key].reverse().join("");
  const hash = `${hashPart(key, 2166136261)}${hashPart(key, 3335557771)}${hashPart(reversed, 2166136261)}${hashPart(reversed, 3335557771)}`;
  return `${CACHE_FOLDER}/${hash}.json`;
}

async function ensureFolder(adapter: CoverCacheAdapter, folder: string): Promise<void> {
  let current = "";
  for (const part of folder.split("/").filter(Boolean)) {
    current = current ? `${current}/${part}` : part;
    if (!await adapter.exists(current)) await adapter.mkdir(current);
  }
}

export class CoverCacheService {
  private readonly adapter: CoverCacheAdapter;
  private cache: BookCoverCache = {};

  constructor(adapter: CoverCacheAdapter) {
    this.adapter = adapter;
  }

  snapshot(): BookCoverCache {
    return { ...this.cache };
  }

  async load(): Promise<BookCoverCache> {
    this.cache = {};
    if (!await this.adapter.exists(CACHE_FOLDER)) return this.snapshot();
    const listing = await this.adapter.list(CACHE_FOLDER);
    for (const path of listing.files.filter((file) => file.endsWith(".json"))) {
      try {
        const parsed = parseEntry(JSON.parse(await this.adapter.read(path)));
        if (parsed) this.cache[parsed.key] = parsed.entry;
      } catch {
        // A cache entry is disposable; ignore it and regenerate when the book is visible.
      }
    }
    return this.snapshot();
  }

  async save(key: string, entry: BookCoverCacheEntry): Promise<void> {
    if (!key) throw new Error("封面缓存缺少书籍标识。");
    await ensureFolder(this.adapter, CACHE_FOLDER);
    const path = getCoverCachePath(key);
    const existing = await this.readPersisted(path);
    if (existing && existing.key !== key) throw new Error("封面缓存键发生哈希冲突，已停止写入。");
    const payload: PersistedCoverCacheEntry = { version: 1, key, entry };
    await this.adapter.write(path, JSON.stringify(payload));
    this.cache = { ...this.cache, [key]: entry };
  }

  async migrateLegacy(legacy: BookCoverCache): Promise<string | null> {
    const entries = Object.entries(legacy || {});
    if (!entries.length) return null;
    const backupRoot = `.obsidian/plugins/jarvis-reader/backups/migrations/${new Date().toISOString().replace(/[:.]/g, "-")}`;
    if (await this.adapter.exists(DATA_PATH)) {
      await ensureFolder(this.adapter, backupRoot);
      await this.adapter.write(`${backupRoot}/data.json`, await this.adapter.read(DATA_PATH));
    }
    for (const [key, legacyEntry] of entries) {
      const current = this.cache[key];
      const currentTime = new Date(current?.updated || 0).getTime();
      const legacyTime = new Date(legacyEntry.updated || 0).getTime();
      if (!current || legacyTime > currentTime) await this.save(key, legacyEntry);
    }
    return backupRoot;
  }

  async prune(validKeys: Iterable<string>): Promise<number> {
    const valid = new Set(validKeys);
    let removed = 0;
    for (const key of Object.keys(this.cache)) {
      if (valid.has(key)) continue;
      const path = getCoverCachePath(key);
      if (await this.adapter.exists(path)) await this.adapter.remove(path);
      delete this.cache[key];
      removed += 1;
    }
    if (removed) this.cache = { ...this.cache };
    return removed;
  }

  private async readPersisted(path: string): Promise<PersistedCoverCacheEntry | null> {
    if (!await this.adapter.exists(path)) return null;
    try {
      return parseEntry(JSON.parse(await this.adapter.read(path)));
    } catch {
      return null;
    }
  }
}
