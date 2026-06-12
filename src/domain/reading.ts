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
