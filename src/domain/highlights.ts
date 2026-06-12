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

export interface PersistedBookHighlight extends BookHighlight {
  updated: string;
}

export type BookHighlightsMap = Record<string, BookHighlight[]>;
export type PersistedBookHighlightsMap = Record<string, PersistedBookHighlight[]>;
