export interface ConflictFileSet {
  wordAssets: string[];
  highlights: string[];
  settings: string[];
}

export interface ReadingStats {
  [date: string]: Record<string, number>;
}

export interface ReviewStats {
  [date: string]: {
    reviewCount?: number;
    reviewTimeMs?: number;
  };
}

export interface ProgressMap {
  [bookPath: string]: Record<string, unknown> & { updated?: string };
}

export interface SettingsConflictState {
  readingStats: ReadingStats;
  wordReviewStats: ReviewStats;
  bookProgress: ProgressMap;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function classifyConflictFiles(indexFiles: string[], rootFiles: string[]): ConflictFileSet {
  return {
    wordAssets: indexFiles.filter((path) => /word-assets[- (].*\.json$/i.test(path) && !path.endsWith("word-assets.json")),
    highlights: indexFiles.filter((path) => /highlights[- (].*\.json$/i.test(path) && !path.endsWith("highlights.json")),
    settings: rootFiles.filter((path) => /data[- (].*\.json$/i.test(path) && !path.endsWith("data.json")),
  };
}

export function hasConflictFiles(files: ConflictFileSet): boolean {
  return files.wordAssets.length + files.highlights.length + files.settings.length > 0;
}

export function mergeWordAssetPayload(currentAssets: Record<string, unknown>, payload: unknown): Record<string, unknown> | null {
  if (!isRecord(payload) || !isRecord(payload.wordAssets)) return null;
  const next = structuredClone(currentAssets);

  for (const [key, incomingValue] of Object.entries(payload.wordAssets)) {
    if (!isRecord(incomingValue)) return null;
    const incoming = structuredClone(incomingValue);
    const currentValue = next[key];
    if (!isRecord(currentValue)) {
      next[key] = incoming;
      continue;
    }

    const current = structuredClone(currentValue);
    const currentSources = Array.isArray(current.sources) ? current.sources.filter(isRecord) : [];
    const incomingSources = Array.isArray(incoming.sources) ? incoming.sources.filter(isRecord) : [];
    const mergedSources = [...currentSources];
    for (const source of incomingSources) {
      const exists = mergedSources.some((saved) => saved.bookPath === source.bookPath && saved.cfiRange === source.cfiRange);
      if (!exists) mergedSources.push(source);
    }

    const currentTime = new Date(String(current.updated || current.created || 0)).getTime();
    const incomingTime = new Date(String(incoming.updated || incoming.created || 0)).getTime();
    const useIncoming = Number.isFinite(incomingTime) && (!Number.isFinite(currentTime) || incomingTime > currentTime);
    const merged = useIncoming ? { ...current, ...incoming } : current;
    merged.sources = mergedSources;
    next[key] = merged;
  }

  return next;
}

const HIGHLIGHT_INDEX_FIELDS = [
  "id", "blockId", "bookPath", "bookTitle", "chapterTitle", "cfiRange",
  "notePath", "markColor", "created", "updated",
] as const;

function toHighlightIndexEntry(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  const entry: Record<string, unknown> = {};
  for (const field of HIGHLIGHT_INDEX_FIELDS) {
    if (value[field] !== undefined) entry[field] = value[field];
  }
  return typeof entry.id === "string" && typeof entry.cfiRange === "string" ? entry : null;
}

export function mergeHighlightPayload(currentHighlights: Record<string, unknown[]>, payload: unknown): Record<string, unknown[]> | null {
  if (!isRecord(payload) || !isRecord(payload.bookHighlights)) return null;
  const next = structuredClone(currentHighlights);

  for (const [bookPath, incomingValue] of Object.entries(payload.bookHighlights)) {
    if (!Array.isArray(incomingValue)) return null;
    const incomingList = incomingValue.map(toHighlightIndexEntry);
    if (incomingList.some((entry) => !entry)) return null;
    const list: Record<string, unknown>[] = Array.isArray(next[bookPath])
      ? next[bookPath].filter(isRecord).map((entry) => ({ ...entry }))
      : [];

    for (const incoming of incomingList as Record<string, unknown>[]) {
      const existing = list.find((entry) => entry.id === incoming.id || entry.cfiRange === incoming.cfiRange);
      if (!existing) {
        list.push(incoming);
        continue;
      }
      const currentTime = new Date(String(existing.updated || existing.created || 0)).getTime();
      const incomingTime = new Date(String(incoming.updated || incoming.created || 0)).getTime();
      if (Number.isFinite(incomingTime) && (!Number.isFinite(currentTime) || incomingTime > currentTime)) {
        Object.assign(existing, incoming);
      }
    }
    next[bookPath] = list;
  }

  return next;
}

export function mergeSettingsPayload(current: SettingsConflictState, payload: unknown): SettingsConflictState | null {
  if (!isRecord(payload)) return null;
  const next = structuredClone(current);

  if (payload.readingStats !== undefined) {
    if (!isRecord(payload.readingStats)) return null;
    for (const [date, booksValue] of Object.entries(payload.readingStats)) {
      if (!isRecord(booksValue)) return null;
      const existingBooks = next.readingStats[date] || {};
      for (const [bookPath, seconds] of Object.entries(booksValue)) {
        if (typeof seconds !== "number" || !Number.isFinite(seconds)) return null;
        // Conflict copies commonly overlap. Keep the largest snapshot instead of double-counting.
        existingBooks[bookPath] = Math.max(existingBooks[bookPath] || 0, seconds);
      }
      next.readingStats[date] = existingBooks;
    }
  }

  if (payload.wordReviewStats !== undefined) {
    if (!isRecord(payload.wordReviewStats)) return null;
    for (const [date, statValue] of Object.entries(payload.wordReviewStats)) {
      if (!isRecord(statValue)) return null;
      const existing = next.wordReviewStats[date] || {};
      const reviewCount = typeof statValue.reviewCount === "number" ? statValue.reviewCount : 0;
      const reviewTimeMs = typeof statValue.reviewTimeMs === "number" ? statValue.reviewTimeMs : 0;
      next.wordReviewStats[date] = {
        reviewCount: Math.max(existing.reviewCount || 0, reviewCount),
        reviewTimeMs: Math.max(existing.reviewTimeMs || 0, reviewTimeMs),
      };
    }
  }

  if (payload.bookProgress !== undefined) {
    if (!isRecord(payload.bookProgress)) return null;
    for (const [bookPath, progressValue] of Object.entries(payload.bookProgress)) {
      if (!isRecord(progressValue)) return null;
      const existing = next.bookProgress[bookPath];
      const existingTime = new Date(String(existing?.updated || 0)).getTime();
      const incomingTime = new Date(String(progressValue.updated || 0)).getTime();
      if (!existing || (Number.isFinite(incomingTime) && (!Number.isFinite(existingTime) || incomingTime > existingTime))) {
        next.bookProgress[bookPath] = structuredClone(progressValue);
      }
    }
  }

  return next;
}
