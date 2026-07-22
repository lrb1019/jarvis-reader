import type { BookHighlightsMap, WordAssetMap } from "./types.ts";
import {
  classifyConflictFiles,
  mergeHighlightPayload,
  mergeSettingsPayload,
  mergeWordAssetPayload,
  type ConflictFileSet,
  type SettingsConflictState,
} from "./conflict-resolution-core.ts";

export interface ConflictAdapter {
  exists(path: string): Promise<boolean>;
  list(path: string): Promise<{ files: string[]; folders: string[] }>;
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
  mkdir(path: string): Promise<void>;
  trashSystem(path: string): Promise<boolean>;
}

export interface ConflictResolutionHost {
  app: { vault: { adapter: ConflictAdapter } };
  settings: {
    wordAssets?: WordAssetMap;
    bookHighlights?: BookHighlightsMap;
    readingStats?: SettingsConflictState["readingStats"];
    wordReviewStats?: SettingsConflictState["wordReviewStats"];
    bookProgress?: SettingsConflictState["bookProgress"];
  };
  wordAssetSidecarUnavailable: boolean;
  highlightSidecarUnavailable: boolean;
  wordAssetService: { replaceAll(assets: WordAssetMap, reason: string): Promise<void> };
  highlightService: { replaceAll(highlights: BookHighlightsMap, reason: string): Promise<void> };
  saveSettingsData(): Promise<void>;
}

export const PLUGIN_ROOT = ".obsidian/plugins/jarvis-reader";
const INDEX_FOLDER = `${PLUGIN_ROOT}/index`;

export function allConflictPaths(files: ConflictFileSet): string[] {
  return [...files.wordAssets, ...files.highlights, ...files.settings];
}

export async function detectSyncConflicts(adapter: ConflictAdapter, host: ConflictResolutionHost): Promise<ConflictFileSet> {
  const indexFiles = await adapter.exists(INDEX_FOLDER) ? (await adapter.list(INDEX_FOLDER)).files : [];
  const rootFiles = await adapter.exists(PLUGIN_ROOT) ? (await adapter.list(PLUGIN_ROOT)).files : [];
  const files = classifyConflictFiles(indexFiles, rootFiles);
  if (host.wordAssetSidecarUnavailable) files.wordAssets = [];
  if (host.highlightSidecarUnavailable) files.highlights = [];
  return files;
}

async function ensureFolder(adapter: ConflictAdapter, folder: string): Promise<void> {
  let current = "";
  for (const part of folder.split("/").filter(Boolean)) {
    current = current ? `${current}/${part}` : part;
    if (!await adapter.exists(current)) await adapter.mkdir(current);
  }
}

export async function createConflictBackup(adapter: ConflictAdapter, files: ConflictFileSet): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const root = `${PLUGIN_ROOT}/backups/conflicts/${timestamp}`;
  const canonical = [
    `${INDEX_FOLDER}/word-assets.json`,
    `${INDEX_FOLDER}/highlights.json`,
    `${PLUGIN_ROOT}/data.json`,
  ];
  for (const path of [...canonical, ...allConflictPaths(files)]) {
    if (!await adapter.exists(path)) continue;
    const target = `${root}/${path.replace(/^\/+/, "")}`;
    await ensureFolder(adapter, target.split("/").slice(0, -1).join("/"));
    await adapter.write(target, await adapter.read(path));
  }
  return root;
}

function currentSettingsState(host: ConflictResolutionHost): SettingsConflictState {
  return {
    readingStats: structuredClone(host.settings.readingStats || {}),
    wordReviewStats: structuredClone(host.settings.wordReviewStats || {}),
    bookProgress: structuredClone(host.settings.bookProgress || {}),
  };
}

function applySettingsState(host: ConflictResolutionHost, state: SettingsConflictState): void {
  host.settings.readingStats = state.readingStats;
  host.settings.wordReviewStats = state.wordReviewStats;
  host.settings.bookProgress = state.bookProgress;
}

async function parseJson(adapter: ConflictAdapter, path: string): Promise<unknown> {
  try {
    return JSON.parse(await adapter.read(path));
  } catch {
    throw new Error(`冲突文件不是合法 JSON：${path}`);
  }
}

export async function mergeConfirmedConflicts(host: ConflictResolutionHost, files: ConflictFileSet): Promise<string> {
  const adapter = host.app.vault.adapter;
  const previousWords = structuredClone(host.settings.wordAssets || {});
  const previousHighlights = structuredClone(host.settings.bookHighlights || {});
  const previousSettings = currentSettingsState(host);
  let nextWords: Record<string, unknown> = structuredClone(previousWords);
  let nextHighlights: Record<string, unknown[]> = structuredClone(previousHighlights as Record<string, unknown[]>);
  let nextSettings = structuredClone(previousSettings);

  for (const path of files.wordAssets) {
    const merged = mergeWordAssetPayload(nextWords, await parseJson(adapter, path));
    if (!merged) throw new Error(`词条冲突文件结构非法：${path}`);
    nextWords = merged;
  }
  for (const path of files.highlights) {
    const merged = mergeHighlightPayload(nextHighlights, await parseJson(adapter, path));
    if (!merged) throw new Error(`高亮冲突文件结构非法：${path}`);
    nextHighlights = merged;
  }
  for (const path of files.settings) {
    const merged = mergeSettingsPayload(nextSettings, await parseJson(adapter, path));
    if (!merged) throw new Error(`设置冲突文件结构非法：${path}`);
    nextSettings = merged;
  }

  const backupRoot = await createConflictBackup(adapter, files);
  let wordsCommitted = false;
  let highlightsCommitted = false;
  try {
    if (files.wordAssets.length) {
      await host.wordAssetService.replaceAll(nextWords as WordAssetMap, "confirmed-conflict-resolve");
      wordsCommitted = true;
    }
    if (files.highlights.length) {
      await host.highlightService.replaceAll(nextHighlights as BookHighlightsMap, "confirmed-conflict-resolve");
      highlightsCommitted = true;
    }
    if (files.settings.length) {
      applySettingsState(host, nextSettings);
      await host.saveSettingsData();
    }
  } catch (error) {
    applySettingsState(host, previousSettings);
    const rollbackErrors: unknown[] = [];
    if (highlightsCommitted) {
      try { await host.highlightService.replaceAll(previousHighlights, "conflict-rollback"); } catch (rollbackError) { rollbackErrors.push(rollbackError); }
    }
    if (wordsCommitted) {
      try { await host.wordAssetService.replaceAll(previousWords, "conflict-rollback"); } catch (rollbackError) { rollbackErrors.push(rollbackError); }
    }
    if (files.settings.length) {
      try { await host.saveSettingsData(); } catch (rollbackError) { rollbackErrors.push(rollbackError); }
    }
    if (rollbackErrors.length) {
      throw new Error(`冲突合并失败且自动回滚不完整。备份位于 ${backupRoot}`);
    }
    throw error;
  }

  for (const path of allConflictPaths(files)) await adapter.trashSystem(path);
  return backupRoot;
}
