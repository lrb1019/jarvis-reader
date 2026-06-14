import type {
  BookCoverCache,
  BookLocations,
  BookProgressMap,
} from "./reading";
import type { BookHighlightsMap } from "./highlights";
import type { WordAssetMap } from "./word-assets";

export type TranslationProvider =
  | "openai-compatible"
  | "anthropic"
  | "gemini"
  | "custom";

export interface TranslationApiSettings {
  provider: TranslationProvider;
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface InstantTranslationSettings {
  enabled: boolean;
}

export type WordAudioAccent = "us" | "uk";
export type SidebarLayoutMode = "single" | "dual";

export interface JarvisReaderSettings {
  scrolledView: boolean;
  singlePageView: boolean;
  readerZoom: number;
  readerLineHeight: number;
  bookNoteFolder: string;
  bookNoteTemplate: string;
  wordNoteFolder: string;
  wordAssets: WordAssetMap;
  translationApi: TranslationApiSettings;
  experimentalInstantTranslation: InstantTranslationSettings;
  translationPrompt: string;
  autoHighlightFolders: string[];
  enableWordAudio: boolean;
  wordAudioTemplate: string;
  wordAudioAccent: WordAudioAccent;
  blurWordCardBody: boolean;
  speechLang: string;
  bookInitLocations: BookLocations;
  bookHighlights: BookHighlightsMap;
  bookProgress: BookProgressMap;
  bookCoverCache: BookCoverCache;
  sidebarLayoutMode: SidebarLayoutMode;
  sidebarPaneSplit: number;
  bookshelfCoverOnly: boolean;
}

// loadData may contain obsolete keys. Runtime normalization decides which keys survive.
export type LoadedSettingsData = Partial<JarvisReaderSettings> &
  Record<string, unknown>;

// wordAssets is persisted only in index/word-assets.json, never in data.json.
export type PersistedSettingsData = Omit<JarvisReaderSettings, "wordAssets">;
