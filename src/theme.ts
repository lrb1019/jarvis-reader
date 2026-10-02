// Extracted from main.js L48929-49010 — Obsidian theme sync for epub rendition

import { clampReaderZoom, clampReaderLineHeight, READER_ZOOM_LIMITS, READER_LINE_HEIGHT_LIMITS } from "./reader-settings.ts";
import { syncReaderTextSpacing } from "./reader-text-spacing.ts";
import { syncReaderParagraphIndent } from "./reader-paragraphs.ts";
import type { ReaderParagraphIndent } from "./reader-settings.ts";
export { clampReaderZoom, clampReaderLineHeight } from "./reader-settings.ts";

function getObsidianCssVar(name: string, fallback: string = ""): string {
  const el = document.querySelector(".app-container") || document.body;
  const value = getComputedStyle(el).getPropertyValue(name).trim();
  return value || fallback;
}

function getCssPixelValue(value: string | null | undefined): string {
  const parsed = parseFloat(value || "");
  return Number.isFinite(parsed) && parsed > 0 ? `${parsed}px` : "";
}

function scaleCssPixelValue(value: string | null | undefined, scale: any): string {
  const parsed = parseFloat(value || "");
  return Number.isFinite(parsed) && parsed > 0 ? `${parsed * clampReaderZoom(scale)}px` : value || "";
}

function getObsidianTextFontSize(): string {
  const cssVarSize = getCssPixelValue(getObsidianCssVar("--font-text-size", "")) || getCssPixelValue(getObsidianCssVar("--editor-font-size", ""));
  if (cssVarSize) {
    return cssVarSize;
  }
  const readableText = document.querySelector(".markdown-reading-view, .markdown-preview-view, .markdown-source-view.mod-cm6 .cm-content, .workspace-leaf-content[data-type='markdown'] .view-content");
  if (readableText instanceof HTMLElement) {
    const readableSize = getCssPixelValue(getComputedStyle(readableText).fontSize);
    if (readableSize) {
      return readableSize;
    }
  }
  return getCssPixelValue(getComputedStyle(document.body).fontSize) || "18px";
}

export function getJarvisReaderTheme(readerZoom: number = READER_ZOOM_LIMITS.defaultValue, readerLineHeight: number = READER_LINE_HEIGHT_LIMITS.defaultValue): any {
  const baseFontSize = getObsidianTextFontSize();
  return {
    background: getObsidianCssVar("--background-primary", "#ffffff"),
    backgroundSecondary: getObsidianCssVar("--background-secondary", "#f2f2f2"),
    text: getObsidianCssVar("--text-normal", "#222222"),
    muted: getObsidianCssVar("--text-muted", "#999999"),
    faint: getObsidianCssVar("--text-faint", "#cccccc"),
    border: getObsidianCssVar("--background-modifier-border", "#dddddd"),
    fontFamily: getObsidianCssVar("--font-text", getObsidianCssVar("--font-interface", "system-ui, sans-serif")),
    fontSize: scaleCssPixelValue(baseFontSize, readerZoom),
    lineHeight: clampReaderLineHeight(readerLineHeight).toString(),
    interactiveAccent: getObsidianCssVar("--interactive-accent", "#4dabf7"),
  };
}

export function applyObsidianThemeToRendition(rendition: any, readerZoom: number = READER_ZOOM_LIMITS.defaultValue, readerLineHeight: number = READER_LINE_HEIGHT_LIMITS.defaultValue, paragraphIndent: ReaderParagraphIndent = "original", letterSpacing: number = 0, wordSpacing: number = 0): void {
  const theme = getJarvisReaderTheme(readerZoom, readerLineHeight);
  try {
    rendition.themes.register("obsidian", {
      "html, body": {
        "background": `${theme.background} !important`,
        "color": `${theme.text} !important`,
        "font-family": `${theme.fontFamily} !important`,
        "font-size": `${theme.fontSize} !important`,
        "line-height": `${theme.lineHeight} !important`,
      },
      "p, div, span, li, blockquote, section, article": {
        "color": `${theme.text} !important`,
        "font-family": `${theme.fontFamily} !important`,
        "font-size": `inherit !important`,
        "line-height": `${theme.lineHeight} !important`,
      },
      "a": {
        "color": "var(--link-color, inherit) !important",
      },
      ".jarvis-reader-word-highlight": {
        "background-color": `color-mix(in srgb, ${theme.interactiveAccent} 18%, transparent) !important`,
        "border-bottom": `2px solid ${theme.interactiveAccent} !important`,
        "cursor": "pointer !important",
      },
      ".jarvis-reader-word-highlight rect": {
        "fill": `color-mix(in srgb, ${theme.interactiveAccent} 18%, transparent) !important`,
        "stroke": "none !important",
      },
      ".jarvis-reader-word-highlight line": {
        "stroke": `${theme.interactiveAccent} !important`,
        "stroke-width": "2px !important",
      },
      ".jarvis-reader-word-highlight path": {
        "stroke": `${theme.interactiveAccent} !important`,
        "stroke-width": "2px !important",
        "fill": "none !important"
      }
    });
    rendition.themes.select("obsidian");
    rendition.themes.override("background", theme.background, true);
    rendition.themes.override("background-color", theme.background, true);
    rendition.themes.override("color", theme.text, true);
    rendition.themes.override("font-family", theme.fontFamily, true);
    rendition.themes.override("font-size", theme.fontSize, true);
    rendition.themes.override("line-height", theme.lineHeight, true);
    syncReaderParagraphIndent(rendition, paragraphIndent);
    syncReaderTextSpacing(rendition, letterSpacing, wordSpacing);
  } catch (error) {
    console.warn("Jarvis Reader theme sync failed.", error);
  }
}
