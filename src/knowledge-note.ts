export interface KnowledgeNoteDraft {
  title: string;
  body: string;
  sourceNotePath: string;
  sourceBlockId: string;
  sourceBookTitle: string;
}

export interface KnowledgeNoteBodyEntry {
  label: string;
  created?: string;
  text: string;
}

export function buildKnowledgeNoteSourceLink(sourceNotePath: string, sourceBlockId: string): string {
  return sourceBlockId
    ? `[[${sourceNotePath}#^${sourceBlockId}]]`
    : `[[${sourceNotePath}]]`;
}

export function buildKnowledgeNoteBody(quote: string, entries: KnowledgeNoteBodyEntry[]): string {
  const sections: string[] = [];
  const cleanQuote = quote.trim();
  if (cleanQuote) {
    const blockquote = cleanQuote.split(/\r?\n/).map((line) => `> ${line}`).join("\n");
    sections.push(`## 原文\n\n${blockquote}`);
  }
  const notes = entries.filter((entry) => entry.text.trim());
  if (notes.length) {
    const noteSections = notes.map((entry, index) => {
      const label = entry.label.trim() || (index === 0 ? "笔记" : `笔记 ${index + 1}`);
      const created = entry.created?.trim() ? `\n\n${entry.created.trim()}` : "";
      return `### ${label}${created}\n\n${entry.text.trim()}`;
    });
    sections.push(`## 笔记\n\n${noteSections.join("\n\n")}`);
  }
  return sections.join("\n\n");
}

export function buildKnowledgeNoteContent(draft: KnowledgeNoteDraft, createdAt: string): string {
  const source = buildKnowledgeNoteSourceLink(draft.sourceNotePath, draft.sourceBlockId);
  const escapeYaml = (value: string) => value.replace(/"/g, "\\\"");
  return `---\ncreated: ${createdAt}\nauthor: "[[Jarvis]]"\nsource_book: "${escapeYaml(draft.sourceBookTitle)}"\nsource_note: "${escapeYaml(draft.sourceNotePath)}"\nsource_block: "${escapeYaml(draft.sourceBlockId)}"\n---\n\n${draft.body.trim()}\n\n## 来源\n\n${source}\n`;
}

export function buildKnowledgeNotePath(folder: string, title: string): string {
  const cleanFolder = folder.trim().replace(/^\/+|\/+$/g, "");
  const cleanTitle = title.trim().replace(/[\\/:*?"<>|]/g, "-");
  return `${cleanFolder ? `${cleanFolder}/` : ""}${cleanTitle}.md`;
}
