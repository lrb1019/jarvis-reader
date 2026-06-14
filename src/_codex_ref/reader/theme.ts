import type { Rendition } from "epubjs";
import { clampReaderLineHeight, clampReaderZoom } from "./core.ts";

function cssVariable(name: string, fallback: string): string {
  return getComputedStyle(document.body).getPropertyValue(name).trim() || fallback;
}

export interface ReaderThemeSnapshot {
  background: string;
  text: string;
  muted: string;
  fontFamily: string;
}

export function getReaderThemeSnapshot(): ReaderThemeSnapshot {
  return {
    background: cssVariable("--background-primary", "#ffffff"),
    text: cssVariable("--text-normal", "#222222"),
    muted: cssVariable("--text-muted", "#999999"),
    fontFamily: cssVariable("--font-text", "system-ui, sans-serif"),
  };
}

export function getReaderThemeKey(readerZoom: number, readerLineHeight: number): string {
  const zoom = clampReaderZoom(readerZoom);
  const lineHeight = clampReaderLineHeight(readerLineHeight);
  return [
    cssVariable("--background-primary", "#ffffff"),
    cssVariable("--text-normal", "#222222"),
    cssVariable("--font-text", "system-ui, sans-serif"),
    cssVariable("--font-text-size", "18"),
    zoom,
    lineHeight,
  ].join("|");
}

export function applyReaderTheme(
  rendition: Rendition,
  readerZoom: number,
  readerLineHeight: number,
): void {
  const zoom = clampReaderZoom(readerZoom);
  const lineHeight = clampReaderLineHeight(readerLineHeight).toString();
  const baseSize = Number.parseFloat(cssVariable("--font-text-size", "18")) || 18;
  const fontSize = `${baseSize * zoom}px`;
  const background = cssVariable("--background-primary", "#ffffff");
  const text = cssVariable("--text-normal", "#222222");
  const fontFamily = cssVariable("--font-text", "system-ui, sans-serif");

  rendition.themes.register("obsidian", {
    "html, body": {
      background: `${background} !important`,
      color: `${text} !important`,
      "font-family": `${fontFamily} !important`,
      "font-size": `${fontSize} !important`,
      "line-height": `${lineHeight} !important`,
    },
    "p, div, span, li, blockquote, section, article": {
      color: `${text} !important`,
      "font-family": `${fontFamily} !important`,
      "font-size": "inherit !important",
      "line-height": `${lineHeight} !important`,
    },
  });
  rendition.themes.select("obsidian");
}
