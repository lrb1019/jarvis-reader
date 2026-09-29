import type { BookHighlight } from "./types.ts";

export interface ReadingSourceTarget {
  bookPath: string;
  highlightId: string;
  cfiRange: string;
}

const MAX_PARAMETER_LENGTH = 8192;

export function buildReadingSourceLink(highlight: Pick<BookHighlight, "bookPath" | "id" | "blockId" | "cfiRange">): string {
  const bookPath = highlight.bookPath.trim();
  const highlightId = (highlight.id || highlight.blockId || "").trim();
  const cfiRange = highlight.cfiRange.trim();
  if (!bookPath || !highlightId || !cfiRange) return "";

  const query = [
    "v=1",
    `book=${encodeURIComponent(bookPath)}`,
    `highlight=${encodeURIComponent(highlightId)}`,
    `cfi=${encodeURIComponent(cfiRange)}`,
  ].join("&");
  return `obsidian://jarvis-reader?${query}`;
}

export function parseReadingSourceTarget(parameters: Record<string, string>): ReadingSourceTarget | null {
  if (parameters.v !== "1") return null;
  // Obsidian protocol handlers may preserve `+` from older URLSearchParams links.
  const bookPath = String(parameters.book || "").replace(/\+/g, " ").trim();
  const highlightId = String(parameters.highlight || "").trim();
  const cfiRange = String(parameters.cfi || "").trim();
  if (!bookPath || !highlightId || !cfiRange) return null;
  if ([bookPath, highlightId, cfiRange].some((value) => value.length > MAX_PARAMETER_LENGTH)) return null;
  if (bookPath.startsWith("/") || bookPath.split("/").some((part) => part === "..") || !bookPath.toLowerCase().endsWith(".epub")) return null;
  return { bookPath, highlightId, cfiRange };
}
