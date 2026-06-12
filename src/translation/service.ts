import type { JarvisReaderSettings } from "../domain/index.ts";
import { DEFAULT_TRANSLATION_PROMPT } from "../defaults.ts";
import { getTranslationSelectionType } from "../core/text.ts";
import { lookupEcdict, type DictionaryTextReader } from "./dictionary.ts";
import {
  buildTranslationEndpoint,
  buildTranslationPromptText,
  detectTranslationApiType,
  extractTranslationResponseText,
  normalizeTranslationResult,
  parseTranslationResponseText,
  type TranslationResult,
} from "./core.ts";

export interface TranslationHttpClient {
  post(input: { url: string; headers: Record<string, string>; body: unknown }): Promise<unknown>;
}

export async function translateSelection(
  settings: JarvisReaderSettings,
  selectedText: string,
  sentence: string,
  dictionary: DictionaryTextReader,
  http: TranslationHttpClient,
  forceAi = false,
  localOnly = false,
): Promise<TranslationResult> {
  const selectionType = getTranslationSelectionType(selectedText);
  if (!forceAi && selectionType === "word") {
    const local = await lookupEcdict(dictionary, selectedText);
    if (local) return local;
    if (localOnly) throw new Error("Local dictionary entry not found.");
  }
  if (localOnly) throw new Error("Local dictionary lookup only supports single words.");
  const api = settings.translationApi;
  const endpoint = buildTranslationEndpoint(api);
  if (!endpoint || !api.apiKey.trim() || !api.model.trim()) {
    throw new Error("Translation API is not configured.");
  }
  const apiType = detectTranslationApiType(api);
  const prompt = buildTranslationPromptText(
    settings.translationPrompt.trim() || DEFAULT_TRANSLATION_PROMPT,
    selectedText,
    sentence,
  );
  let headers: Record<string, string> = { "Content-Type": "application/json" };
  let body: unknown;
  if (apiType === "anthropic") {
    headers = { ...headers, "x-api-key": api.apiKey, "anthropic-version": "2023-06-01" };
    body = { model: api.model, max_tokens: 1000, messages: [{ role: "user", content: prompt }] };
  } else if (apiType === "gemini") {
    body = { contents: [{ parts: [{ text: prompt }] }] };
  } else {
    headers.Authorization = `Bearer ${api.apiKey}`;
    body = {
      model: api.model,
      temperature: 0.2,
      messages: [
        { role: "system", content: "Follow the user's formatting instructions exactly." },
        { role: "user", content: prompt },
      ],
    };
  }
  const payload = await http.post({ url: endpoint, headers, body });
  const content = extractTranslationResponseText(apiType, payload);
  const parsed = parseTranslationResponseText(content);
  if (!parsed) throw new Error("Translation response is not valid JSON.");
  const result = normalizeTranslationResult(selectedText, parsed, selectionType, "ai");
  if (!result.translation || !result.display) {
    throw new Error("Translation response is missing translation or display.");
  }
  return result;
}
