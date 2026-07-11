export interface KnowledgeNoteDraft {
  title: string;
  body: string;
  sourceNotePath: string;
  sourceBlockId: string;
  sourceBookTitle: string;
}

export function buildKnowledgeNoteContent(draft: KnowledgeNoteDraft, createdAt: string): string {
  const source = draft.sourceBlockId
    ? `[[${draft.sourceNotePath}#^${draft.sourceBlockId}]]`
    : `[[${draft.sourceNotePath}]]`;
  return `---\ncreated: ${createdAt}\nauthor: "[[Jarvis]]"\nsource_book: "${draft.sourceBookTitle.replace(/"/g, "\\\"")}"\n---\n\n# ${draft.title}\n\n${draft.body.trim()}\n\n## 来源\n\n${source}\n`;
}

export function buildKnowledgeNotePath(folder: string, title: string): string {
  const cleanFolder = folder.trim().replace(/^\/+|\/+$/g, "");
  const cleanTitle = title.trim().replace(/[\\/:*?"<>|]/g, "-");
  return `${cleanFolder ? `${cleanFolder}/` : ""}${cleanTitle}.md`;
}
