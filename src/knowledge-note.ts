export interface KnowledgeNoteDraft {
  title: string;
  body: string;
  sourceNotePath: string;
  sourceBlockId: string;
  sourceBookTitle: string;
  sourceBookPath?: string;
  sourceLocationLink?: string;
}

export interface KnowledgeNoteBodyEntry {
  label: string;
  created?: string;
  text: string;
}

function buildKnowledgeNoteSourceLink(sourceNotePath: string, sourceBlockId: string): string {
  const target = sourceBlockId ? `${sourceNotePath}#^${sourceBlockId}` : sourceNotePath;
  return `[[${target}|返回读书笔记]]`;
}

export function hasKnowledgeNoteSource(content: string, sourceNotePath: string, sourceBlockId: string): boolean {
  const target = sourceBlockId ? `${sourceNotePath}#^${sourceBlockId}` : sourceNotePath;
  const sectionStart = "## 来源\n\n";
  const normalized = content.replace(/\r\n/g, "\n");
  // Generated source block IDs stay stable when their parent note moves.
  const frontmatter = normalized.match(/^---\n([\s\S]*?)\n---(?:\n|$)/)?.[1];
  const storedBlock = frontmatter?.match(/^source_block:\s*(.+)$/m)?.[1].trim();
  if (sourceBlockId && (storedBlock === sourceBlockId || storedBlock === JSON.stringify(sourceBlockId))) return true;
  return normalized.includes(`${sectionStart}[[${target}|返回读书笔记]]`)
    || normalized.includes(`${sectionStart}[[${target}]]`);
}

export function buildKnowledgeNoteBody(quote: string, entries: KnowledgeNoteBodyEntry[]): string {
  const sections: string[] = [];
  const notes = entries.filter((entry) => entry.text.trim());
  if (notes.length) {
    const noteSections = notes.map((entry, index) => {
      const label = entry.label.trim() || (index === 0 ? "笔记" : `笔记 ${index + 1}`);
      const heading = notes.length > 1 || label !== "笔记" ? `### ${label}\n\n` : "";
      const created = entry.created?.trim() ? `\n\n*记录于 ${entry.created.trim()}*` : "";
      return `${heading}${entry.text.trim()}${created}`;
    });
    sections.push(`## 笔记\n\n${noteSections.join("\n\n")}`);
  }
  const cleanQuote = quote.trim();
  if (cleanQuote) {
    const blockquote = cleanQuote.split(/\r?\n/).map((line) => `> ${line}`).join("\n");
    sections.push(`## 原文\n\n${blockquote}`);
  }
  return sections.join("\n\n");
}

export function buildKnowledgeNoteContent(draft: KnowledgeNoteDraft, createdAt: string): string {
  const source = buildKnowledgeNoteSourceLink(draft.sourceNotePath, draft.sourceBlockId);
  const location = draft.sourceLocationLink ? `\n\n[返回原文](${draft.sourceLocationLink})` : "";
  const book = draft.sourceBookPath ? `[[${draft.sourceBookPath.split("/").pop()}]]` : draft.sourceBookTitle;
  const note = `[[${draft.sourceNotePath.replace(/\.md$/i, "")}]]`;
  return `---\ncreated: ${createdAt}\nsource_book: ${JSON.stringify(book)}\nsource_note: ${JSON.stringify(note)}\nsource_block: ${JSON.stringify(draft.sourceBlockId)}\n---\n\n${draft.body.trim()}\n\n## 来源\n\n${source}${location}\n`;
}

export function buildKnowledgeNotePath(folder: string, title: string): string {
  const cleanFolder = folder.trim().replace(/^\/+|\/+$/g, "");
  const cleanTitle = title.trim().replace(/[\\/:*?"<>|]/g, "-");
  return `${cleanFolder ? `${cleanFolder}/` : ""}${cleanTitle}.md`;
}

/** Only generated knowledge-note record lines participate in editor styling. */
export function knowledgeNoteTimeLines(text: string): number[] {
  const lines = text.split("\n");
  if (lines[0] !== "---") return [];
  const end = lines.indexOf("---", 1);
  if (end < 0) return [];
  const metadata = lines.slice(1, end).join("\n");
  if (!/^source_block:\s*\S.+$/m.test(metadata) || !/^source_note:\s*\S.+$/m.test(metadata)) return [];
  const result: number[] = [];
  let inNotes = false;
  let fence = "";
  for (let index = end + 1; index < lines.length; index++) {
    const line = lines[index];
    const marker = line.match(/^\s*(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = "";
      continue;
    }
    if (fence) continue;
    if (/^## /.test(line)) inNotes = line === "## 笔记";
    if (inNotes && /^\*记录于 \d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})?\*$/.test(line)) result.push(index + 1);
  }
  return result;
}
