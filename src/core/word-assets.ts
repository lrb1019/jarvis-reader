import type { JarvisReaderSettings, WordAsset, WordAssetSource } from "../domain/index.ts";
import type { TranslationResult } from "../translation/core.ts";
import {
  getTranslationAssetKey,
  getTranslationAssetKind,
  getWordBlockId,
  mergeStringList,
  normalizeHighlightQuote,
  normalizeWordSelection,
  isWordInflectionOf,
} from "./text.ts";

export interface WordAssetSelection {
  quote: string;
  sentence?: string;
  chapterTitle: string;
  cfiRange: string;
}

export function getWordBookNotePath(bookTitle: string, settings: JarvisReaderSettings): string {
  const folder = settings.wordNoteFolder.replace(/^\/+|\/+$/g, "");
  const safe = bookTitle.replace(/[<>:"/\\|?*\x00-\x1f]/g, "-").trim() || "Words";
  return `${folder ? `${folder}/` : ""}${safe}.md`;
}

export function buildWordAsset(
  book: { path: string; title: string },
  selection: WordAssetSelection,
  translation: TranslationResult,
  settings: JarvisReaderSettings,
  existing?: WordAsset,
  now = new Date().toISOString(),
): WordAsset {
  const kind = getTranslationAssetKind(selection.quote, translation);
  const normalized = kind === "sentence" ? null : normalizeWordSelection(translation.lemma || selection.quote);
  const key = getTranslationAssetKey(selection, translation);
  if (!key || (kind !== "sentence" && !normalized)) throw new Error("Invalid translation asset key.");
  const source: WordAssetSource = {
    bookPath: book.path,
    bookTitle: book.title,
    chapterTitle: selection.chapterTitle || book.title,
    cfiRange: selection.cfiRange,
    quote: normalizeHighlightQuote(selection.quote),
    created: now,
  };
  const selected = normalizeWordSelection(selection.quote);
  const sources = [...(existing?.sources || [])];
  if (!sources.some((item) => item.bookPath === source.bookPath && item.cfiRange === source.cfiRange)) {
    sources.push(source);
  }
  return {
    lemma: key,
    title: kind === "sentence" ? source.quote : normalized?.surface || key,
    kind,
    isWord: kind !== "sentence",
    surfaceForms: kind === "sentence"
      ? []
      : mergeStringList(mergeStringList(existing?.surfaceForms, normalized?.surface), selected?.surface),
    translation: translation.translation || existing?.translation || "",
    display: translation.display || existing?.display || "",
    phonetic: translation.phonetic || existing?.phonetic || "",
    partOfSpeech: translation.partOfSpeech || existing?.partOfSpeech || "",
    example: translation.example || existing?.example || "",
    notePath: existing?.notePath || getWordBookNotePath(book.title, settings),
    blockId: existing?.blockId || getWordBlockId(key),
    mastered: existing?.mastered || false,
    sources: sources.slice(0, 12),
    created: existing?.created || now,
    updated: now,
  };
}

export function findWordAssetBySurface(
  assets: Record<string, WordAsset>,
  value: string,
): WordAsset | null {
  const normalized = normalizeWordSelection(value);
  if (!normalized) return null;
  const direct = assets[normalized.lemma];
  if (direct) return direct;
  const target = normalized.surface.toLowerCase();
  return (
    Object.values(assets).find(
      (asset) =>
        asset.kind !== "sentence" &&
        (asset.surfaceForms.some((form) => form.toLowerCase() === target) ||
          isWordInflectionOf(target, asset.lemma)),
    ) || null
  );
}
