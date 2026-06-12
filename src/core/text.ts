import type { TranslationAssetKind } from "../domain";

export interface NormalizedWordSelection {
  lemma: string;
  surface: string;
  tokens: string[];
  isSingleWord: boolean;
  isPhrase: boolean;
}

export interface TranslationAssetLike {
  kind?: TranslationAssetKind;
  isWord?: boolean;
  lemma?: string;
  quote?: string;
}

export interface TranslationSelectionLike {
  quote?: string;
  cfiRange?: string;
}

export interface TranslationResultLike {
  lemma?: string;
  isWord?: boolean;
}

export function normalizeHighlightQuote(quote?: string | null): string {
  return (quote || "").replace(/\s+/g, " ").trim();
}

export function sanitizeWordAssetFilename(value?: string | null): string {
  const cleaned = (value || "")
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || "word";
}

export function normalizeWordSelection(
  value?: string | null,
): NormalizedWordSelection | null {
  const cleaned = (value || "")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;

  const stripped = cleaned
    .replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!stripped || !/[A-Za-z]/.test(stripped)) return null;
  if (!/^[A-Za-z][A-Za-z\s'-]*[A-Za-z]$|^[A-Za-z]$/.test(stripped)) {
    return null;
  }

  const tokens = stripped.split(/\s+/).filter(Boolean);
  if (!tokens.length || tokens.length > 4) return null;

  return {
    lemma: stripped.toLowerCase(),
    surface: stripped,
    tokens,
    isSingleWord: tokens.length === 1,
    isPhrase: tokens.length > 1,
  };
}

export function getTranslationSelectionType(
  value?: string | null,
): TranslationAssetKind {
  const text = normalizeHighlightQuote(value || "");
  if (/[.!?。！？]\s*$/.test(text) || /[.!?。！？]\s+/.test(text)) {
    return "sentence";
  }
  const normalized = normalizeWordSelection(text);
  if (normalized?.isSingleWord) return "word";
  if (normalized?.isPhrase) return "phrase";
  return "sentence";
}

export function getTranslationAssetKind(
  assetOrText?: TranslationAssetLike | string | null,
  translation?: TranslationResultLike | null,
): TranslationAssetKind {
  const explicit =
    typeof assetOrText === "object" && assetOrText ? assetOrText.kind : undefined;
  if (explicit === "word" || explicit === "phrase" || explicit === "sentence") {
    return explicit;
  }

  const isWord =
    typeof translation?.isWord === "boolean"
      ? translation.isWord
      : typeof assetOrText === "object" && assetOrText &&
          typeof assetOrText.isWord === "boolean"
        ? assetOrText.isWord
        : true;
  const text =
    typeof assetOrText === "object" && assetOrText
      ? assetOrText.lemma || assetOrText.quote || ""
      : assetOrText || "";
  if (!isWord) return "sentence";
  return normalizeWordSelection(text)?.isPhrase ? "phrase" : "word";
}

export function getTranslationAssetKey(
  selection?: TranslationSelectionLike | null,
  translation?: TranslationResultLike | null,
): string {
  const kind = getTranslationAssetKind(selection?.quote || "", translation);
  if (kind !== "sentence") {
    return (
      normalizeWordSelection(translation?.lemma || selection?.quote || "")?.lemma || ""
    );
  }

  const source = `${selection?.cfiRange || ""}|${selection?.quote || ""}`;
  let hash = 0;
  for (let index = 0; index < source.length; index += 1) {
    hash = (hash * 31 + source.charCodeAt(index)) >>> 0;
  }
  return `sentence-${hash.toString(36)}`;
}

export function getTranslationAssetStorageKey(
  asset?: TranslationAssetLike | null,
): string {
  if (!asset?.lemma) return "";
  if (getTranslationAssetKind(asset) === "sentence") return asset.lemma;
  return normalizeWordSelection(asset.lemma)?.lemma || asset.lemma;
}

export function getWordBlockId(lemma?: string | null): string {
  const normalized = normalizeWordSelection(lemma);
  const source = normalized ? normalized.lemma : String(lemma || "word").toLowerCase();
  const slug = source.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `jr-word-${slug || "word"}`;
}

export function normalizeWordDisplayText(value: unknown): string {
  return String(value || "")
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\n")
    .trim();
}

export function mergeStringList(
  existingList: string[] | null | undefined,
  nextValue?: string | null,
): string[] {
  const values = Array.isArray(existingList) ? [...existingList] : [];
  const candidate = (nextValue || "").trim();
  if (candidate && !values.includes(candidate)) values.push(candidate);
  return values.slice(0, 12);
}

export function isWordInflectionOf(surface?: string, lemma?: string): boolean {
  const word = String(surface || "").toLowerCase();
  const base = String(lemma || "").toLowerCase();
  if (!word || !base || word === base) return word === base;

  const variants = new Set([`${base}s`, `${base}es`, `${base}ed`, `${base}ing`]);
  if (base.endsWith("e")) {
    variants.add(`${base}s`);
    variants.add(`${base}d`);
    variants.add(`${base.slice(0, -1)}ing`);
  }
  if (base.endsWith("y") && !/[aeiou]y$/.test(base)) {
    variants.add(`${base.slice(0, -1)}ies`);
    variants.add(`${base.slice(0, -1)}ied`);
  }
  return variants.has(word);
}
