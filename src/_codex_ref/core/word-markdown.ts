import type { TranslationAssetKind } from "../domain";
import {
  getTranslationAssetKind,
  getWordBlockId,
  normalizeWordDisplayText,
  type TranslationAssetLike,
} from "./text.ts";

export const JARVIS_WORD_NOTE_START = "<!-- jarvis-reader-word:start -->";
export const JARVIS_WORD_NOTE_END = "<!-- jarvis-reader-word:end -->";

export interface WordEntryAsset extends TranslationAssetLike {
  lemma: string;
  title?: string;
  display?: string;
  translation?: string;
  example?: string;
  blockId?: string;
}

export function getWordEntrySectionTitle(kind: TranslationAssetKind): string {
  switch (kind) {
    case "phrase":
      return "短语";
    case "sentence":
      return "句子";
    case "word":
    default:
      return "单词";
  }
}

export function ensureWordBookSections(content?: string | null): string {
  let next = String(content || "")
    .replace(/^##\s+Words\s*$/gim, "## 单词")
    .replace(/^##\s+Phrases\s*$/gim, "## 短语")
    .replace(/^##\s+Sentences\s*$/gim, "## 句子");
  for (const title of ["单词", "短语", "句子"]) {
    if (!new RegExp(`^##\\s+${title}\\s*$`, "m").test(next)) {
      next = `${next.trimEnd()}\n\n## ${title}\n`;
    }
  }
  return next;
}

export function getWordEntryStart(lemma: string): string {
  return `<!-- jarvis-reader-word-entry:${getWordBlockId(lemma)}:start -->`;
}

export function getWordEntryEnd(lemma: string): string {
  return `<!-- jarvis-reader-word-entry:${getWordBlockId(lemma)}:end -->`;
}

export function buildWordGeneratedBlock(asset: WordEntryAsset): string {
  const cardText = normalizeWordDisplayText(
    asset.display || asset.translation || asset.example || "",
  );
  return [JARVIS_WORD_NOTE_START, "## Card", cardText, "", JARVIS_WORD_NOTE_END].join(
    "\n",
  );
}

export function extractWordCardDisplayFromContent(
  content: string | null | undefined,
  asset: Pick<WordEntryAsset, "lemma">,
): string {
  const current = String(content || "");
  const entryStart = current.indexOf(getWordEntryStart(asset.lemma));
  const entryEnd = current.indexOf(getWordEntryEnd(asset.lemma));
  const scope = entryStart >= 0 && entryEnd > entryStart
    ? current.slice(entryStart, entryEnd)
    : current;
  const start = scope.indexOf(JARVIS_WORD_NOTE_START);
  const end = scope.indexOf(JARVIS_WORD_NOTE_END);
  if (start < 0 || end <= start) return "";
  return normalizeWordDisplayText(
    scope
      .slice(start + JARVIS_WORD_NOTE_START.length, end)
      .replace(/^\s*##\s+Card\s*(?:\r?\n)?/i, ""),
  );
}

export function buildWordEntryBlock(asset: WordEntryAsset): string {
  const blockId = asset.blockId || getWordBlockId(asset.lemma);
  return `${getWordEntryStart(asset.lemma)}
### ${asset.title || asset.lemma || "word"}

${buildWordGeneratedBlock(asset)}

^${blockId}
${getWordEntryEnd(asset.lemma)}`;
}

export function insertWordEntryIntoSection(
  content: string | null | undefined,
  asset: WordEntryAsset,
): string {
  const current = ensureWordBookSections(content);
  const title = getWordEntrySectionTitle(getTranslationAssetKind(asset));
  const start = current.search(new RegExp(`^##\\s+${title}\\s*$`, "m"));
  if (start < 0) return `${current.trimEnd()}\n\n${buildWordEntryBlock(asset)}\n`;

  const afterHeading = start + current.slice(start).indexOf("\n") + 1;
  const nextSectionRelative = current
    .slice(afterHeading)
    .search(/^##\s+(单词|短语|句子)\s*$/m);
  const insertAt =
    nextSectionRelative >= 0 ? afterHeading + nextSectionRelative : current.length;
  const before = current.slice(0, insertAt).trimEnd();
  const after = current.slice(insertAt).replace(/^\s*/, "");
  return `${before}\n\n${buildWordEntryBlock(asset)}\n${after ? `\n${after}` : ""}`;
}

export function upsertWordEntryInContent(
  content: string | null | undefined,
  asset: WordEntryAsset,
): string {
  const current = content || "";
  const startMarker = getWordEntryStart(asset.lemma);
  const endMarker = getWordEntryEnd(asset.lemma);
  const startIndex = current.indexOf(startMarker);
  const endIndex = current.indexOf(endMarker);
  if (startIndex >= 0 && endIndex > startIndex) {
    const entryEnd = endIndex + endMarker.length;
    const entry = current.slice(startIndex, entryEnd);
    const generatedBlock = buildWordGeneratedBlock(asset);
    const generatedStart = entry.indexOf(JARVIS_WORD_NOTE_START);
    const generatedEnd = entry.indexOf(JARVIS_WORD_NOTE_END);
    if (generatedStart >= 0 && generatedEnd > generatedStart) {
      const nextEntry =
        entry.slice(0, generatedStart) +
        generatedBlock +
        entry.slice(generatedEnd + JARVIS_WORD_NOTE_END.length);
      return current.slice(0, startIndex) + nextEntry + current.slice(entryEnd);
    }
    return (
      current.slice(0, startIndex) + buildWordEntryBlock(asset) + current.slice(entryEnd)
    );
  }
  return insertWordEntryIntoSection(current, asset);
}

export function deleteWordEntryInContent(
  content: string | null | undefined,
  asset?: Pick<WordEntryAsset, "lemma"> | null,
): string {
  const current = content || "";
  if (!asset?.lemma) return current;
  const startMarker = getWordEntryStart(asset.lemma);
  const endMarker = getWordEntryEnd(asset.lemma);
  const startIndex = current.indexOf(startMarker);
  const endIndex = current.indexOf(endMarker);
  if (startIndex < 0 || endIndex <= startIndex) return current;

  const entryEnd = endIndex + endMarker.length;
  const before = current
    .slice(0, startIndex)
    .replace(/[ \t]*(?:\r?\n[ \t]*){0,2}$/, "");
  const after = current.slice(entryEnd).replace(/^(?:[ \t]*\r?\n){0,2}/, "");
  if (before && after) return `${before}\n\n${after}`;
  return before || after;
}
