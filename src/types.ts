// Shared type definitions for Jarvis Reader
// Sourced from main.js runtime shapes, verified against stable DEFAULT_SETTINGS (L52776-52808)

// --- Highlight types ---

export const HIGHLIGHT_COLORS = ["yellow", "green", "blue", "pink", "purple"] as const;

export type HighlightColor = (typeof HIGHLIGHT_COLORS)[number];

export interface BookHighlight {
  id: string;
  bookPath: string;
  bookTitle: string;
  chapterTitle: string;
  cfiRange: string;
  quote: string;
  comment: string;
  markColor?: HighlightColor;
  notePath: string;
  blockId: string;
  created: string;
  updated?: string;
}

export interface PersistedBookHighlight {
  id: string;
  bookPath: string;
  bookTitle: string;
  chapterTitle: string;
  cfiRange: string;
  markColor?: HighlightColor;
  notePath: string;
  blockId: string;
  updated: string;
  created: string;
}

export type BookHighlightsMap = Record<string, BookHighlight[]>;
export type PersistedBookHighlightsMap = Record<string, PersistedBookHighlight[]>;

// --- Word asset types ---

export type TranslationAssetKind = "word" | "phrase" | "sentence";

export interface WordAssetSource {
  bookPath: string;
  bookTitle: string;
  chapterTitle: string;
  cfiRange: string;
  quote: string;
  sentence?: string;
  created: string;
}

export interface WordAsset {
  lemma: string;
  title: string;
  kind: TranslationAssetKind;
  isWord: boolean;
  surfaceForms: string[];
  translation: string;
  display: string;
  phonetic: string;
  partOfSpeech: string;
  example: string;
  mastered: boolean;
  sources: WordAssetSource[];
  created: string;
  updated: string;
  tags?: string[];
  collins?: number;
  oxford?: number;
  // Anki-style review fields (optional for now)
  nextReviewDate?: string;
  interval?: number;
  ease?: number;
  reviews?: number;
  reviewTimeMs?: number;
  pos?: string;
}

export type WordAssetMap = Record<string, WordAsset>;

// --- Reading / progress types ---

export interface ReaderPagePosition {
  page: number;
  total: number;
}

export interface BookProgress {
  percentage: number;
  href: string;
  updated: string;
  page: number | null;
  total: number | null;
  chapterPage: ReaderPagePosition | null;
  bookPage: ReaderPagePosition | null;
  label: string;
  chapterTitle: string;
}

export interface BookCoverCacheEntry {
  dataUrl: string;
  updated: string;
}

export type BookLocations = Record<string, string | number>;
export type BookProgressMap = Record<string, BookProgress>;
export type BookCoverCache = Record<string, BookCoverCacheEntry>;

export interface DailyReadingStat {
  [bookPath: string]: number;
}
export type ReadingStatsMap = Record<string, DailyReadingStat>;

export interface DailyWordReviewStat {
  reviewCount: number;
  reviewTimeMs: number;
}
export type WordReviewStatsMap = Record<string, DailyWordReviewStat>;

export interface BookBookmark {
  cfi: string;
  title: string;
  created: number;
}
export type BookBookmarksMap = Record<string, BookBookmark[]>;

// --- Sidecar types ---

export interface HighlightSidecar {
  version: 1;
  updated: string;
  bookHighlights: PersistedBookHighlightsMap;
}

export interface WordAssetSidecar {
  version: 2;
  updated: string;
  wordAssets: WordAssetMap;
}

export interface IndexChangeLogEntry {
  time: string;
  reason: string;
  highlightCount: number;
  wordAssetCount: number;
}

// --- Settings types ---

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
  knowledgeNoteFolder: string;
  bookNoteTemplate: string;
  customCoverFolder: string;
  wordAssets: WordAssetMap;
  translationApi: TranslationApiSettings;
  translationPrompt: string;
  enableAutoHighlight: boolean;
  enableWordAudio: boolean;
  wordAudioTemplate: string;
  wordAudioAccent: WordAudioAccent;
  blurWordCardBody: boolean;
  speechLang: string;
  bookInitLocations: BookLocations;
  bookHighlights: BookHighlightsMap;
  bookProgress: BookProgressMap;
  bookBookmarks: BookBookmarksMap;
  bookCoverCache: BookCoverCache;
  sidebarLayoutMode: SidebarLayoutMode;
  sidebarPaneSplit: number;
  bookshelfCoverOnly: boolean;
  highlightColors: Record<string, string>;
  enableGlobalMarkdownTranslation: boolean;
  readingStats?: ReadingStatsMap;
  wordReviewStats?: WordReviewStatsMap;
  sm2StartingEase: number;
  sm2EasyBonus: number;
  sm2LapseMultiplier: number;
  sm2MaxInterval: number;
}

export type LoadedSettingsData = Partial<JarvisReaderSettings> &
  Record<string, unknown>;

export type PersistedSettingsData = Omit<JarvisReaderSettings, "wordAssets" | "bookHighlights">;
