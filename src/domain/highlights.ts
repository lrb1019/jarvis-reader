export interface BookHighlight {
  id: string;
  bookPath: string;
  bookTitle: string;
  chapterTitle: string;
  cfiRange: string;
  quote: string;
  comment: string;
  notePath: string;
  blockId: string;
  created: string;
  updated?: string;
}

export interface PersistedBookHighlight extends BookHighlight {
  updated: string;
}

export type BookHighlightsMap = Record<string, BookHighlight[]>;
export type PersistedBookHighlightsMap = Record<string, PersistedBookHighlight[]>;
