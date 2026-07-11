import { formatLocalDateTime } from "./utils-core.ts";
import type { BookHighlight } from "./types";

export function formatBlockquote(text: string): string {
  return (text || "").split(/\r?\n/).map((line) => `> ${line.trim()}`).join("\n");
}

export function formatHighlightNoteBlock(highlight: BookHighlight): string {
  const title = highlight.chapterTitle || "\u672a\u547d\u540d\u7ae0\u8282";
  const quote = formatBlockquote(highlight.quote);
  const entries = (highlight as any).commentEntries;
  let commentBlock = "";
  if (Array.isArray(entries) && entries.length > 0) {
    commentBlock = entries.map(entry => {
      const lbl = entry.label || "想法";
      const createdTime = entry.created || formatLocalDateTime(highlight.created);
      return `>\n> **${lbl}**\n> created: ${createdTime}\n>\n${formatBlockquote(entry.text)}`;
    }).join("\n") + "\n";
  } else {
    const comment = (highlight.comment || "").trim();
    commentBlock = comment ? `>\n> **\u7b14\u8bb0**\n> created: ${formatLocalDateTime(highlight.created)}\n>\n${formatBlockquote(comment)}\n` : ">\n";
  }
  const timestamp = formatBlockquote(`**\u65f6\u95f4**\n${formatLocalDateTime(highlight.updated || highlight.created)}`);
  
  let aiBlock = "";
  const aiSections = (highlight as any).aiSections;
  if (Array.isArray(aiSections) && aiSections.length > 0) {
    aiBlock = aiSections.map(sec => {
      const parts: string[] = [];
      if (sec.links && sec.links.length) {
        if (sec.title === "关联文章") {
          const formatted = sec.links.map((lnk: string) => {
            const [path, time] = lnk.split("|");
            return time ? `[[${path}]] | ${time}` : `[[${path}]]`;
          });
          parts.push(formatted.join("\n"));
        } else {
          parts.push(sec.links.map((lnk: string) => `[[${lnk}]]`).join(" "));
        }
      }
      if (sec.title !== "关联文章" && sec.text && sec.text.trim()) {
        parts.push(sec.text.trim());
      }
      const secContent = parts.join("\n");
      return `>\n> ### ${sec.title || "AI \u8f93\u51fa"}\n${formatBlockquote(secContent)}`;
    }).join("\n");
  }

  return `> [!note] ${title}
${quote}
${commentBlock}${aiBlock ? aiBlock + "\n" : ""}${timestamp}
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
  const meta: any = {
    id: highlight.id || highlight.blockId || "",
    bookPath: highlight.bookPath || "",
    bookTitle: highlight.bookTitle || "",
    chapterTitle: highlight.chapterTitle || "",
    cfiRange: highlight.cfiRange || "",
    notePath: highlight.notePath || "",
    blockId: highlight.blockId || highlight.id || "",
    created: highlight.created || "",
    updated: highlight.updated || "",
  };
  if (highlight.markColor) {
    meta.markColor = highlight.markColor;
  }
  return meta;
}

export function buildHighlightNoteUpdate(
  current: BookHighlight,
  incoming: Partial<BookHighlight>,
  comment: string,
  updated: string,
): BookHighlight {
  return {
    ...current,
    // The index intentionally omits Markdown-owned quote text after reload.
    quote: incoming.quote || current.quote,
    comment,
    updated,
  };
}
