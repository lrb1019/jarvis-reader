import { knowledgeNoteTimeLines } from "./knowledge-note.ts";

export interface KnowledgeNoteTimeSection {
  text: string;
  lineStart: number;
  lineEnd: number;
}

/** Apply the same source-line identity used by live preview. */
export function styleKnowledgeNoteTimes(
  root: HTMLElement,
  getSectionInfo: (paragraph: HTMLParagraphElement) => KnowledgeNoteTimeSection | null,
): void {
  const paragraphs = Array.from(root.querySelectorAll<HTMLParagraphElement>("p"));
  if (root.matches("p")) paragraphs.unshift(root as HTMLParagraphElement);
  const timeLines = new Map<string, Set<number>>();
  for (const paragraph of paragraphs) {
    const time = paragraph.firstElementChild;
    if (time?.tagName !== "EM" || paragraph.childNodes.length !== 1) continue;
    const section = getSectionInfo(paragraph);
    if (!section || section.lineStart !== section.lineEnd) continue;
    let lines = timeLines.get(section.text);
    if (!lines) {
      lines = new Set(knowledgeNoteTimeLines(section.text));
      timeLines.set(section.text, lines);
    }
    paragraph.classList.toggle("jarvis-knowledge-note-time", lines.has(section.lineStart + 1));
  }
}
