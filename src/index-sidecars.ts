import type { PersistedBookHighlight, PersistedBookHighlightsMap, WordAssetMap } from "./types.ts";
import { parseWordAssetSidecar } from "./word-assets.ts";

export interface SidecarFileAdapter {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  remove(path: string): Promise<void>;
  mkdir?(path: string): Promise<void>;
}

async function writeValidatedSidecar<T>(
  adapter: SidecarFileAdapter,
  path: string,
  content: string,
  parse: (payload: unknown) => T | null,
): Promise<void> {
  const tempPath = `${path}.tmp`;
  const backupPath = `${path}.bak`;
  if (await adapter.exists(backupPath)) {
    if (await adapter.exists(path)) await adapter.remove(backupPath);
    else await adapter.rename(backupPath, path);
  }
  if (await adapter.exists(tempPath)) await adapter.remove(tempPath);
  let originalMoved = false;
  try {
    await adapter.write(tempPath, content);
    const written = parse(JSON.parse(await adapter.read(tempPath)));
    if (!written) throw new Error(`Sidecar validation failed before replace: ${path}`);
    if (await adapter.exists(path)) {
      await adapter.rename(path, backupPath);
      originalMoved = true;
    }
    await adapter.rename(tempPath, path);
  } catch (error) {
    if (await adapter.exists(tempPath)) await adapter.remove(tempPath);
    if (originalMoved && await adapter.exists(backupPath) && !await adapter.exists(path)) {
      await adapter.rename(backupPath, path);
    }
    throw error;
  }
  if (await adapter.exists(backupPath)) await adapter.remove(backupPath);
}

export type SidecarReadResult<T> =
  | { status: "ready"; value: T }
  | { status: "missing" }
  | { status: "invalid" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isHighlightRecord(value: unknown): value is PersistedBookHighlight {
  if (!isRecord(value)) return false;
  const requiredFields = [
    "id", "bookPath", "bookTitle", "chapterTitle", "cfiRange",
    "notePath", "blockId", "created", "updated",
  ];
  return requiredFields.every((field) => typeof value[field] === "string");
}

export function parseHighlightSidecar(payload: unknown): PersistedBookHighlightsMap | null {
  if (!isRecord(payload) || payload.version !== 1 || !isRecord(payload.bookHighlights)) {
    return null;
  }
  for (const highlights of Object.values(payload.bookHighlights)) {
    if (!Array.isArray(highlights) || !highlights.every(isHighlightRecord)) {
      return null;
    }
  }
  return payload.bookHighlights as PersistedBookHighlightsMap;
}

export async function ensureSidecarFolder(adapter: SidecarFileAdapter, folderPath: string): Promise<void> {
  if (typeof adapter.mkdir !== "function") return;
  let current = "";
  for (const segment of folderPath.split("/").filter(Boolean)) {
    current = current ? `${current}/${segment}` : segment;
    if (!await adapter.exists(current)) {
      await adapter.mkdir(current);
    }
  }
}

async function readValidatedSidecar<T>(
  adapter: SidecarFileAdapter,
  path: string,
  parse: (payload: unknown) => T | null,
): Promise<SidecarReadResult<T>> {
  if (!await adapter.exists(path)) return { status: "missing" };
  try {
    const value = parse(JSON.parse(await adapter.read(path)));
    return value ? { status: "ready", value } : { status: "invalid" };
  } catch {
    return { status: "invalid" };
  }
}

export function readHighlightSidecar(adapter: SidecarFileAdapter, path: string): Promise<SidecarReadResult<PersistedBookHighlightsMap>> {
  return readValidatedSidecar(adapter, path, parseHighlightSidecar);
}

export function readWordAssetSidecar(adapter: SidecarFileAdapter, path: string): Promise<SidecarReadResult<WordAssetMap>> {
  return readValidatedSidecar(adapter, path, parseWordAssetSidecar);
}

export async function writeHighlightSidecar(
  adapter: SidecarFileAdapter,
  path: string,
  bookHighlights: PersistedBookHighlightsMap,
  updated = new Date().toISOString(),
): Promise<void> {
  await ensureSidecarFolder(adapter, path.split("/").slice(0, -1).join("/"));
  await writeValidatedSidecar(
    adapter,
    path,
    JSON.stringify({ version: 1, updated, bookHighlights }, null, 2),
    parseHighlightSidecar,
  );
}

export async function writeWordAssetSidecar(
  adapter: SidecarFileAdapter,
  path: string,
  wordAssets: WordAssetMap,
  updated = new Date().toISOString(),
): Promise<void> {
  await ensureSidecarFolder(adapter, path.split("/").slice(0, -1).join("/"));
  await writeValidatedSidecar(
    adapter,
    path,
    JSON.stringify({ version: 2, updated, wordAssets }, null, 2),
    parseWordAssetSidecar,
  );
}
