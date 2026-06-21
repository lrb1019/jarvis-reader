// Extracted from main.js lines 48236-48738
// Translation API functions: prompt building, response parsing, structured display, API calls

import { requestUrl } from "obsidian";
import {
  normalizeWordSelection,
  getTranslationSelectionType,
  lookupLocalDictionary,
  TRANSLATION_PROVIDER_OPTIONS,
  DEFAULT_TRANSLATION_PROMPT,
  escapeRegExp,
} from "./word-assets";
import { normalizeHighlightQuote, normalizeWordDisplayText } from "./utils";
import type { JarvisReaderSettings, TranslationProvider } from "./types";

export function extractOpenAIMessageText(payload: any): string {
  var _a: any, _b: any, _c: any;
  const message = (_c = (_b = (_a = payload == null ? void 0 : payload.choices) == null ? void 0 : _a[0]) == null ? void 0 : _b.message) == null ? void 0 : _c.content;
  if (typeof message === "string") {
    return message;
  }
  if (Array.isArray(message)) {
    return message.map((part: any) => {
      if (typeof part === "string")
        return part;
      if (part && typeof part.text === "string")
        return part.text;
      return "";
    }).join("\n");
  }
  return "";
}

export function parseTranslationResponseText(text: string): any {
  const raw = (text || "").trim();
  if (!raw)
    return null;
  try {
    return JSON.parse(raw);
  } catch (error) {
  }
  const fenced = raw.match(/```json\s*([\s\S]+?)```/i) || raw.match(/```\s*([\s\S]+?)```/i);
  if (fenced && fenced[1]) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch (error) {
    }
  }
  const objectText = getFirstJsonObjectText(raw);
  if (objectText) {
    try {
      return JSON.parse(objectText);
    } catch (error) {
    }
  }
  return null;
}

export function looksLikeJsonObjectText(text: string): boolean {
  const raw = String(text || "").trim();
  return raw.startsWith("{") || /^```(?:json)?\s*\{/i.test(raw);
}

export function getFirstJsonObjectText(text: string): string {
  const source = String(text || "");
  for (let firstBrace = source.indexOf("{"); firstBrace >= 0; firstBrace = source.indexOf("{", firstBrace + 1)) {
    if (source[firstBrace + 1] === "{" || source[firstBrace - 1] === "{")
      continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = firstBrace; index < source.length; index++) {
      const char = source[index];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inString = !inString;
        continue;
      }
      if (inString)
        continue;
      if (char === "{") {
        depth++;
      } else if (char === "}") {
        depth--;
        if (depth === 0) {
          return source.slice(firstBrace, index + 1);
        }
      }
    }
    return source.slice(firstBrace);
  }
  return "";
}

export function validateTranslationPromptJsonTemplate(prompt: string): { ok: boolean; error: string } {
  const objectText = getFirstJsonObjectText(prompt);
  if (!objectText)
    return { ok: false, error: "未找到 JSON 示例。" };
  try {
    const parsed = JSON.parse(objectText);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, error: "提示词 JSON 示例必须是对象。" };
    }
    const requiredFields = ["lemma", "translation", "display", "isWord"];
    const missingFields = requiredFields.filter((field) => !(field in parsed));
    if (missingFields.length) {
      return { ok: false, error: `缺少必需字段：${missingFields.join("、")}` };
    }
    return { ok: true, error: "" };
  } catch (error: any) {
    return {
      ok: false,
      error: error && error.message ? error.message : "JSON 示例无效。"
    };
  }
}

export function pickLabeledValue(text: string, labels: string[]): string {
  const source = text || "";
  for (const label of labels) {
    const pattern = new RegExp(`^${escapeRegExp(label)}\\s*:?\\s*(.+)$`, "im");
    const match = source.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }
  return "";
}

export function pickLabeledBlock(text: string, label: string, nextLabels: string[] = []): string {
  const source = text || "";
  const next = nextLabels.length ? `|${nextLabels.map((item) => escapeRegExp(item)).join("|")}` : "";
  const pattern = new RegExp(`${escapeRegExp(label)}\\s*:?\\s*([\\s\\S]*?)(?=\\n\\s*(?:${nextLabels.map((item) => escapeRegExp(item)).join("|")})\\s*:?|$)`, "i");
  const match = source.match(pattern);
  return match && match[1] ? match[1].trim() : "";
}

export function parsePlainTranslationResponse(selectedText: string, text: string, selectionType: string = ""): any {
  const raw = (text || "").trim();
  if (!raw)
    return null;
  if (selectionType === "sentence") {
    return {
      lemma: "",
      translation: raw,
      phonetic: "",
      partOfSpeech: "",
      example: "",
      display: raw,
      isWord: false
    };
  }
  const normalized = normalizeWordSelection(pickLabeledValue(raw, ["Word"]) || selectedText || "");
  const ipaBlock = pickLabeledBlock(raw, "IPA", ["Part of speech", "Core meaning", "Chinese"]);
  const usIpa = pickLabeledValue(ipaBlock, ["US"]);
  const ukIpa = pickLabeledValue(ipaBlock, ["UK"]);
  const chinese = pickLabeledBlock(raw, "Chinese", ["Memory tip", "Common collocations", "Synonyms", "Example", "Pronunciation"]);
  const partOfSpeech = pickLabeledBlock(raw, "Part of speech", ["Core meaning", "Chinese", "Memory tip"]);
  const example = pickLabeledBlock(raw, "Example", ["Pronunciation"]);
  const firstChineseLine = raw.split(/\r?\n/).find((line: string) => /[\u4e00-\u9fff]/.test(line)) || "";
  return {
    lemma: normalized ? normalized.lemma : "",
    translation: chinese || firstChineseLine || raw.slice(0, 120),
    phonetic: usIpa || ukIpa || "",
    partOfSpeech,
    example,
    display: raw,
    isWord: !!normalized
  };
}

export function normalizeJsonString(value: any): string {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeJsonArray(value: any): any[] {
  return Array.isArray(value) ? value : [];
}

export function getPrimaryPosMeaning(payload: any): any {
  const meanings = normalizeJsonArray(payload == null ? void 0 : payload.pos_meanings);
  const first = meanings.find((item: any) => item && (normalizeJsonString(item.pos) || normalizeJsonString(item.meaning)));
  return first || null;
}

export function normalizeJsonExample(value: any): { en: string; zh: string } {
  if (typeof value === "string") {
    return {
      en: value.trim(),
      zh: ""
    };
  }
  if (value && typeof value === "object") {
    return {
      en: normalizeJsonString(value.en),
      zh: normalizeJsonString(value.zh)
    };
  }
  return {
    en: "",
    zh: ""
  };
}

export function buildStructuredWordDisplay(payload: any, lemma: string): string {
  if (!payload || typeof payload !== "object")
    return "";
  const lines: string[] = [];
  const word = normalizeJsonString(payload.lemma) || lemma || "";
  const phonetic = normalizeJsonString(payload.phonetic);
  const posMeanings = normalizeJsonArray(payload.pos_meanings);
  const example = normalizeJsonExample(payload.example);
  const collocations = normalizeJsonArray(payload.collocations);
  const derivatives = normalizeJsonArray(payload.derivatives);
  const etymology = normalizeJsonString(payload.etymology);
  const synonyms = normalizeJsonArray(payload.synonyms).map((item: any) => normalizeJsonString(item)).filter(Boolean);
  if (word || phonetic) {
    lines.push(`**${word}**${phonetic ? ` ${phonetic}` : ""}`.trim());
  }
  if (posMeanings.length) {
    lines.push("", "Part of speech / meaning");
    for (const item of posMeanings) {
      if (!item)
        continue;
      const pos = normalizeJsonString(item.pos);
      const meaning = normalizeJsonString(item.meaning);
      if (pos || meaning) {
        lines.push(`- ${pos ? `${pos}: ` : ""}${meaning}`.trim());
      }
    }
  }
  if (example.en || example.zh) {
    lines.push("", "Example");
    if (example.en)
      lines.push(`- ${example.en}`);
    if (example.zh)
      lines.push(`- ${example.zh}`);
  }
  if (collocations.length) {
    lines.push("", "Collocations");
    for (const item of collocations) {
      if (!item)
        continue;
      const phrase = normalizeJsonString(item.phrase);
      const zh = normalizeJsonString(item.zh);
      if (phrase || zh) {
        lines.push(`- ${phrase}${zh ? `: ${zh}` : ""}`);
      }
    }
  }
  if (derivatives.length) {
    lines.push("", "Derivatives");
    for (const item of derivatives) {
      if (!item)
        continue;
      const derivedWord = normalizeJsonString(item.word);
      const pos = normalizeJsonString(item.pos);
      const meaning = normalizeJsonString(item.meaning);
      if (derivedWord || pos || meaning) {
        lines.push(`- ${derivedWord}${pos ? ` (${pos})` : ""}${meaning ? `: ${meaning}` : ""}`);
      }
    }
  }
  if (etymology) {
    lines.push("", "Etymology", etymology);
  }
  if (synonyms.length) {
    lines.push("", "Synonyms", synonyms.join(", "));
  }
  return lines.join("\n").trim();
}

export function normalizeTranslationResult(selectedText: string, payload: any, selectionType: string = ""): any {
  if (selectionType === "sentence") {
    const translation = payload && typeof payload.translation === "string" ? payload.translation.trim() : normalizeWordDisplayText(payload && typeof payload.display === "string" ? payload.display : "");
    return {
      lemma: "",
      surface: (selectedText || "").trim(),
      translation,
      phonetic: "",
      partOfSpeech: "",
      example: "",
      display: translation,
      isWord: false
    };
  }
  const normalized = normalizeWordSelection((payload == null ? void 0 : payload.lemma) || selectedText || "");
  const primaryMeaning = getPrimaryPosMeaning(payload);
  const example = normalizeJsonExample(payload == null ? void 0 : payload.example);
  const translation = payload && typeof payload.translation === "string" ? payload.translation.trim() : normalizeJsonString(primaryMeaning == null ? void 0 : primaryMeaning.meaning);
  const display = normalizeWordDisplayText(payload && typeof payload.display === "string" ? payload.display : buildStructuredWordDisplay(payload, normalized ? normalized.lemma : ""));
  return {
    lemma: normalized ? normalized.lemma : "",
    surface: normalized ? normalized.surface : ((selectedText || "").trim()),
    translation,
    phonetic: payload && typeof payload.phonetic === "string" ? payload.phonetic.trim() : "",
    partOfSpeech: payload && typeof payload.partOfSpeech === "string" ? payload.partOfSpeech.trim() : normalizeJsonString(primaryMeaning == null ? void 0 : primaryMeaning.pos),
    example: example.en,
    display,
    isWord: payload && typeof payload.isWord === "boolean" ? payload.isWord : !!normalized
  };
}

export function normalizeTranslationProvider(value: string, baseUrl: string = ""): string {
  const lowered = String(baseUrl || "").toLowerCase();
  if (lowered.includes("anthropic"))
    return "anthropic";
  if (lowered.includes("googleapis") || lowered.includes("generativelanguage"))
    return "gemini";
  if (lowered.includes("deepseek")) return "deepseek";
  if (lowered.includes("bigmodel.cn") || lowered.includes("zhipu")) return "zhipu";
  if (lowered.includes("dashscope") || lowered.includes("qwen")) return "qwen";
  if (lowered.includes("moonshot") || lowered.includes("kimi")) return "moonshot";
  if (lowered.includes("minimax")) return "minimax";
  const provider = String(value || "").trim().toLowerCase();
  if (TRANSLATION_PROVIDER_OPTIONS.includes(provider)) {
    return provider;
  }
  return "openai-compatible";
}

export function detectTranslationApiType(settings: any = {}): string {
  const api = settings.translationApi || {};
  const lowered = String(api.baseUrl || "").toLowerCase();
  if (lowered.includes("anthropic"))
    return "anthropic";
  if (lowered.includes("googleapis") || lowered.includes("generativelanguage"))
    return "gemini";
  const provider = normalizeTranslationProvider(api.provider, api.baseUrl);
  if (provider !== "custom") {
    return provider;
  }
  return "openai-compatible";
}

export function getTranslationProviderDefaults(provider: string): { baseUrl: string; model: string } {
  const normalized = normalizeTranslationProvider(provider);
  switch (normalized) {
    case "anthropic":
      return {
        baseUrl: "https://api.deepseek.com/anthropic",
        model: "deepseek-v4-flash"
      };
    case "gemini":
      return {
        baseUrl: "https://generativelanguage.googleapis.com/v1beta",
        model: "gemini-1.5-flash"
      };
    case "deepseek":
      return {
        baseUrl: "https://api.deepseek.com/v1",
        model: "deepseek-chat"
      };
    case "zhipu":
      return {
        baseUrl: "https://open.bigmodel.cn/api/paas/v4",
        model: "glm-4-flash"
      };
    case "qwen":
      return {
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        model: "qwen-plus"
      };
    case "moonshot":
      return {
        baseUrl: "https://api.moonshot.cn/v1",
        model: "moonshot-v1-8k"
      };
    case "minimax":
      return {
        baseUrl: "https://api.minimax.chat/v1",
        model: "abab6.5s-chat"
      };
    case "custom":
      return {
        baseUrl: "",
        model: ""
      };
    case "openai-compatible":
    default:
      return {
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-4o-mini"
      };
  }
}

export function buildTranslationApiEndpoint(settings: any = {}): string {
  const api = settings.translationApi || {};
  const baseUrl = String(api.baseUrl || "").trim().replace(/\/+$/g, "");
  const model = String(api.model || "").trim();
  const apiKey = String(api.apiKey || "").trim();
  const apiType = detectTranslationApiType(settings);
  if (!baseUrl)
    return "";
  switch (apiType) {
    case "anthropic":
      return /\/messages$/i.test(baseUrl) ? baseUrl : `${baseUrl}/v1/messages`;
    case "gemini":
      if (baseUrl.includes(":generateContent")) {
        return baseUrl.includes("?key=") ? baseUrl : `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}key=${encodeURIComponent(apiKey)}`;
      }
      return `${baseUrl}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    case "openai-compatible":
    default:
      return /\/chat\/completions$/i.test(baseUrl) ? baseUrl : `${baseUrl}/chat/completions`;
  }
}

export function buildTranslationPromptText(prompt: string, selectedText: string, sentence: string = ""): string {
  const word = (selectedText || "").trim();
  const contextSentence = (sentence || selectedText || "").trim();
  const selectionType = getTranslationSelectionType(word);
  const sourcePrompt = String(prompt || "");
  const templated = sourcePrompt.replace(/\{\{\s*word\s*\}\}/g, word).replace(/\{\{\s*sentence\s*\}\}/g, contextSentence).replace(/\{\{\s*selectionType\s*\}\}/g, selectionType).replace(/\{\{\s*text\s*\}\}/g, word);
  if (templated !== sourcePrompt) {
    return templated;
  }
  return `${templated}\n\nSelected text: ${selectedText}\nSelection type: ${selectionType}\nContext: ${contextSentence}`;
}

export function extractAnthropicMessageText(payload: any): string {
  var _a: any;
  const content = (_a = payload == null ? void 0 : payload.content) != null ? _a : [];
  if (!Array.isArray(content))
    return "";
  return content.map((part: any) => part && typeof part.text === "string" ? part.text : "").join("\n").trim();
}

export function extractGeminiMessageText(payload: any): string {
  var _a: any, _b: any, _c: any, _d: any, _e: any;
  const parts = (_e = (_d = (_c = (_b = (_a = payload == null ? void 0 : payload.candidates) == null ? void 0 : _a[0]) == null ? void 0 : _b.content) == null ? void 0 : _c.parts) != null ? _d : []) != null ? _e : [];
  if (!Array.isArray(parts))
    return "";
  return parts.map((part: any) => part && typeof part.text === "string" ? part.text : "").join("\n").trim();
}

export async function translateSelectionWithApi(settings: any = {}, selectedText: string, sentence: string = "", app: any = null, options: any = {}): Promise<any> {
  const selectionType = getTranslationSelectionType(selectedText);
  if (options.localOnly) {
    return selectionType === "word" ? await lookupLocalDictionary(settings, selectedText, app) : null;
  }
  if (!options.forceAi) {
    if (selectionType === "word") {
      const dictionaryResult = await lookupLocalDictionary(settings, selectedText, app);
      if (dictionaryResult)
        return dictionaryResult;
    }
  }
  const api = settings.translationApi || {};
  const apiType = detectTranslationApiType(settings);
  const endpoint = buildTranslationApiEndpoint(settings);
  const apiKey = String(api.apiKey || "").trim();
  const model = String(api.model || "").trim();
  if (!endpoint || !apiKey || !model) {
    throw new Error("Translation API is not configured.");
  }
  const prompt = String(settings.translationPrompt || DEFAULT_TRANSLATION_PROMPT).trim() || DEFAULT_TRANSLATION_PROMPT;
  const requestText = buildTranslationPromptText(prompt, selectedText, sentence);
  let headers: Record<string, string> = {
    "Content-Type": "application/json"
  };
  let body: any = null;
  switch (apiType) {
    case "anthropic":
      headers = {
        ...headers,
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      };
      body = {
        model,
        max_tokens: 800,
        messages: [
          {
            role: "user",
            content: requestText
          }
        ]
      };
      break;
    case "gemini":
      body = {
        contents: [
          {
            parts: [
              {
                text: requestText
              }
            ]
          }
        ]
      };
      break;
    case "openai-compatible":
    default:
      headers = {
        ...headers,
        Authorization: `Bearer ${apiKey}`
      };
      body = {
        model,
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content: "Follow the user's formatting instructions exactly."
          },
          {
            role: "user",
            content: requestText
          }
        ]
      };
      break;
  }
  let payload: any = null;
  if (typeof requestUrl === "function") {
    const response = await requestUrl({
      url: endpoint,
      method: "POST",
      headers,
      body: JSON.stringify(body)
    });
    if (response.status >= 400) {
      throw new Error(((response.text || `HTTP ${response.status}`) + "").slice(0, 280));
    }
    payload = response.json;
  } else {
    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error((errorText || `HTTP ${response.status}`).slice(0, 280));
    }
    payload = await response.json();
  }
  const content = apiType === "anthropic" ? extractAnthropicMessageText(payload) : apiType === "gemini" ? extractGeminiMessageText(payload) : extractOpenAIMessageText(payload);
  const parsed = parseTranslationResponseText(content);
  if (!parsed && looksLikeJsonObjectText(content)) {
    throw new Error("翻译响应看起来是 JSON，但无法解析。请检查引号、逗号，以及 display 字段中的换行是否写成转义的 \\n。");
  }
  const fallbackParsed = parsed || parsePlainTranslationResponse(selectedText, content, selectionType);
  if (!fallbackParsed) {
    throw new Error("翻译响应为空。");
  }
  const result = normalizeTranslationResult(selectedText, fallbackParsed, selectionType);
  if (!result.translation) {
    throw new Error("翻译响应缺少 translation 字段。");
  }
  if (!result.display) {
    throw new Error("翻译响应缺少 display 字段。");
  }
  if (selectionType === "word") {
    const localMeta = await lookupLocalDictionary(settings, selectedText, app);
    if (localMeta) {
      if (localMeta.tags) result.tags = localMeta.tags;
      if (localMeta.collins) result.collins = localMeta.collins;
      if (localMeta.oxford) result.oxford = localMeta.oxford;
    }
  }
  return result;
}
