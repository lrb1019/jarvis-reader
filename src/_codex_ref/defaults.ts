import type { JarvisReaderSettings } from "./domain/index.ts";

export const DEFAULT_TRANSLATION_PROMPT = `Return ONLY valid JSON on one line:
{"lemma":"{{word}}","translation":"contextual Chinese meaning","display":"formatted card text","isWord":true}
Selection type: {{selectionType}}
Context: {{sentence}}
For sentence selections, lemma must be empty, display must equal the natural Chinese translation, and isWord must be false.`;

export const DEFAULT_SETTINGS: JarvisReaderSettings = {
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
  translationPrompt: DEFAULT_TRANSLATION_PROMPT,
  autoHighlightFolders: ["09 Books"],
  enableWordAudio: true,
  wordAudioTemplate: "https://dict.youdao.com/dictvoice?audio={{word}}&type={{type}}",
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
