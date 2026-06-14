export interface UpstreamReaderSettings {
  scrolledView: boolean;
  singlePageView: boolean;
  readerZoom: number;
  readerLineHeight: number;
  bookNoteFolder: string;
  bookNoteTemplate: string;
  bookInitLocations: Record<string, string | number>;
  bookProgress: Record<string, import("../domain/reading.ts").BookProgress>;
  bookHighlights: Record<string, import("../domain/highlights.ts").BookHighlight[]>;
}

export const DEFAULT_UPSTREAM_SETTINGS: UpstreamReaderSettings = {
  scrolledView: false,
  singlePageView: false,
  readerZoom: 1,
  readerLineHeight: 1.6,
  bookNoteFolder: "",
  bookNoteTemplate: "",
  bookInitLocations: {},
  bookProgress: {},
  bookHighlights: {},
};
