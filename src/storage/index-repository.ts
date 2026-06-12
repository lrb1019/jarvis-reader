import type {
  BookHighlight,
  HighlightSidecar,
  IndexChangeLogEntry,
  JarvisReaderSettings,
  PersistedBookHighlight,
  PersistedBookHighlightsMap,
  WordAsset,
  WordAssetMap,
  WordAssetSidecar,
} from "../domain";
import { getTranslationAssetKind, getTranslationAssetStorageKey, getWordBlockId } from "../core/text.ts";
import { normalizeHighlightColor } from "../core/highlights.ts";
import { ensureStorageFolder, type TextFileStore } from "./contracts.ts";

export const INDEX_PATHS = {
  highlights: ".obsidian/plugins/jarvis-reader/index/highlights.json",
  wordAssets: ".obsidian/plugins/jarvis-reader/index/word-assets.json",
  log: ".obsidian/plugins/jarvis-reader/logs/index-changes.jsonl",
} as const;

interface IndexCounts {
  highlightCount: number;
  wordAssetCount: number;
}

interface IndexSnapshot {
  bookHighlights: PersistedBookHighlightsMap;
  wordAssets: WordAssetMap;
}

export interface RestoreResult {
  restoredHighlightBooks: number;
  initializedWordAssetSidecar: boolean;
}

export class IndexDataError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "IndexDataError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function normalizeHighlight(value: unknown): PersistedBookHighlight | null {
  if (!isRecord(value)) return null;
  const id = text(value.id) || text(value.blockId);
  return {
    id,
    bookPath: text(value.bookPath),
    bookTitle: text(value.bookTitle),
    chapterTitle: text(value.chapterTitle),
    cfiRange: text(value.cfiRange),
    quote: text(value.quote),
    comment: text(value.comment),
    markColor: normalizeHighlightColor(value.markColor),
    notePath: text(value.notePath),
    blockId: text(value.blockId) || id,
    created: text(value.created),
    updated: text(value.updated),
  };
}

function normalizeWordAsset(value: unknown): WordAsset | null {
  if (!isRecord(value)) return null;
  const lemma = text(value.lemma);
  if (!lemma) return null;
  const kind = getTranslationAssetKind({
    kind:
      value.kind === "word" || value.kind === "phrase" || value.kind === "sentence"
        ? value.kind
        : undefined,
    isWord: typeof value.isWord === "boolean" ? value.isWord : undefined,
    lemma,
  });
  const sources = Array.isArray(value.sources)
    ? value.sources.filter(isRecord).map((source) => ({
        bookPath: text(source.bookPath),
        bookTitle: text(source.bookTitle),
        chapterTitle: text(source.chapterTitle),
        cfiRange: text(source.cfiRange),
        quote: text(source.quote),
        created: text(source.created),
      }))
    : [];
  return {
    lemma,
    title: text(value.title),
    kind,
    isWord: value.isWord !== false && kind !== "sentence",
    surfaceForms: stringList(value.surfaceForms),
    translation: text(value.translation),
    display: text(value.display),
    phonetic: text(value.phonetic),
    partOfSpeech: text(value.partOfSpeech),
    example: text(value.example),
    notePath: text(value.notePath),
    blockId: text(value.blockId) || getWordBlockId(lemma),
    mastered: Boolean(value.mastered),
    sources,
    created: text(value.created),
    updated: text(value.updated),
  };
}

function parseJson(raw: string, path: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (cause) {
    throw new IndexDataError(`Invalid JSON in ${path}.`, { cause });
  }
}

export class IndexRepository {
  private lastCounts: IndexCounts | null = null;
  private readonly store: TextFileStore;
  private readonly now: () => string;

  constructor(
    store: TextFileStore,
    now: () => string = () => new Date().toISOString(),
  ) {
    this.store = store;
    this.now = now;
  }

  async restore(settings: JarvisReaderSettings): Promise<RestoreResult> {
    let restoredHighlightBooks = 0;
    if (await this.store.exists(INDEX_PATHS.highlights)) {
      const payload = parseJson(
        await this.store.read(INDEX_PATHS.highlights),
        INDEX_PATHS.highlights,
      );
      if (!isRecord(payload) || payload.version !== 1 || !isRecord(payload.bookHighlights)) {
        throw new IndexDataError("highlights.json does not match version 1 schema.");
      }
      for (const [bookPath, rawList] of Object.entries(payload.bookHighlights)) {
        if (!Array.isArray(rawList) || rawList.length === 0) continue;
        const current = settings.bookHighlights[bookPath];
        if (Array.isArray(current) && current.length > 0) continue;
        const normalized = rawList
          .map(normalizeHighlight)
          .filter((item): item is PersistedBookHighlight => item !== null);
        if (normalized.length > 0) {
          settings.bookHighlights[bookPath] = normalized;
          restoredHighlightBooks += 1;
        }
      }
    }

    if (!(await this.store.exists(INDEX_PATHS.wordAssets))) {
      settings.wordAssets = {};
      await this.writeWordAssets(settings.wordAssets);
      return { restoredHighlightBooks, initializedWordAssetSidecar: true };
    }

    try {
      const payload = parseJson(
        await this.store.read(INDEX_PATHS.wordAssets),
        INDEX_PATHS.wordAssets,
      );
      if (!isRecord(payload) || payload.version !== 2 || !isRecord(payload.wordAssets)) {
        throw new IndexDataError("word-assets.json does not match version 2 schema.");
      }
      const wordAssets: WordAssetMap = {};
      for (const [fallbackKey, rawAsset] of Object.entries(payload.wordAssets)) {
        const asset = normalizeWordAsset(rawAsset);
        if (!asset) continue;
        const key = getTranslationAssetStorageKey(asset) || fallbackKey;
        if (key) wordAssets[key] = asset;
      }
      settings.wordAssets = wordAssets;
      return { restoredHighlightBooks, initializedWordAssetSidecar: false };
    } catch (error) {
      settings.wordAssets = {};
      throw error;
    }
  }

  snapshot(settings: JarvisReaderSettings): IndexSnapshot {
    const bookHighlights: PersistedBookHighlightsMap = {};
    for (const [bookPath, list] of Object.entries(settings.bookHighlights)) {
      if (!Array.isArray(list)) continue;
      bookHighlights[bookPath] = list.map((highlight) => this.persistedHighlight(highlight));
    }
    const wordAssets: WordAssetMap = {};
    for (const [fallbackKey, rawAsset] of Object.entries(settings.wordAssets)) {
      const asset = normalizeWordAsset(rawAsset);
      if (!asset) continue;
      const key = getTranslationAssetStorageKey(asset) || fallbackKey;
      if (key) wordAssets[key] = asset;
    }
    return { bookHighlights, wordAssets };
  }

  async persist(settings: JarvisReaderSettings, reason = "save"): Promise<void> {
    const snapshot = this.snapshot(settings);
    await ensureStorageFolder(this.store, ".obsidian/plugins/jarvis-reader/index");
    await ensureStorageFolder(this.store, ".obsidian/plugins/jarvis-reader/logs");
    const updated = this.now();
    const highlights: HighlightSidecar = {
      version: 1,
      updated,
      bookHighlights: snapshot.bookHighlights,
    };
    await this.store.write(INDEX_PATHS.highlights, JSON.stringify(highlights, null, 2));
    await this.writeWordAssets(snapshot.wordAssets, updated);
    await this.logChange(reason, snapshot);
  }

  private persistedHighlight(highlight: BookHighlight): PersistedBookHighlight {
    const id = highlight.id || highlight.blockId || "";
    return {
      id,
      bookPath: highlight.bookPath || "",
      bookTitle: highlight.bookTitle || "",
      chapterTitle: highlight.chapterTitle || "",
      cfiRange: highlight.cfiRange || "",
      quote: highlight.quote || "",
      comment: highlight.comment || "",
      markColor: normalizeHighlightColor(highlight.markColor),
      notePath: highlight.notePath || "",
      blockId: highlight.blockId || id,
      created: highlight.created || "",
      updated: highlight.updated || "",
    };
  }

  private async writeWordAssets(wordAssets: WordAssetMap, updated = this.now()): Promise<void> {
    await ensureStorageFolder(this.store, ".obsidian/plugins/jarvis-reader/index");
    const payload: WordAssetSidecar = { version: 2, updated, wordAssets };
    await this.store.write(INDEX_PATHS.wordAssets, JSON.stringify(payload, null, 2));
  }

  private counts(snapshot: IndexSnapshot): IndexCounts {
    return {
      highlightCount: Object.values(snapshot.bookHighlights).reduce(
        (total, list) => total + list.length,
        0,
      ),
      wordAssetCount: Object.keys(snapshot.wordAssets).length,
    };
  }

  private async logChange(reason: string, snapshot: IndexSnapshot): Promise<void> {
    const counts = this.counts(snapshot);
    const changed =
      !this.lastCounts ||
      this.lastCounts.highlightCount !== counts.highlightCount ||
      this.lastCounts.wordAssetCount !== counts.wordAssetCount;
    if (!changed && !String(reason || "").startsWith("restore")) return;
    this.lastCounts = counts;

    const entry: IndexChangeLogEntry = { time: this.now(), reason, ...counts };
    const existing = (await this.store.exists(INDEX_PATHS.log))
      ? await this.store.read(INDEX_PATHS.log)
      : "";
    const separator = existing && !existing.endsWith("\n") ? "\n" : "";
    await this.store.write(
      INDEX_PATHS.log,
      `${existing}${separator}${JSON.stringify(entry)}\n`,
    );
  }
}
