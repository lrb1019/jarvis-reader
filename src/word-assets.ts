// Extracted from main.js L47630–48235 — word-asset constants and functions

import type { TFile, App } from "obsidian";
import {
  normalizeVaultPath,
  joinVaultPath,
  formatLocalDate,
  sanitizeWordAssetFilename,
  ensureVaultFolder,
  escapeYamlString,
  normalizeHighlightQuote,
  normalizeWordDisplayText,
} from "./utils-core.ts";
import type {
  WordAsset,
  WordAssetSource,
  TranslationAssetKind,
  JarvisReaderSettings,
} from "./types";

// Re-export from utils for modules that import from word-assets
export { escapeRegExp } from "./utils-core.ts";

// --- Constants ---

export const JARVIS_WORD_NOTE_START = "<!-- jarvis-reader-word:start -->";
export const JARVIS_WORD_NOTE_END = "<!-- jarvis-reader-word:end -->";
export const TRANSLATION_PROVIDER_OPTIONS = ["openai-compatible", "anthropic", "gemini", "deepseek", "zhipu", "qwen", "moonshot", "minimax", "custom"];
export const BUILTIN_DICTIONARY_FOLDER = ".obsidian/plugins/jarvis-reader/dictionaries/ecdict";

export const DEFAULT_TRANSLATION_PROMPT = `你是 Obsidian 英语翻译与词句卡片生成器。
你必须只返回单行合法 JSON。
整个响应不能包含任何真实换行符。
不要 markdown 代码块。
不要解释。
不要输出 JSON 以外的任何文字。
Return ONLY valid JSON on a single line:
{"lemma":"{{word}}","translation":"文中对应的简洁中文释义或整句译文","display":"如果 selectionType 是 word 或 phrase：**词性** /音标/\\n\\n**英英释义**：优先写输入词或短语在上下文中的英文释义。\\n\\n**中文释义**：文中含义：结合原句语境解释。其他常见含义：简要列出；没有则写无。\\n\\n---\\n\\n**例句**：English example sentence matching the context meaning.\\n中文例句翻译。\\n\\n---\\n\\n**搭配**：common collocation\\n**派生**：common derivative if any\\n**词源**：简洁词源说明\\n**同义词**：synonym1, synonym2。如果 selectionType 是 sentence：只写自然中文译文，不要词性、音标、例句、搭配、派生、词源、同义词。","isWord":true}
规则：
1. 只返回单行 JSON，整个响应不能换行。
2. 必须包含且只需要包含：lemma、translation、display、isWord。
3. selectionType 为 word 或 phrase 时，按词句卡片结构输出：display 是唯一正文显示源，必须包含音标、词性、英英释义、中文释义、例句、搭配、派生、词源、同义词；isWord 必须是 true。
4. selectionType 为 sentence 时，只翻译整句：translation 写自然中文译文，display 也只写同一段中文译文；lemma 写空字符串；isWord 必须是 false；禁止输出词性、音标、例句、搭配、派生、词源、同义词。
5. 优先根据上下文判断输入词或短语在原句中的具体含义。word 或 phrase 的 display 必须先展示文中含义，再补充其他常见含义；translation 也优先写文中含义。
6. display 内换行只能写成 \\n，不能直接换行。
7. display 内双引号必须转义成 \\"。
8. word 或 phrase 的 display 内标签词必须加粗：**词性**、**英英释义**、**中文释义**、**例句**、**搭配**、**派生**、**词源**、**同义词**。
9. word 或 phrase 的 translation 只写简洁中文释义，不要写完整卡片。
10. word 的 lemma 必须是小写原形；phrase 的 lemma 写小写短语原形。
11. 如果没有常见派生或同义词，可以写"无"，不要编造。
12. display 内禁止重复堆叠输入词本身。
输入内容：{{word}}
选择类型：{{selectionType}}
上下文：{{sentence}}`;

export const TRANSLATION_PROMPT_HELP_TEXT = "必需字段：lemma、translation、display、isWord。word/phrase 输出词句卡片；sentence 只输出译文且 isWord=false。display 换行请写成 \\n。测试会先校验 JSON 示例。";

export const DEFAULT_WORD_AUDIO_TEMPLATE = "https://dict.youdao.com/dictvoice?audio={{word}}&type={{type}}";

// --- Module-level cache ---

const LOCAL_DICTIONARY_CACHE: Map<string, any> = new Map();

// --- Functions ---

export function normalizeWordSelection(value: string | null | undefined): {
  lemma: string;
  surface: string;
  tokens: string[];
  isSingleWord: boolean;
  isPhrase: boolean;
} | null {
  const cleaned = (value || "").replace(/[\u201c\u201d]/g, '"').replace(/[\u2018\u2019]/g, "'").replace(/[\u2013\u2014]/g, "-").replace(/\s+/g, " ").trim();
  if (!cleaned)
    return null;
  const stripped = cleaned.replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, "").replace(/\s+/g, " ").trim();
  if (!stripped || !/[A-Za-z]/.test(stripped))
    return null;
  if (!/^[A-Za-z][A-Za-z\s'-]*[A-Za-z]$|^[A-Za-z]$/.test(stripped))
    return null;
  const tokens = stripped.split(/\s+/).filter(Boolean);
  if (!tokens.length || tokens.length > 4)
    return null;
  return {
    lemma: stripped.toLowerCase(),
    surface: stripped,
    tokens,
    isSingleWord: tokens.length === 1,
    isPhrase: tokens.length > 1,
  };
}

export function getWordAudioType(accent: string | null | undefined): string {
  return String(accent || "us").toLowerCase() === "uk" ? "1" : "2";
}

export function buildWordAudioUrl(template: string, word: string, accent: string | null | undefined): string {
  const normalized = normalizeWordSelection(word);
  const cleanWord = normalized ? normalized.surface || normalized.lemma : String(word || "").trim();
  const cleanTemplate = String(template || "").trim();
  if (!cleanTemplate || !cleanWord)
    return "";
  const type = getWordAudioType(accent);
  return cleanTemplate.replace(/\{\{\s*word\s*\}\}/g, encodeURIComponent(cleanWord)).replace(/\{\{\s*type\s*\}\}/g, type).replace(/\{\{\s*accent\s*\}\}/g, accent || "us");
}

export function isEnglishWordCandidate(value: string | null | undefined): boolean {
  const normalized = normalizeWordSelection(value);
  return !!(normalized && (normalized.isSingleWord || normalized.isPhrase));
}

export function getTranslationSelectionType(value: string | null | undefined): "word" | "phrase" | "sentence" {
  const text = normalizeHighlightQuote(value || "");
  if (/[.!?。！？]\s*$/.test(text) || /[.!?。！？]\s+/.test(text))
    return "sentence";
  const normalized = normalizeWordSelection(text);
  if (normalized && normalized.isSingleWord)
    return "word";
  if (normalized && normalized.isPhrase)
    return "phrase";
  return "sentence";
}

export function getExperimentalTranslationSettings(settings: any = {}): {
  enabled: boolean;
  localDictionaryEnabled: boolean;
} {
  const experimental = settings.experimentalInstantTranslation && typeof settings.experimentalInstantTranslation === "object" ? settings.experimentalInstantTranslation : {};
  return {
    enabled: experimental.enabled === true,
    localDictionaryEnabled: true,
  };
}

export function getBuiltinDictionaryShardPath(word: string): string {
  const first = String(word || "").trim().charAt(0).toLowerCase();
  const shard = /^[a-z]$/.test(first) ? first : "_";
  return `${BUILTIN_DICTIONARY_FOLDER}/${shard}.json`;
}

export async function readJsonFromVault(app: App, path: string): Promise<any> {
  const adapter = app && app.vault ? app.vault.adapter : null;
  if (!adapter || typeof adapter.exists !== "function" || typeof adapter.read !== "function")
    return null;
  const normalizedPath = normalizeVaultPath(path || "");
  if (!normalizedPath || !await adapter.exists(normalizedPath))
    return null;
  if (LOCAL_DICTIONARY_CACHE.has(normalizedPath))
    return LOCAL_DICTIONARY_CACHE.get(normalizedPath);
  const payload = JSON.parse(await adapter.read(normalizedPath));
  LOCAL_DICTIONARY_CACHE.set(normalizedPath, payload);
  return payload;
}

export function getDictionaryLookupKeys(selectedText: string): string[] {
  const normalized = normalizeWordSelection(selectedText || "");
  if (!normalized || !normalized.isSingleWord)
    return [];
  const word = normalized.lemma;
  const keys = [word];
  if (word.endsWith("ies") && word.length > 3) {
    keys.push(`${word.slice(0, -3)}y`);
  } else if (word.endsWith("ied") && word.length > 3) {
    keys.push(`${word.slice(0, -3)}y`);
  } else if (word.endsWith("ing") && word.length > 4) {
    const stem = word.slice(0, -3);
    keys.push(stem);
    if (/([bcdfghjklmnpqrstvwxyz])\1$/i.test(stem))
      keys.push(stem.slice(0, -1));
    keys.push(`${stem}e`);
  } else if (word.endsWith("ed") && word.length > 3) {
    keys.push(word.slice(0, -2));
    keys.push(word.slice(0, -1));
  } else if (word.endsWith("es") && word.length > 3) {
    const withoutS = word.slice(0, -1);
    if (withoutS.endsWith("e"))
      keys.push(withoutS);
    else
      keys.push(word.slice(0, -2));
  } else if (word.endsWith("s") && word.length > 2) {
    keys.push(word.slice(0, -1));
  }
  return [...new Set(keys.filter(Boolean))];
}

export function normalizeDictionaryEntry(selectedText: string, key: string, entry: any): any {
  if (!entry)
    return null;
  const selected = normalizeWordSelection(selectedText || "");
  const lemma = String(key || (selected ? selected.lemma : selectedText || "")).trim().toLowerCase();
  if (typeof entry === "string") {
    const translation = entry.trim();
    if (!translation)
      return null;
    return {
      lemma,
      surface: selected ? selected.surface : selectedText,
      translation,
      phonetic: "",
      partOfSpeech: "",
      example: "",
      display: `**中文释义**：${translation}`,
      isWord: true,
      sourceType: "local-dictionary",
    };
  }
  if (entry && typeof entry === "object") {
    const translation = String(entry.translation || entry.meaning || entry.zh || "").trim();
    const phonetic = String(entry.phonetic || entry.uk || entry.us || "").trim();
    const partOfSpeech = String(entry.partOfSpeech || entry.pos || "").trim();
    const display = normalizeWordDisplayText(String(entry.display || "").trim() || [
      partOfSpeech || phonetic ? `**词性** ${partOfSpeech}${phonetic ? ` /${phonetic}/` : ""}`.trim() : "",
      translation ? `**中文释义**：${translation}` : "",
    ].filter(Boolean).join("\n\n"));
    if (!translation && !display)
      return null;
    return {
      lemma: String(entry.lemma || lemma).trim().toLowerCase(),
      surface: selected ? selected.surface : selectedText,
      translation: translation || display,
      phonetic,
      partOfSpeech,
      example: String(entry.example || "").trim(),
      display: display || translation,
      isWord: entry.isWord !== false,
      tags: Array.isArray(entry.tags) ? entry.tags : (typeof entry.tag === "string" ? entry.tag.split(" ") : []),
      collins: entry.collins,
      oxford: entry.oxford,
      sourceType: "local-dictionary",
    };
  }
  return null;
}

export async function lookupLocalDictionary(settings: any = {}, selectedText: string, app: App | null = null): Promise<any> {
  const experimental = getExperimentalTranslationSettings(settings);
  if (!experimental.localDictionaryEnabled || !app)
    return null;
  const keys = getDictionaryLookupKeys(selectedText);
  if (!keys.length)
    return null;
  for (const key of keys) {
    const dictionary = await readJsonFromVault(app, getBuiltinDictionaryShardPath(key));
    if (!dictionary || typeof dictionary !== "object")
      continue;
    const entry = dictionary[key] || dictionary[key.toLowerCase()] || dictionary[key.toUpperCase()];
    const result = normalizeDictionaryEntry(selectedText, key, entry);
    if (result)
      return result;
  }
  return null;
}









export function getTranslationAssetKind(assetOrText: any, translation: any = null): TranslationAssetKind {
  const explicit = assetOrText && typeof assetOrText === "object" ? assetOrText.kind : "";
  if (["word", "phrase", "sentence"].includes(explicit))
    return explicit as TranslationAssetKind;
  const isWord = translation && typeof translation.isWord === "boolean" ? translation.isWord : assetOrText && typeof assetOrText === "object" && typeof assetOrText.isWord === "boolean" ? assetOrText.isWord : true;
  const text = assetOrText && typeof assetOrText === "object" ? assetOrText.lemma || assetOrText.quote || "" : assetOrText || "";
  if (!isWord)
    return "sentence";
  const normalized = normalizeWordSelection(text || "");
  if (normalized && normalized.isPhrase)
    return "phrase";
  return "word";
}

export function getTranslationAssetKey(selection: any, translation: any): string {
  const kind = getTranslationAssetKind(selection?.quote || "", translation);
  if (kind !== "sentence") {
    const normalized = normalizeWordSelection(translation?.lemma || selection?.quote || "");
    return normalized ? normalized.lemma : "";
  }
  const source = `${selection?.cfiRange || ""}|${selection?.quote || ""}`;
  let hash = 0;
  for (let index = 0; index < source.length; index++) {
    hash = (hash * 31 + source.charCodeAt(index)) >>> 0;
  }
  return `sentence-${hash.toString(36)}`;
}

export function getTranslationAssetStorageKey(asset: any): string {
  if (!asset || !asset.lemma)
    return "";
  if (getTranslationAssetKind(asset) === "sentence")
    return asset.lemma;
  const normalized = normalizeWordSelection(asset.lemma || "");
  return normalized ? normalized.lemma : asset.lemma;
}





















export function mergeWordSources(existingSources: WordAssetSource[] | undefined, nextSource: WordAssetSource | null): WordAssetSource[] {
  const list = Array.isArray(existingSources) ? [...existingSources] : [];
  if (list.length) {
    return list.slice(0, 1);
  }
  const source = nextSource || null;
  if (!source)
    return list;
  return [source];
}

export function mergeStringList(existingList: string[] | undefined, nextValue: string | undefined): string[] {
  const values = Array.isArray(existingList) ? [...existingList] : [];
  const candidate = (nextValue || "").trim();
  if (candidate && !values.includes(candidate)) {
    values.push(candidate);
  }
  return values.slice(0, 12);
}

export function getWordAssetSurfaceForms(asset: any): string[] {
  if (!asset)
    return [];
  const candidates = [asset.lemma, ...Array.isArray(asset.surfaceForms) ? asset.surfaceForms : [], ...Array.isArray(asset.sources) ? asset.sources.map((source: any) => source?.quote) : []];
  const forms: string[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const normalized = normalizeWordSelection(candidate || "");
    if (!normalized)
      continue;
    const key = normalized.surface.toLowerCase();
    if (seen.has(key))
      continue;
    seen.add(key);
    forms.push(normalized.surface);
  }
  return forms;
}

export function isWordInflectionOf(surface: string, lemma: string): boolean {
  const word = String(surface || "").toLowerCase();
  const base = String(lemma || "").toLowerCase();
  if (!word || !base || word === base)
    return word === base;
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

export function findWordAssetBySurface(assetsMap: Record<string, any>, value: string): any {
  const normalized = normalizeWordSelection(value || "");
  if (!normalized || !assetsMap)
    return null;
  const direct = assetsMap[normalized.lemma];
  if (direct)
    return direct;
  const target = normalized.surface.toLowerCase();
  return Object.values(assetsMap).find((asset: any) => getTranslationAssetKind(asset) !== "sentence" && (getWordAssetSurfaceForms(asset).some((form: string) => form.toLowerCase() === target) || isWordInflectionOf(target, asset?.lemma))) || null;
}

export function buildWordAssetFromSelection(file: TFile, selection: any, translation: any, existingAsset: any = null, settings: any = {}): WordAsset | null {
  const kind = getTranslationAssetKind(selection?.quote || "", translation);
  const normalized = kind === "sentence" ? null : normalizeWordSelection(translation?.lemma || selection?.quote || "");
  const assetKey = kind === "sentence" ? getTranslationAssetKey(selection, translation) : normalized?.lemma || "";
  if (!assetKey || kind !== "sentence" && !normalized)
    return null;
  const selectedSurface = normalizeWordSelection(selection?.quote || "");
  const now = new Date().toISOString();
  const quote = normalizeHighlightQuote(selection?.quote || "");
  const title = kind === "sentence" ? quote : normalized?.surface || assetKey;
  const source: WordAssetSource = {
    bookPath: file.path,
    bookTitle: file.basename,
    chapterTitle: selection?.chapterTitle || file.basename,
    cfiRange: selection?.cfiRange || "",
    quote,
    created: now,
  };
  const asset: WordAsset = {
    lemma: assetKey,
    title,
    kind,
    isWord: kind !== "sentence",
    surfaceForms: kind === "sentence" ? [] : mergeStringList(mergeStringList(existingAsset?.surfaceForms, normalized!.surface), selectedSurface?.surface),
    translation: (translation?.translation || existingAsset?.translation || "").trim(),
    phonetic: (translation?.phonetic || existingAsset?.phonetic || "").trim(),
    partOfSpeech: (translation?.partOfSpeech || existingAsset?.partOfSpeech || "").trim(),
    example: (translation?.example || existingAsset?.example || "").trim(),
    display: (translation?.display || existingAsset?.display || "").trim(),
    tags: translation?.tags || existingAsset?.tags,
    collins: translation?.collins || existingAsset?.collins,
    oxford: translation?.oxford || existingAsset?.oxford,
    mastered: !!existingAsset?.mastered,
    sources: mergeWordSources(existingAsset?.sources, source),
    created: existingAsset?.created || now,
    updated: now,
  };
  return asset;
}
export function buildWordAssetMetadata(asset: any): WordAsset {
  return {
    lemma: asset.lemma || "",
    title: asset.title || "",
    kind: getTranslationAssetKind(asset),
    isWord: asset.isWord !== false && getTranslationAssetKind(asset) !== "sentence",
    surfaceForms: Array.isArray(asset.surfaceForms) ? asset.surfaceForms : [],
    translation: asset.translation || "",
    display: asset.display || "",
    phonetic: asset.phonetic || "",
    partOfSpeech: asset.partOfSpeech || "",
    example: asset.example || "",
    tags: asset.tags,
    collins: asset.collins,
    oxford: asset.oxford,
    mastered: !!asset.mastered,
    sources: Array.isArray(asset.sources) ? asset.sources : [],
    nextReviewDate: asset.nextReviewDate,
    interval: asset.interval,
    ease: asset.ease,
    reviews: asset.reviews,
    reviewTimeMs: asset.reviewTimeMs,
    created: asset.created || "",
    updated: asset.updated || "",
  };
}
