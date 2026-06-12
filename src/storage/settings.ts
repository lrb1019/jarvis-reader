import type {
  JarvisReaderSettings,
  LoadedSettingsData,
  PersistedSettingsData,
  TranslationProvider,
} from "../domain";
import { normalizeStoragePath, type SettingsDataStore } from "./contracts.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recordOr<T extends object>(value: unknown, fallback: T): T {
  return (isRecord(value) ? value : fallback) as T;
}

function normalizeProvider(value: unknown, baseUrl: unknown): TranslationProvider {
  const lowered = String(baseUrl || "").toLowerCase();
  if (lowered.includes("anthropic")) return "anthropic";
  if (lowered.includes("googleapis") || lowered.includes("generativelanguage")) {
    return "gemini";
  }
  return value === "anthropic" ||
    value === "gemini" ||
    value === "custom" ||
    value === "openai-compatible"
    ? value
    : "openai-compatible";
}

export function normalizeSettings(
  loaded: unknown,
  defaults: JarvisReaderSettings,
): JarvisReaderSettings {
  const raw: LoadedSettingsData = isRecord(loaded) ? loaded : {};
  const api = recordOr(raw.translationApi, defaults.translationApi);
  const instant = recordOr(
    raw.experimentalInstantTranslation,
    defaults.experimentalInstantTranslation,
  );
  const split = Number.parseFloat(String(raw.sidebarPaneSplit ?? defaults.sidebarPaneSplit));

  return {
    scrolledView: raw.scrolledView === true,
    singlePageView: raw.singlePageView === true,
    readerZoom: Number(raw.readerZoom ?? defaults.readerZoom),
    readerLineHeight: Number(raw.readerLineHeight ?? defaults.readerLineHeight),
    bookNoteFolder: normalizeStoragePath(String(raw.bookNoteFolder || "")),
    bookNoteTemplate: String(raw.bookNoteTemplate || ""),
    wordNoteFolder: normalizeStoragePath(
      String(raw.wordNoteFolder || defaults.wordNoteFolder),
    ),
    wordAssets: {},
    translationApi: {
      provider: normalizeProvider(api.provider, api.baseUrl),
      baseUrl: String(api.baseUrl || ""),
      apiKey: String(api.apiKey || ""),
      model: String(api.model || ""),
    },
    experimentalInstantTranslation: { enabled: instant.enabled === true },
    translationPrompt: String(raw.translationPrompt || defaults.translationPrompt),
    autoHighlightFolders: Array.isArray(raw.autoHighlightFolders)
      ? raw.autoHighlightFolders
          .map((folder) => normalizeStoragePath(String(folder)))
          .filter(Boolean)
      : [...defaults.autoHighlightFolders],
    enableWordAudio: raw.enableWordAudio !== false,
    wordAudioTemplate: String(raw.wordAudioTemplate || defaults.wordAudioTemplate),
    wordAudioAccent:
      String(raw.wordAudioAccent || defaults.wordAudioAccent).toLowerCase() === "uk"
        ? "uk"
        : "us",
    blurWordCardBody: raw.blurWordCardBody !== false,
    speechLang: String(raw.speechLang || defaults.speechLang),
    bookInitLocations: recordOr(raw.bookInitLocations, {}),
    bookHighlights: recordOr(raw.bookHighlights, {}),
    bookProgress: recordOr(raw.bookProgress, {}),
    bookCoverCache: recordOr(raw.bookCoverCache, {}),
    sidebarLayoutMode: raw.sidebarLayoutMode === "dual" ? "dual" : "single",
    sidebarPaneSplit: Number.isFinite(split) ? Math.min(75, Math.max(25, split)) : 48,
    bookshelfCoverOnly: Boolean(raw.bookshelfCoverOnly),
  };
}

export function toPersistedSettings(
  settings: JarvisReaderSettings,
): PersistedSettingsData {
  const { wordAssets: _wordAssets, ...persisted } = settings;
  return persisted;
}

export async function loadSettings(
  store: SettingsDataStore,
  defaults: JarvisReaderSettings,
): Promise<JarvisReaderSettings> {
  return normalizeSettings(await store.loadData(), defaults);
}

export async function saveSettings(
  store: SettingsDataStore,
  settings: JarvisReaderSettings,
): Promise<void> {
  await store.saveData(toPersistedSettings(settings));
}
