import type { HighlightAiSection, HighlightCommentEntry } from "../book-note-document.ts";
import type { BookHighlight } from "../types.ts";

export type LibraryHighlight = Omit<BookHighlight, "quote" | "comment"> & {
  quote?: string;
  comment?: string;
  commentEntries?: HighlightCommentEntry[];
  aiSections?: HighlightAiSection[];
};

export function getLibraryHighlightNoteEntries(highlight: LibraryHighlight): HighlightCommentEntry[] {
  const entries = (highlight.commentEntries || []).filter((entry) => String(entry?.text || "").trim());
  if (entries.length) return entries;
  const fallback = String(highlight.comment || "").trim();
  if (!fallback) return [];
  return fallback.split(/\n{2,}/).map((text, index) => ({
    label: index === 0 ? "笔记" : `笔记 ${index + 1}`,
    created: highlight.updated || highlight.created || "",
    text: text.trim(),
  })).filter((entry) => entry.text);
}

export function getLibraryHighlightLinks(highlight: LibraryHighlight): string[] {
  const links = highlight.aiSections?.find((section) => section.title === "关联文章")?.links || [];
  return [...new Set(links.filter((link) => typeof link === "string" && link.trim()))];
}
