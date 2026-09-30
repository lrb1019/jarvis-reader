import { clampReaderLetterSpacing, clampReaderWordSpacing } from "./reader-settings.ts";

const STYLE_ID = "jarvis-reader-text-spacing";
export function getReaderTextSpacingCss(letterSpacing: unknown, wordSpacing: unknown): string {
  const letter = clampReaderLetterSpacing(letterSpacing);
  const word = clampReaderWordSpacing(wordSpacing);
  const rules = [
    letter ? `letter-spacing: ${letter / 100}em !important;` : "",
    word ? `word-spacing: ${word / 100}em !important;` : "",
  ].filter(Boolean).join(" ");
  // Zero adds no override, so original book rules become authoritative again.
  return rules ? `body, p, div, span, li, blockquote, section, article { ${rules} }` : "";
}
export function applyReaderTextSpacing(doc: Document, letter: unknown, word: unknown): void {
  const css = getReaderTextSpacingCss(letter, word);
  let style = doc.getElementById(STYLE_ID);
  if (!css) { style?.remove(); return; }
  if (!style) {
    style = doc.createElement("style");
    style.id = STYLE_ID;
    doc.head.appendChild(style);
  }
  if (style.textContent !== css) style.textContent = css;
}
interface SpacingContents { document: Document }
interface SpacingRendition {
  getContents(): SpacingContents[];
  hooks: { content: { register(callback: (contents: SpacingContents) => void): unknown } };
}
const preferences = new WeakMap<SpacingRendition, { letter: number; word: number }>();
export function syncReaderTextSpacing(rendition: SpacingRendition, letter: unknown, word: unknown): void {
  if (!preferences.has(rendition)) {
    rendition.hooks.content.register(contents => {
      const value = preferences.get(rendition);
      if (value) applyReaderTextSpacing(contents.document, value.letter, value.word);
    });
  }
  preferences.set(rendition, { letter: clampReaderLetterSpacing(letter), word: clampReaderWordSpacing(word) });
  rendition.getContents().forEach(contents => applyReaderTextSpacing(contents.document, letter, word));
}
