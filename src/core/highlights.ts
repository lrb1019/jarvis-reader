import type { BookHighlight, HighlightColor } from "../domain/index.ts";
import { HIGHLIGHT_COLORS } from "../domain/highlights.ts";
import { normalizeHighlightQuote } from "./text.ts";

export const DEFAULT_HIGHLIGHT_COLOR: HighlightColor = "yellow";

export const HIGHLIGHT_COLOR_STYLES: Record<
  HighlightColor,
  { fill: string; stroke: string }
> = {
  yellow: { fill: "#fde047", stroke: "#eab308" },
  green: { fill: "#86efac", stroke: "#22c55e" },
  blue: { fill: "#93c5fd", stroke: "#3b82f6" },
  pink: { fill: "#f9a8d4", stroke: "#ec4899" },
  purple: { fill: "#c4b5fd", stroke: "#8b5cf6" },
};

export interface NewHighlightInput {
  bookPath: string;
  bookTitle: string;
  chapterTitle: string;
  cfiRange: string;
  quote: string;
  comment?: string;
  markColor?: unknown;
  notePath?: string;
}

export function normalizeHighlightColor(value: unknown): HighlightColor {
  return HIGHLIGHT_COLORS.includes(value as HighlightColor)
    ? (value as HighlightColor)
    : DEFAULT_HIGHLIGHT_COLOR;
}

export function createHighlightId(now = Date.now(), random = Math.random()): string {
  return `ar-${now.toString(36)}-${random.toString(36).slice(2, 8)}`;
}

export function createBookHighlight(
  input: NewHighlightInput,
  options: { id?: string; now?: string } = {},
): BookHighlight {
  const id = options.id || createHighlightId();
  const quote = normalizeHighlightQuote(input.quote);
  if (!quote || !input.cfiRange) throw new Error("Highlight requires quote and CFI range.");
  return {
    id,
    bookPath: input.bookPath,
    bookTitle: input.bookTitle,
    chapterTitle: input.chapterTitle || input.bookTitle,
    cfiRange: input.cfiRange,
    quote,
    comment: String(input.comment || "").trim(),
    markColor: normalizeHighlightColor(input.markColor),
    notePath: input.notePath || "",
    blockId: id,
    created: options.now || new Date().toISOString(),
  };
}

export function updateBookHighlight(
  current: BookHighlight,
  changes: Pick<BookHighlight, "comment"> & { markColor?: unknown },
  now = new Date().toISOString(),
): BookHighlight {
  return {
    ...current,
    comment: String(changes.comment || "").trim(),
    markColor: normalizeHighlightColor(changes.markColor ?? current.markColor),
    updated: now,
  };
}

export function upsertBookHighlight(
  list: readonly BookHighlight[],
  highlight: BookHighlight,
): BookHighlight[] {
  const index = list.findIndex((item) => item.id === highlight.id);
  if (index < 0) return [...list, highlight];
  return list.map((item, itemIndex) => (itemIndex === index ? highlight : item));
}

export function deleteBookHighlight(
  list: readonly BookHighlight[],
  highlightId: string,
): BookHighlight[] {
  return list.filter((item) => item.id !== highlightId);
}

function blockquote(text: string): string {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => `> ${line.trim()}`)
    .join("\n");
}

export function formatHighlightNoteBlock(highlight: BookHighlight): string {
  const comment = highlight.comment.trim();
  const commentBlock = comment ? `>\n> **想法**\n${blockquote(comment)}\n` : ">";
  const time = highlight.updated || highlight.created;
  return `> [!note] ${highlight.chapterTitle || "未命名章节"}\n${blockquote(highlight.quote)}\n${commentBlock}\n> **时间**\n> ${time}\n^${highlight.blockId}`;
}

export function upsertHighlightNoteBlock(
  content: string,
  highlight: BookHighlight,
): string {
  const lines = String(content || "").split(/\r?\n/);
  const blockLine = `^${highlight.blockId}`;
  const end = lines.findIndex((line) => line.trim() === blockLine);
  const replacement = formatHighlightNoteBlock(highlight).split("\n");
  if (end < 0) {
    const target = (highlight.chapterTitle || "未命名章节").replace(/\s+/g, " ").trim();
    const heading = /^(#{1,6})\s+(.+?)\s*$/;
    let chapterIndex = -1;
    let chapterDepth = 0;
    for (let index = 0; index < lines.length; index += 1) {
      const match = lines[index]?.match(heading);
      if (match && match[2]?.replace(/\s+/g, " ").trim() === target) {
        chapterIndex = index;
        chapterDepth = match[1]?.length || 2;
        break;
      }
    }
    if (chapterIndex < 0) {
      const prefix = content.trimEnd();
      return `${prefix}${prefix ? "\n\n" : ""}## ${target}\n\n${replacement.join("\n")}\n`;
    }
    let insertAt = lines.length;
    for (let index = chapterIndex + 1; index < lines.length; index += 1) {
      const match = lines[index]?.match(heading);
      if (match && (match[1]?.length || 0) <= chapterDepth) {
        insertAt = index;
        break;
      }
    }
    const insertion = [...replacement];
    if (insertAt > 0 && lines[insertAt - 1]?.trim()) insertion.unshift("");
    lines.splice(insertAt, 0, ...insertion);
    return `${lines.join("\n").trimEnd()}\n`;
  }
  let start = end;
  while (start > 0 && !/^> \[!note\]/i.test(lines[start] || "")) start -= 1;
  if (!/^> \[!note\]/i.test(lines[start] || "")) {
    return `${content.trimEnd()}\n\n${replacement.join("\n")}\n`;
  }
  lines.splice(start, end - start + 1, ...replacement);
  return `${lines.join("\n").trimEnd()}\n`;
}

export function deleteHighlightNoteBlock(content: string, blockId: string): string {
  const lines = String(content || "").split(/\r?\n/);
  const end = lines.findIndex((line) => line.trim() === `^${blockId}`);
  if (end < 0) return content;
  let start = end;
  while (start > 0 && !/^> \[!note\]/i.test(lines[start] || "")) start -= 1;
  if (!/^> \[!note\]/i.test(lines[start] || "")) return content;
  let deleteEnd = end + 1;
  while (deleteEnd < lines.length && !lines[deleteEnd]?.trim()) deleteEnd += 1;
  lines.splice(start, deleteEnd - start);
  return `${lines.join("\n").trimEnd()}\n`;
}
