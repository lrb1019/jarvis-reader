import { normalizeWordDisplayText, normalizeWordSelection } from "../core/text.ts";
import type { TranslationResult } from "./core.ts";

export const ECDICT_ROOT = ".obsidian/plugins/jarvis-reader/dictionaries/ecdict";

export interface DictionaryTextReader {
  read(path: string): Promise<string>;
}

export function getDictionaryLookupKeys(value: string): string[] {
  const normalized = normalizeWordSelection(value);
  if (!normalized?.isSingleWord) return [];
  const word = normalized.lemma;
  const keys = [word];
  if (word.endsWith("ies") || word.endsWith("ied")) keys.push(`${word.slice(0, -3)}y`);
  if (word.endsWith("ing") && word.length > 4) {
    keys.push(word.slice(0, -3), `${word.slice(0, -3)}e`);
  }
  if (word.endsWith("ed") && word.length > 3) keys.push(word.slice(0, -2), word.slice(0, -1));
  if (word.endsWith("es") && word.length > 3) keys.push(word.slice(0, -2));
  if (word.endsWith("s") && word.length > 2) keys.push(word.slice(0, -1));
  return [...new Set(keys.filter(Boolean))];
}

export function normalizeDictionaryEntry(
  selectedText: string,
  key: string,
  entry: unknown,
): TranslationResult | null {
  if (!entry) return null;
  const normalized = normalizeWordSelection(selectedText);
  if (typeof entry === "string") {
    const translation = entry.trim();
    if (!translation) return null;
    return {
      lemma: key,
      surface: normalized?.surface || selectedText,
      translation,
      display: `**中文释义**：${translation}`,
      phonetic: "",
      partOfSpeech: "",
      example: "",
      isWord: true,
      sourceType: "local-dictionary",
    };
  }
  if (typeof entry !== "object" || Array.isArray(entry)) return null;
  const value = entry as Record<string, unknown>;
  const translation = String(value.translation || value.meaning || value.zh || "").trim();
  const display = normalizeWordDisplayText(value.display || translation);
  if (!translation && !display) return null;
  return {
    lemma: String(value.lemma || key).trim().toLowerCase(),
    surface: normalized?.surface || selectedText,
    translation: translation || display,
    display,
    phonetic: String(value.phonetic || value.uk || value.us || "").trim(),
    partOfSpeech: String(value.partOfSpeech || value.pos || "").trim(),
    example: String(value.example || "").trim(),
    isWord: value.isWord !== false,
    sourceType: "local-dictionary",
  };
}

export async function lookupEcdict(
  reader: DictionaryTextReader,
  selectedText: string,
): Promise<TranslationResult | null> {
  for (const key of getDictionaryLookupKeys(selectedText)) {
    const initial = key[0];
    if (!initial || !/[a-z]/.test(initial)) continue;
    let dictionary: Record<string, unknown>;
    try {
      dictionary = JSON.parse(await reader.read(`${ECDICT_ROOT}/${initial}.json`));
    } catch {
      continue;
    }
    const result = normalizeDictionaryEntry(selectedText, key, dictionary[key]);
    if (result) return result;
  }
  return null;
}
