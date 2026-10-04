/** Style generated record times without changing knowledge-note Markdown. */
export function styleKnowledgeNoteTimes(root: HTMLElement): void {
  const paragraphs = Array.from(root.querySelectorAll<HTMLParagraphElement>("p"));
  if (root.matches("p")) paragraphs.unshift(root as HTMLParagraphElement);
  for (const paragraph of paragraphs) {
    const time = paragraph.firstElementChild;
    if (time?.tagName !== "EM" || paragraph.childNodes.length !== 1) continue;
    if (!/^记录于 \d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})?$/.test(time.textContent || "")) continue;
    paragraph.classList.add("jarvis-knowledge-note-time");
  }
}
