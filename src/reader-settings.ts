export interface ReaderNumberLimits {
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly defaultValue: number;
}

export const READER_ZOOM_LIMITS: ReaderNumberLimits = Object.freeze({
  min: 0.6, max: 2, step: 0.05, defaultValue: 1,
});

export const READER_LINE_HEIGHT_LIMITS: ReaderNumberLimits = Object.freeze({
  min: 1.1, max: 2.4, step: 0.05, defaultValue: 1.6,
});

// Percent of the current font size; zero preserves the book's spacing.
export const READER_LETTER_SPACING_LIMITS: ReaderNumberLimits = Object.freeze({
  min: -5, max: 20, step: 1, defaultValue: 0,
});
export const READER_WORD_SPACING_LIMITS: ReaderNumberLimits = Object.freeze({
  min: -20, max: 50, step: 1, defaultValue: 0,
});
export function clampReaderLetterSpacing(value: unknown): number {
  return clampReaderNumber(value, READER_LETTER_SPACING_LIMITS);
}
export function clampReaderWordSpacing(value: unknown): number {
  return clampReaderNumber(value, READER_WORD_SPACING_LIMITS);
}

function clampReaderNumber(value: unknown, limits: ReaderNumberLimits): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? parseFloat(value) : NaN;
  const number = Number.isFinite(parsed) ? parsed : limits.defaultValue;
  const scale = 1 / limits.step;
  return Math.min(limits.max, Math.max(limits.min, Math.round(number * scale) / scale));
}

export function clampReaderZoom(value: unknown): number {
  return clampReaderNumber(value, READER_ZOOM_LIMITS);
}

export function clampReaderLineHeight(value: unknown): number {
  return clampReaderNumber(value, READER_LINE_HEIGHT_LIMITS);
}

export const READER_WIDTH_LIMITS: ReaderNumberLimits = Object.freeze({
  min: 480, max: 1600, step: 40, defaultValue: 960,
});

export function clampReaderWidth(value: unknown): number {
  return clampReaderNumber(value, READER_WIDTH_LIMITS);
}

export type ReaderParagraphIndent = "original" | "two-chars" | "none";
export function normalizeReaderParagraphIndent(value: unknown): ReaderParagraphIndent {
  return value === "two-chars" || value === "none" ? value : "original";
}

export interface ReaderPreferences {
  readerLetterSpacing: number;
  readerWordSpacing: number;
  readerParagraphIndent: ReaderParagraphIndent;
  readerWidth: number;
  readerZoom: number;
  readerLineHeight: number;
  singlePageView: boolean;
  scrolledView: boolean;
}

export const DEFAULT_READER_PREFERENCES: Readonly<ReaderPreferences> = Object.freeze({
  readerLetterSpacing: 0,
  readerWordSpacing: 0,
  readerParagraphIndent: "original",
  readerWidth: READER_WIDTH_LIMITS.defaultValue,
  readerZoom: READER_ZOOM_LIMITS.defaultValue,
  readerLineHeight: READER_LINE_HEIGHT_LIMITS.defaultValue,
  singlePageView: false,
  scrolledView: false,
});

export function resolveReaderPreferences(current: ReaderPreferences, patch: Partial<ReaderPreferences>): ReaderPreferences {
  const next = { ...current, ...patch };
  return {
    readerLetterSpacing: clampReaderLetterSpacing(next.readerLetterSpacing),
    readerWordSpacing: clampReaderWordSpacing(next.readerWordSpacing),
    readerParagraphIndent: normalizeReaderParagraphIndent(next.readerParagraphIndent),
    readerWidth: clampReaderWidth(next.readerWidth),
    readerZoom: clampReaderZoom(next.readerZoom),
    readerLineHeight: clampReaderLineHeight(next.readerLineHeight),
    singlePageView: next.singlePageView,
    scrolledView: next.singlePageView && next.scrolledView,
  };
}


const READER_QUICK_ACTIONS = [
  { id: "bookmark", label: "添加书签" },
  { id: "note", label: "打开本书笔记" },
] as const;
export type ReaderQuickAction = typeof READER_QUICK_ACTIONS[number]["id"];
export function normalizeReaderQuickActions(value: unknown): ReaderQuickAction[] {
  if (!Array.isArray(value)) return ["bookmark", "note"];
  return READER_QUICK_ACTIONS.filter(action => value.includes(action.id)).map(action => action.id);
}
