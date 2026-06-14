export type TranslationAssetKind = "word" | "phrase" | "sentence";

export interface WordAssetSource {
  bookPath: string;
  bookTitle: string;
  chapterTitle: string;
  cfiRange: string;
  quote: string;
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
  notePath: string;
  blockId: string;
  mastered: boolean;
  sources: WordAssetSource[];
  created: string;
  updated: string;
}

export type WordAssetMap = Record<string, WordAsset>;
