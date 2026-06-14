// Extracted from main.js L48929-49010 — Obsidian theme sync for epub rendition

export function getObsidianCssVar(name: string, fallback: string = ""): string {
  const value = getComputedStyle(document.body).getPropertyValue(name).trim();
  return value || fallback;
}

export function getCssPixelValue(value: string | null | undefined): string {
  const parsed = parseFloat(value || "");
  return Number.isFinite(parsed) && parsed > 0 ? `${parsed}px` : "";
}

export function clampReaderZoom(value: any): number {
  const parsed = parseFloat(value);
  const zoom = Number.isFinite(parsed) ? parsed : 1;
  return Math.min(2, Math.max(0.6, Math.round(zoom * 20) / 20));
}

export function clampReaderLineHeight(value: any): number {
  const parsed = parseFloat(value);
  const lineHeight = Number.isFinite(parsed) ? parsed : 1.6;
  return Math.min(2.4, Math.max(1.1, Math.round(lineHeight * 20) / 20));
}

export function scaleCssPixelValue(value: string | null | undefined, scale: any): string {
  const parsed = parseFloat(value || "");
  return Number.isFinite(parsed) && parsed > 0 ? `${parsed * clampReaderZoom(scale)}px` : value || "";
}

export function getObsidianTextFontSize(): string {
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

export function getJarvisReaderTheme(readerZoom: number = 1, readerLineHeight: number = 1.6): any {
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
  };
}

export function applyObsidianThemeToRendition(rendition: any, readerZoom: number = 1, readerLineHeight: number = 1.6): void {
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
    });
    rendition.themes.select("obsidian");
    rendition.themes.override("background", theme.background, true);
    rendition.themes.override("background-color", theme.background, true);
    rendition.themes.override("color", theme.text, true);
    rendition.themes.override("font-family", theme.fontFamily, true);
    rendition.themes.override("font-size", theme.fontSize, true);
    rendition.themes.override("line-height", theme.lineHeight, true);
  } catch (error) {
    console.warn("Jarvis Reader theme sync failed.", error);
  }
}
