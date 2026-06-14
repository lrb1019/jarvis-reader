import type { TranslationApiSettings, TranslationAssetKind } from "../domain/index.ts";
import {
  getTranslationSelectionType,
  normalizeWordDisplayText,
  normalizeWordSelection,
} from "../core/text.ts";

export interface TranslationResult {
  lemma: string;
  surface: string;
  translation: string;
  display: string;
  phonetic: string;
  partOfSpeech: string;
  example: string;
  isWord: boolean;
  sourceType: "local-dictionary" | "ai";
}

export function parseTranslationResponseText(text: string): Record<string, unknown> | null {
  const raw = String(text || "").trim();
  if (!raw) return null;
  for (const candidate of [
    raw,
    raw.match(/```(?:json)?\s*([\s\S]+?)```/i)?.[1],
    raw.match(/\{[\s\S]*\}/)?.[0],
  ]) {
    if (!candidate) continue;
    try {
      const parsed: unknown = JSON.parse(candidate.trim());
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Try the next supported response envelope.
    }
  }
  return null;
}

export function normalizeTranslationResult(
  selectedText: string,
  payload: Record<string, unknown>,
  selectionType: TranslationAssetKind = getTranslationSelectionType(selectedText),
  sourceType: TranslationResult["sourceType"] = "ai",
): TranslationResult {
  if (selectionType === "sentence") {
    const translation = String(payload.translation || payload.display || "").trim();
    return {
      lemma: "",
      surface: selectedText.trim(),
      translation,
      display: translation,
      phonetic: "",
      partOfSpeech: "",
      example: "",
      isWord: false,
      sourceType,
    };
  }
  const normalized = normalizeWordSelection(String(payload.lemma || selectedText));
  return {
    lemma: normalized?.lemma || "",
    surface: normalized?.surface || selectedText.trim(),
    translation: String(payload.translation || "").trim(),
    display: normalizeWordDisplayText(payload.display || payload.translation || ""),
    phonetic: String(payload.phonetic || "").trim(),
    partOfSpeech: String(payload.partOfSpeech || "").trim(),
    example: String(payload.example || "").trim(),
    isWord: payload.isWord !== false && Boolean(normalized),
    sourceType,
  };
}

export function buildTranslationPromptText(
  prompt: string,
  selectedText: string,
  sentence: string,
): string {
  const type = getTranslationSelectionType(selectedText);
  const context = sentence.trim() || selectedText.trim();
  const source = String(prompt || "");
  const result = source
    .replace(/\{\{\s*word\s*\}\}/g, selectedText.trim())
    .replace(/\{\{\s*text\s*\}\}/g, selectedText.trim())
    .replace(/\{\{\s*sentence\s*\}\}/g, context)
    .replace(/\{\{\s*selectionType\s*\}\}/g, type);
  return result === source
    ? `${result}\n\nSelected text: ${selectedText}\nSelection type: ${type}\nContext: ${context}`
    : result;
}

export function detectTranslationApiType(
  api: TranslationApiSettings,
): "openai-compatible" | "anthropic" | "gemini" {
  const baseUrl = api.baseUrl.toLowerCase();
  if (baseUrl.includes("anthropic")) return "anthropic";
  if (baseUrl.includes("googleapis") || baseUrl.includes("generativelanguage")) {
    return "gemini";
  }
  return api.provider === "anthropic" || api.provider === "gemini"
    ? api.provider
    : "openai-compatible";
}

export function buildTranslationEndpoint(api: TranslationApiSettings): string {
  const base = api.baseUrl.trim().replace(/\/+$/, "");
  if (!base) return "";
  switch (detectTranslationApiType(api)) {
    case "anthropic":
      return /\/messages$/i.test(base) ? base : `${base}/v1/messages`;
    case "gemini":
      return base.includes(":generateContent")
        ? `${base}${base.includes("?key=") ? "" : `${base.includes("?") ? "&" : "?"}key=${encodeURIComponent(api.apiKey)}`}`
        : `${base}/models/${encodeURIComponent(api.model)}:generateContent?key=${encodeURIComponent(api.apiKey)}`;
    default:
      return /\/chat\/completions$/i.test(base) ? base : `${base}/chat/completions`;
  }
}

export function extractTranslationResponseText(
  apiType: ReturnType<typeof detectTranslationApiType>,
  payload: unknown,
): string {
  const value = payload as Record<string, any>;
  if (apiType === "anthropic") {
    return Array.isArray(value?.content)
      ? value.content.map((part: any) => (typeof part?.text === "string" ? part.text : "")).join("\n")
      : "";
  }
  if (apiType === "gemini") {
    const parts = value?.candidates?.[0]?.content?.parts;
    return Array.isArray(parts)
      ? parts.map((part: any) => (typeof part?.text === "string" ? part.text : "")).join("\n")
      : "";
  }
  const content = value?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  return Array.isArray(content)
    ? content.map((part: any) => (typeof part === "string" ? part : part?.text || "")).join("\n")
    : "";
}
