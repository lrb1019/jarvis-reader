import type { WordAudioAccent } from "../domain/index.ts";
import { normalizeWordSelection } from "./text.ts";

export interface WordAudioOptions {
  enabled: boolean;
  template: string;
  accent: WordAudioAccent;
  speechLang: string;
}

export function buildWordAudioUrl(
  template: string,
  text: string,
  accent: WordAudioAccent,
): string {
  const normalized = normalizeWordSelection(text);
  const cleanText = normalized?.surface || normalized?.lemma || String(text || "").trim();
  const cleanTemplate = String(template || "").trim();
  if (!cleanTemplate || !cleanText) return "";
  const type = accent === "uk" ? "1" : "2";
  return cleanTemplate
    .replace(/\{\{\s*word\s*\}\}/g, encodeURIComponent(cleanText))
    .replace(/\{\{\s*type\s*\}\}/g, type)
    .replace(/\{\{\s*accent\s*\}\}/g, accent);
}

function speakWithBrowser(text: string, options: WordAudioOptions): void {
  if (typeof speechSynthesis === "undefined") return;
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = options.speechLang || (options.accent === "uk" ? "en-GB" : "en-US");
  utterance.rate = 0.92;
  speechSynthesis.speak(utterance);
}

export function playWordAudio(text: string, options: WordAudioOptions): void {
  const cleanText = String(text || "").trim();
  if (!options.enabled || !cleanText) return;
  const url = buildWordAudioUrl(options.template, cleanText, options.accent);
  if (!url) {
    speakWithBrowser(cleanText, options);
    return;
  }
  try {
    const audio = new Audio(url);
    void audio.play().catch(() => speakWithBrowser(cleanText, options));
  } catch {
    speakWithBrowser(cleanText, options);
  }
}

export function stopWordAudio(): void {
  if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
}
