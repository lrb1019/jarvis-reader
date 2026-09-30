import { normalizeReaderParagraphIndent, type ReaderParagraphIndent } from "./reader-settings.ts";

const MARKER = "data-jarvis-reader-paragraph";
const originalIndents = new WeakMap<HTMLElement, { value: string; priority: string; hadStyle: boolean }>();
const EXCLUDED_CONTEXT = "blockquote, li, figure, figcaption, table, pre, nav, aside, h1, h2, h3, h4, h5, h6, [role='heading'], [role='doc-footnote'], [role='doc-endnote'], .caption, .image-caption, .poem, .poetry, .verse, .title, .subtitle";
const EXCLUDED_TYPES = new Set(["footnote", "endnote", "titlepage", "dedication", "poem", "verse", "caption"]);

export function isReaderBodyParagraph(paragraph: Element): boolean {
  if (paragraph.localName !== "p" || !paragraph.textContent?.trim() || paragraph.closest(EXCLUDED_CONTEXT)) return false;
  if (paragraph.querySelector("img, svg, video, audio, canvas, math, table")) return false;
  for (let ancestor: Element | null = paragraph; ancestor; ancestor = ancestor.parentElement) {
    if ((ancestor.getAttribute("epub:type") || "").split(/\s+/).some(type => EXCLUDED_TYPES.has(type))) return false;
  }
  const alignment = paragraph.ownerDocument.defaultView?.getComputedStyle(paragraph).textAlign;
  return alignment !== "center" && alignment !== "right" && alignment !== "end";
}

/** Only touches rendered paragraphs; restores the original property and priority on every switch. */
export function applyReaderParagraphIndent(doc: Document, mode: ReaderParagraphIndent): void {
  doc.querySelectorAll<HTMLElement>(`[${MARKER}]`).forEach(element => {
    const original = originalIndents.get(element);
    if (original) {
      if (original.value) element.style.setProperty("text-indent", original.value, original.priority);
      else element.style.removeProperty("text-indent");
      if (!original.hadStyle && !element.style.length) element.removeAttribute("style");
      originalIndents.delete(element);
    }
    element.removeAttribute(MARKER);
  });
  if (mode === "original") return;
  doc.querySelectorAll<HTMLParagraphElement>("p").forEach(paragraph => {
    if (!isReaderBodyParagraph(paragraph)) return;
    originalIndents.set(paragraph, {
      value: paragraph.style.getPropertyValue("text-indent"),
      priority: paragraph.style.getPropertyPriority("text-indent"),
      hadStyle: paragraph.hasAttribute("style"),
    });
    paragraph.setAttribute(MARKER, "");
    // Inline priority also handles books which declare their own important indent rules.
    paragraph.style.setProperty("text-indent", mode === "two-chars" ? "2em" : "0", "important");
  });
}

interface ParagraphContents { document: Document }
interface ParagraphRendition {
  getContents(): ParagraphContents[];
  hooks: { content: { register(callback: (contents: ParagraphContents) => void): unknown } };
}
const indentModes = new WeakMap<ParagraphRendition, ReaderParagraphIndent>();

export function syncReaderParagraphIndent(rendition: ParagraphRendition, value: unknown): void {
  const mode = normalizeReaderParagraphIndent(value);
  if (!indentModes.has(rendition)) {
    rendition.hooks.content.register(contents => applyReaderParagraphIndent(contents.document, indentModes.get(rendition) || "original"));
  }
  indentModes.set(rendition, mode);
  rendition.getContents().forEach(contents => applyReaderParagraphIndent(contents.document, mode));
}
