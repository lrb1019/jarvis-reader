import type { JarvisReaderSettings, WordAsset } from "../src/domain/index.ts";
import type {
  SettingsDataStore,
  TextFileStore,
} from "../src/storage/contracts.ts";

export function createSettings(): JarvisReaderSettings {
  return {
    scrolledView: false,
    singlePageView: false,
    readerZoom: 1,
    readerLineHeight: 1.6,
    bookNoteFolder: "",
    bookNoteTemplate: "",
    wordNoteFolder: "09 Books/Words",
    wordAssets: {},
    translationApi: {
      provider: "openai-compatible",
      baseUrl: "",
      apiKey: "",
      model: "",
    },
    experimentalInstantTranslation: { enabled: false },
    translationPrompt: "prompt",
    autoHighlightFolders: ["09 Books"],
    enableWordAudio: true,
    wordAudioTemplate: "https://example.test/{{word}}",
    wordAudioAccent: "us",
    blurWordCardBody: true,
    speechLang: "en-US",
    bookInitLocations: {},
    bookHighlights: {},
    bookProgress: {},
    bookCoverCache: {},
    sidebarLayoutMode: "single",
    sidebarPaneSplit: 48,
    bookshelfCoverOnly: false,
  };
}

export function createWordAsset(lemma = "compound"): WordAsset {
  return {
    lemma,
    title: lemma,
    kind: "word",
    isWord: true,
    surfaceForms: [lemma],
    translation: "积累",
    display: "**中文释义**：积累",
    phonetic: "",
    partOfSpeech: "",
    example: "",
    notePath: "09 Books/Words/Book.md",
    blockId: `jr-word-${lemma}`,
    mastered: false,
    sources: [],
    created: "2026-06-12T00:00:00.000Z",
    updated: "2026-06-12T00:00:00.000Z",
  };
}

export class MemoryTextFileStore implements TextFileStore {
  readonly files = new Map<string, string>();
  readonly folders = new Set<string>();
  failWritePath = "";

  async exists(path: string): Promise<boolean> {
    return this.files.has(path) || this.folders.has(path);
  }

  async read(path: string): Promise<string> {
    const value = this.files.get(path);
    if (value === undefined) throw new Error(`Missing file: ${path}`);
    return value;
  }

  async write(path: string, content: string): Promise<void> {
    if (path === this.failWritePath) throw new Error(`Write failed: ${path}`);
    this.files.set(path, content);
  }

  async mkdir(path: string): Promise<void> {
    this.folders.add(path);
  }
}

export class MemorySettingsStore implements SettingsDataStore {
  saved: unknown = undefined;
  private readonly loaded: unknown;

  constructor(loaded: unknown) {
    this.loaded = loaded;
  }

  async loadData(): Promise<unknown> {
    return this.loaded;
  }

  async saveData(data: unknown): Promise<void> {
    this.saved = data;
  }
}
