import { formatLocalDateTime } from "./utils-core.ts";
import type { BookHighlight } from "./types";

export function formatBlockquote(text: string): string {
  return (text || "").split(/\r?\n/).map((line) => `> ${line.trim()}`).join("\n");
}

export function formatHighlightNoteBlock(highlight: BookHighlight): string {
  const title = highlight.chapterTitle || "\u672a\u547d\u540d\u7ae0\u8282";
  const quote = formatBlockquote(highlight.quote);
  const comment = (highlight.comment || "").trim();
  const commentBlock = comment ? `>
> **\u7b14\u8bb0**
> created: ${formatLocalDateTime(highlight.created)}
>
${formatBlockquote(comment)}
` : ">";
  const timestamp = formatBlockquote(`**\u65f6\u95f4**\n${formatLocalDateTime(highlight.updated || highlight.created)}`);
  return `> [!note] ${title}
${quote}
${commentBlock}
${timestamp}
^${highlight.blockId}`;
}

export function isHighlightNoteBlockStart(line: string): boolean {
  return /^> \[!(?:quote|note)\]/i.test(line || "");
}

export function dedupeHighlightsByCfi<T extends { cfiRange?: string | null }>(list: T[] | null | undefined): T[] {
  const unique = new Map<string, T>();
  const withoutCfi: T[] = [];
  for (const item of list || []) {
    const cfiRange = String(item?.cfiRange || "").trim();
    if (!cfiRange) {
      withoutCfi.push(item);
      continue;
    }
    unique.set(cfiRange, item);
  }
  return [...withoutCfi, ...unique.values()];
}

export function buildHighlightMetadata(highlight: any): any {
  return {
    id: highlight.id || highlight.blockId || "",
    bookPath: highlight.bookPath || "",
    bookTitle: highlight.bookTitle || "",
    chapterTitle: highlight.chapterTitle || "",
    cfiRange: highlight.cfiRange || "",
    quote: highlight.quote || "",
    comment: highlight.comment || "",
    notePath: highlight.notePath || "",
    blockId: highlight.blockId || highlight.id || "",
    created: highlight.created || "",
    updated: highlight.updated || "",
  };
}
