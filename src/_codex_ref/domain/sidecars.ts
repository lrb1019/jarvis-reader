import type { PersistedBookHighlightsMap } from "./highlights";
import type { WordAssetMap } from "./word-assets";

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
