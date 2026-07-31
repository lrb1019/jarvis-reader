// Extracted from main.js L49177-51296 — EpubReader React component
import React, { useState, useRef, useEffect, useCallback, useMemo, useLayoutEffect } from "react";
import { Notice, setIcon, MarkdownRenderer } from "obsidian";
import { ReactReader } from "react-reader";
import * as ReactReaderModule from "react-reader";
import { normalizeHighlightQuote, normalizeWordDisplayText, escapeRegExp, formatLocalDate, confirmDestructiveAction } from "./utils";
import { normalizeWordSelection, findWordAssetBySurface, getWordAssetSurfaceForms, getTranslationAssetKind, getTranslationAssetKey, getTranslationAssetStorageKey, buildWordAudioUrl } from "./word-assets";
import { clampReaderZoom, clampReaderLineHeight, getJarvisReaderTheme, applyObsidianThemeToRendition } from "./theme";
import { findChapterTitle, getReaderProgressLabel, ensureReaderLocations, getReaderProgress } from "./progress";
import { dedupeHighlightsByCfi } from "./highlight-core";
import { formatLocalDateTime } from "./utils-core";
import { WikiLinkCodeMirrorEditor } from "./wiki-editor";
import type { BookHighlight, WordAsset } from "./types";
import { triggerClaudianPrompt, prepareSmartCommandPromptFromVault } from "./claudianBridge";
import type { SmartCommand } from "./claudianBridge";
import { ReaderSideControls } from "./reader/ReaderSideControls";
import { moveFloatingCardRect } from "./floating-card-core";

export interface EpubReaderProps {
  contents: ArrayBuffer;
  title: string;
  bookPath: string;
  scrolled: boolean;
  singlePage: boolean;
  readerZoom: number;
  readerLineHeight: number;
  tocOffset: number;
  initLocation: string | null;
  saveLocation: (cfi: string) => void;
  saveProgress: (relocated: any, chapterTitle: string, rendition: any) => void;
  tocMemo: (toc: any) => void;
  createBookNote: () => void;
  highlights: BookHighlight[];
  createHighlight: (highlight: any) => Promise<BookHighlight | null>;
  updateHighlight: (highlight: any) => Promise<BookHighlight | null>;
  deleteHighlight: (highlight: any) => Promise<boolean>;
  selectHighlight: (highlight: any) => void;
  registerHighlightEditor: (fn: any) => void;
  registerHighlightDeleted: (fn: any) => void;
  setScrolled: (value: boolean) => void;
  setSinglePage: (value: boolean) => void;
  setReaderZoom: (delta: number) => void;
  setReaderLineHeight: (delta: number) => void;
  syncRenditionTheme: (rendition: any) => void;
  wordAssets: Record<string, any>;
  translateSelection: (text: string, sentence: string, options?: any) => Promise<any>;
  saveWordAsset: (selection: any, result: any) => Promise<any>;
  openWordNote: (asset: any) => void;
  setWordMastered: (asset: any, mastered: boolean) => Promise<any>;
  deleteWordAsset: (asset: any) => Promise<boolean>;
  loadWordDisplay: (asset: any) => Promise<string>;
  addBookmark?: (cfi: string, title: string) => void;
  autoWordHighlight: boolean;
  speechLang: string;
  highlightColors?: Record<string, string>;
  enableWordAudio: boolean;
  wordAudioTemplate: string;
  wordAudioAccent: string;
  blurWordCardBody: boolean;
  wikiLinkCandidates: any[];
  getWikiLinkCandidates: () => any[];
  openWikiLink: (target: string) => void;
  promoteHighlight?: (highlight: BookHighlight) => Promise<void>;
  onInteraction?: () => void;
  app?: any;
  smartCommands?: SmartCommand[];
  bookTitle?: string;
}

const ReactReaderStyle = (ReactReaderModule as typeof ReactReaderModule & {
  ReactReaderStyle: Record<string, React.CSSProperties>;
}).ReactReaderStyle;

export function getWordLookupResultFromAsset(asset, selectedText = "") {
  if (!asset)
    return null;
  return {
    lemma: asset.lemma || "",
    surface: selectedText || asset.title || asset.lemma || "",
    translation: asset.translation || "",
    phonetic: asset.phonetic || "",
    partOfSpeech: asset.partOfSpeech || "",
    example: asset.example || "",
    display: asset.display || "",
    isWord: asset.isWord !== false && getTranslationAssetKind(asset) !== "sentence"
  };
}
export function getLightWordAsset(asset) {
  if (!asset)
    return asset;
  return {
    ...asset
  };
}
export const WORD_DISPLAY_MAX_CHARS = 8e3;
export const WORD_DISPLAY_CACHE_LIMIT = 50;

export function truncateWordDisplay(value) {
  const text = normalizeWordDisplayText(value);
  if (text.length <= WORD_DISPLAY_MAX_CHARS)
    return text;
  return `${text.slice(0, WORD_DISPLAY_MAX_CHARS).trimEnd()}\n\n...`;
}
export function renderWordCardDisplayText(text) {
  const value = String(text || "");
  const parts = [];
  const pattern = /(\*\*|__)([\s\S]+?)\1/g;
  let lastIndex = 0;
  let match = null;
  while ((match = pattern.exec(value))) {
    if (match.index > lastIndex) {
      parts.push(value.slice(lastIndex, match.index));
    }
    parts.push(React.createElement("strong", { key: `bold-${parts.length}` }, match[2]));
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < value.length) {
    parts.push(value.slice(lastIndex));
  }
  return parts.length ? parts : value;
}
export function getWordCardDisplayLineMeta(line) {
  const raw = String(line || "");
  const trimmed = raw.trim();
  if (/^#{1,6}\s+/.test(trimmed)) {
    return {
      className: "jarvis-reader-word-card-display-heading",
      text: trimmed.replace(/^#{1,6}\s+/, "")
    };
  }
  if (/^>\s*/.test(trimmed)) {
    return {
      className: "jarvis-reader-word-card-display-quote",
      text: trimmed.replace(/^>\s*/, "")
    };
  }
  if (/^(?:[-*]|\d+[.)])\s+/.test(trimmed)) {
    return {
      className: "jarvis-reader-word-card-display-list",
      text: trimmed.replace(/^(?:[-*]|\d+[.)])\s+/, "")
    };
  }
  return {
    className: "jarvis-reader-word-card-display-line",
    text: raw
  };
}
export function buildWordMatchRegex(lemma) {
  const normalized = normalizeWordSelection(lemma);
  if (!normalized)
    return null;
  const pattern = normalized.tokens.map((token) => escapeRegExp(token)).join("\\s+");
  return new RegExp(`(^|[^A-Za-z'-])(${pattern})(?=$|[^A-Za-z'-])`, "gi");
}
export function clampFloatingCardPosition(container, rect, width = 320, height = 180) {
  const containerRect = container && typeof container.getBoundingClientRect === "function" ? container.getBoundingClientRect() : null;
  const boundsWidth = Math.max(360, (containerRect == null ? void 0 : containerRect.width) || window.innerWidth || 960);
  const boundsHeight = Math.max(240, (containerRect == null ? void 0 : containerRect.height) || window.innerHeight || 720);
  const left = rect ? rect.left - (containerRect == null ? void 0 : containerRect.left) : 24;
  const top = rect ? rect.bottom - (containerRect == null ? void 0 : containerRect.top) + 8 : 24;
  return {
    left: Math.min(boundsWidth - width - 16, Math.max(16, left)),
    top: Math.min(boundsHeight - height - 16, Math.max(16, top))
  };
}

const ObsidianMarkdown: React.FC<{ text: string; onOpenLink?: (target: string) => void }> = ({ text, onOpenLink }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.empty();
    const globalApp = (window as any).app;
    if (globalApp) {
      MarkdownRenderer.render(
        globalApp,
        text || "",
        el,
        "",
        globalApp.plugins?.plugins?.["jarvis-reader"] || null
      ).catch(console.error);
    } else {
      el.textContent = text || "";
    }
  }, [text]);

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const anchor = target.closest("a");
    if (anchor && anchor.classList.contains("internal-link")) {
      e.preventDefault();
      e.stopPropagation();
      const href = anchor.getAttribute("data-href") || anchor.getAttribute("href");
      if (href && typeof onOpenLink === "function") {
        onOpenLink(href);
      }
    }
  };

  return React.createElement("div", {
    ref: containerRef,
    onClick: handleClick,
    className: "markdown-preview-view clean-markdown-view"
  });
};

export const EpubReader: React.FC<EpubReaderProps> = ({ contents, title, bookPath, scrolled, singlePage, readerZoom, readerLineHeight, tocOffset, initLocation, saveLocation, saveProgress, tocMemo, createBookNote, highlights, createHighlight, updateHighlight, deleteHighlight, selectHighlight, registerHighlightEditor, registerHighlightDeleted, setScrolled, setSinglePage, setReaderZoom, setReaderLineHeight, syncRenditionTheme, wordAssets, translateSelection, saveWordAsset, openWordNote, setWordMastered, deleteWordAsset, loadWordDisplay, addBookmark, autoWordHighlight, speechLang, highlightColors, enableWordAudio, wordAudioTemplate, wordAudioAccent, blurWordCardBody, wikiLinkCandidates, getWikiLinkCandidates, openWikiLink, promoteHighlight, onInteraction, app, smartCommands, bookTitle }) => {
  const [location, setLocation] = useState<any>(initLocation);
  const [readerTitle, setReaderTitle] = useState<any>(title);
  const [progressLabel, setProgressLabel] = useState<any>("");
  const [highlightList, setHighlightList] = useState<any[]>(highlights || []);
  const [pendingSelection, setPendingSelection] = useState<any>(null);
  const [highlightComment, setHighlightComment] = useState<any>("");
  const [highlightCommentMode, setHighlightCommentMode] = useState<any>("edit");
  const [editingNoteIndex, setEditingNoteIndex] = useState<number | null>(null);
  const [highlightContentTab, setHighlightContentTab] = useState<any>("notes");
  const [showAssocDropdown, setShowAssocDropdown] = useState<boolean>(false);
  const [assocSearchQuery, setAssocSearchQuery] = useState<string>("");
  const [activeFileContent, setActiveFileContent] = useState<string>("");
  const [activeFileCachePath, setActiveFileCachePath] = useState<string>("");
  const [currentWordAssets, setCurrentWordAssets] = useState<any>(wordAssets || {});
  const [pendingWordSelection, setPendingWordSelection] = useState<any>(null);
  const [wordLookupState, setWordLookupState] = useState<any>({ status: "idle", result: null, error: "", savedLemma: "" });
  const [activeWordHover, setActiveWordHover] = useState<any>(null);
  const [currentWikiLinkCandidates, setCurrentWikiLinkCandidates] = useState<any[]>(wikiLinkCandidates || []);
  const [pendingHighlightMenu, setPendingHighlightMenu] = useState<any>(null);
  const [wikiSuggest, setWikiSuggest] = useState<any>(null);
  const [wikiEditRange, setWikiEditRange] = useState<any>(null);
  const [highlightPopoverRect, setHighlightPopoverRect] = useState<any>(null);
  const [wordTranslationRect, setWordTranslationRect] = useState<any>(null);
  const containerRef = useRef<any>(null);
  const highlightInputRef = useRef<any>(null);
  const highlightPopoverRectRef = useRef<any>(null);
  const wordTranslationRectRef = useRef<any>(null);
  const renditionRef = useRef<any>(null);
  const currentLocationRef = useRef<string | null>(initLocation);
  const pendingInitLocationRef = useRef<string | null>(initLocation);
  const highlightListRef = useRef<any[]>(highlights || []);
  const wordAssetsRef = useRef<any>(wordAssets || {});
  const wordDisplayCacheRef = useRef<any>( new Map());
  const pendingWordLookupRef = useRef<any>(0);
  const [theme, setTheme] = useState(() => getJarvisReaderTheme(readerZoom, readerLineHeight));
  const [currentColors, setCurrentColors] = useState<any>(highlightColors);
  // Smart command submenu: "selection" | "note" | null
  const [smartCmdMenuScope, setSmartCmdMenuScope] = useState<"selection" | "note" | null>(null);
  const smartCmdMenuRef = useRef<HTMLButtonElement | null>(null);
  const [activeSelectionInfo, setActiveSelectionInfo] = useState<any>(null);
  const activeSelectionInfoRef = useRef<any>(null);
  const [hoveredMenuItem, setHoveredMenuItem] = useState<string | null>(null);

  useEffect(() => {
    setCurrentColors(highlightColors);
  }, [highlightColors]);

  useEffect(() => {
    const handleColorChange = (e: any) => {
      if (e.detail) {
        setCurrentColors(e.detail);
      }
    };
    window.addEventListener("jarvis-reader-colors-changed", handleColorChange);
    return () => window.removeEventListener("jarvis-reader-colors-changed", handleColorChange);
  }, []);

  useEffect(() => {
    let lastThemeKey = `${theme.background}|${theme.text}|${theme.fontFamily}|${theme.fontSize}|${theme.lineHeight}|${readerZoom}`;
    const intervalId = setInterval(() => {
      const nextTheme = getJarvisReaderTheme(readerZoom, readerLineHeight);
      const nextThemeKey = `${nextTheme.background}|${nextTheme.text}|${nextTheme.fontFamily}|${nextTheme.fontSize}|${nextTheme.lineHeight}|${readerZoom}`;
      if (nextThemeKey !== lastThemeKey) {
        setTheme(nextTheme);
        lastThemeKey = nextThemeKey;
      }
    }, 1000);
    return () => clearInterval(intervalId);
  }, [readerZoom, readerLineHeight]);

  useEffect(() => {
    if (!renditionRef.current || !currentColors) return;
    try {
      const rendition = renditionRef.current;
      if (highlightListRef.current) {
        for (const highlight of highlightListRef.current) {
          if (highlight.cfiRange) {
            rendition.annotations.remove(highlight.cfiRange, "highlight");
            rendition.annotations.remove(highlight.cfiRange, "underline");
          }
        }
      }
      if (rendition.__awesomeReaderHighlightIds) {
        rendition.__awesomeReaderHighlightIds.clear();
      }
      
      clearAutoWordHighlights(rendition);
      
      applyHighlights(rendition, highlightListRef.current);
      syncAutoWordHighlights(rendition);
    } catch (e) {
      console.warn("Jarvis Reader: Failed to redraw annotations on color change", e);
    }
  }, [currentColors]);

  const wordHoverHideTimerRef = useRef<any>(null);
  const pendingHighlightMenuRef = useRef<any>(null);
  const pendingWordSelectionRef = useRef<any>(null);
  const readerTitleRef = useRef<any>(title);
  const tocRef = useRef<any[]>([]);
  const effectiveScrolled = scrolled && singlePage;
  const maxReaderWidth = !effectiveScrolled && singlePage ? 760 : 1120;
  const getHighlightPopoverBounds = () => {
    const rect = containerRef.current && typeof containerRef.current.getBoundingClientRect === "function" ? containerRef.current.getBoundingClientRect() : null;
    return {
      width: Math.max(320, (rect == null ? void 0 : rect.width) || window.innerWidth || 960),
      height: Math.max(240, (rect == null ? void 0 : rect.height) || window.innerHeight || 720)
    };
  };
  const clampHighlightPopoverRect = (rect) => {
    const bounds = getHighlightPopoverBounds();
    const margin = 16;
    const minWidth = Math.min(360, Math.max(280, bounds.width - margin * 2));
    const minHeight = Math.min(260, Math.max(220, bounds.height - margin * 2));
    const maxWidth = Math.max(minWidth, bounds.width - margin * 2);
    const maxHeight = Math.max(minHeight, bounds.height - margin * 2);
    const width = Math.min(maxWidth, Math.max(minWidth, rect.width || 560));
    const height = Math.min(maxHeight, Math.max(minHeight, rect.height || 300));
    const maxX = Math.max(margin, bounds.width - width - margin);
    const maxY = Math.max(margin, bounds.height - height - margin);
    return {
      x: Math.min(maxX, Math.max(margin, rect.x || margin)),
      y: Math.min(maxY, Math.max(margin, rect.y || margin)),
      width,
      height
    };
  };
  const getDefaultHighlightPopoverRect = () => {
    const bounds = getHighlightPopoverBounds();
    const width = Math.min(560, Math.max(360, bounds.width - 120));
    const height = Math.min(420, Math.max(360, bounds.height - 100));
    return clampHighlightPopoverRect({
      x: bounds.width - width - 32,
      y: Math.max(16, (bounds.height - height) / 2),
      width,
      height
    });
  };
  const clampHighlightMenuRect = (rect) => {
    const bounds = getHighlightPopoverBounds();
    const margin = 14;
    const width = Math.min(280, Math.max(220, rect.width || 236));
    const height = rect.height || 48;
    const maxX = Math.max(margin, bounds.width - width - margin);
    const maxY = Math.max(margin, bounds.height - height - margin);
    return {
      x: Math.min(maxX, Math.max(margin, rect.x || margin)),
      y: Math.min(maxY, Math.max(margin, rect.y || margin)),
      width
    };
  };
  const getDefaultHighlightMenuRect = () => {
    const bounds = getHighlightPopoverBounds();
    return clampHighlightMenuRect({
      x: (bounds.width - 236) / 2,
      y: Math.max(18, bounds.height * 0.28),
      width: 236
    });
  };
  const getSelectionHighlightMenuRect = (contents2) => {
    var _a, _b;
    try {
      const selection = (_a = contents2 == null ? void 0 : contents2.window) == null ? void 0 : _a.getSelection();
      if (!selection || !selection.rangeCount)
        return getDefaultHighlightMenuRect();
      const rangeRect = selection.getRangeAt(0).getBoundingClientRect();
      const frame = (_b = contents2 == null ? void 0 : contents2.window) == null ? void 0 : _b.frameElement;
      const frameRect = frame && typeof frame.getBoundingClientRect === "function" ? frame.getBoundingClientRect() : null;
      const containerRect = containerRef.current && typeof containerRef.current.getBoundingClientRect === "function" ? containerRef.current.getBoundingClientRect() : null;
      if (!rangeRect || !containerRect)
        return getDefaultHighlightMenuRect();
      const left = rangeRect.left + ((frameRect == null ? void 0 : frameRect.left) || 0) - containerRect.left;
      const top = rangeRect.top + ((frameRect == null ? void 0 : frameRect.top) || 0) - containerRect.top;
      return clampHighlightMenuRect({
        x: left + rangeRect.width / 2 - 118,
        y: top - 58,
        width: 236
      });
    } catch (error) {
      return getDefaultHighlightMenuRect();
    }
  };
  const getEventHighlightMenuRect = (event) => {
    try {
      const containerRect = containerRef.current && typeof containerRef.current.getBoundingClientRect === "function" ? containerRef.current.getBoundingClientRect() : null;
      if (!event || !containerRect)
        return getDefaultHighlightMenuRect();
      const target = event.currentTarget || event.target;
      const targetRect = target && typeof target.getBoundingClientRect === "function" ? target.getBoundingClientRect() : null;
      if (targetRect) {
        return clampHighlightMenuRect({
          x: targetRect.left + targetRect.width / 2 - containerRect.left - 118,
          y: targetRect.top - containerRect.top - 58,
          width: 236
        });
      }
      if (typeof event.clientX !== "number" || typeof event.clientY !== "number")
        return getDefaultHighlightMenuRect();
      return clampHighlightMenuRect({
        x: event.clientX - containerRect.left - 118,
        y: event.clientY - containerRect.top - 58,
        width: 236
      });
    } catch (error) {
      return getDefaultHighlightMenuRect();
    }
  };
  const resetHighlightPopoverRect = () => {
    const next = getDefaultHighlightPopoverRect();
    highlightPopoverRectRef.current = next;
    setHighlightPopoverRect(next);
  };
  const getDefaultWordTranslationRect = () => {
    const rect = getDefaultHighlightPopoverRect();
    return {
      ...rect,
      width: Math.min(rect.width || 480, 480)
    };
  };
  const resetWordTranslationRect = () => {
    const next = getDefaultWordTranslationRect();
    wordTranslationRectRef.current = next;
    setWordTranslationRect(next);
  };
  const beginWordTranslationMove = (event) => {
    if (event.button != null && event.button !== 0)
      return;
    const interactiveTarget = event.target && typeof event.target.closest === "function" ? event.target.closest("button, textarea, input, .cm-editor") : null;
    if (interactiveTarget)
      return;
    event.preventDefault();
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const startRect = wordTranslationRectRef.current || getDefaultWordTranslationRect();
    wordTranslationRectRef.current = startRect;
    setWordTranslationRect(startRect);
    const startPointer = { x: event.clientX, y: event.clientY };
    const onMove = (moveEvent) => {
      const next = moveFloatingCardRect(startRect, startPointer, {
        x: moveEvent.clientX,
        y: moveEvent.clientY
      });
      wordTranslationRectRef.current = next;
      setWordTranslationRect(next);
    };
    const onUp = () => {
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
      if (target.hasPointerCapture(event.pointerId)) {
        target.releasePointerCapture(event.pointerId);
      }
    };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp, { once: true });
  };
  const beginHighlightPopoverMove = (event) => {
    if (event.button != null && event.button !== 0)
      return;
    const interactiveTarget = event.target && typeof event.target.closest === "function" ? event.target.closest("button, textarea, input, .cm-editor") : null;
    if (interactiveTarget)
      return;
    event.preventDefault();
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const startRect = highlightPopoverRectRef.current || getDefaultHighlightPopoverRect();
    highlightPopoverRectRef.current = startRect;
    setHighlightPopoverRect(startRect);
    const startX = event.clientX;
    const startY = event.clientY;
    const onMove = (moveEvent) => {
      const next = clampHighlightPopoverRect({
        ...startRect,
        x: startRect.x + moveEvent.clientX - startX,
        y: startRect.y + moveEvent.clientY - startY
      });
      highlightPopoverRectRef.current = next;
      setHighlightPopoverRect(next);
    };
    const onUp = () => {
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
      if (target.hasPointerCapture(event.pointerId)) {
        target.releasePointerCapture(event.pointerId);
      }
    };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp, { once: true });
  };
  const beginHighlightPopoverResize = (event) => {
    if (event.button != null && event.button !== 0)
      return;
    event.preventDefault();
    event.stopPropagation();
    const startRect = highlightPopoverRectRef.current || getDefaultHighlightPopoverRect();
    highlightPopoverRectRef.current = startRect;
    setHighlightPopoverRect(startRect);
    const startX = event.clientX;
    const startY = event.clientY;
    const onMove = (moveEvent) => {
      const next = clampHighlightPopoverRect({
        ...startRect,
        width: startRect.width + moveEvent.clientX - startX,
        height: startRect.height + moveEvent.clientY - startY
      });
      highlightPopoverRectRef.current = next;
      setHighlightPopoverRect(next);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  };
  const epubOptions: Record<string, unknown> = effectiveScrolled ? {
    allowPopups: false,
    flow: "scrolled",
    manager: "continuous"
  } : {
    allowPopups: false
  };
  if (!effectiveScrolled && singlePage) {
    epubOptions.spread = "none";
  }
  const locationChanged = (epubcifi) => {
    const pendingInitLocation = pendingInitLocationRef.current;
    if (pendingInitLocation && epubcifi && epubcifi !== pendingInitLocation) {
      return;
    }
    if (pendingInitLocation && epubcifi === pendingInitLocation) {
      pendingInitLocationRef.current = null;
    }
    setLocation(epubcifi);
    currentLocationRef.current = epubcifi;
    saveLocation(epubcifi);
  };
  const applyPendingInitLocation = (rendition) => {
    const targetCfi = pendingInitLocationRef.current;
    if (!targetCfi || !rendition || typeof rendition.display !== "function") {
      return;
    }
    pendingInitLocationRef.current = null;
    let attempts = 0;
    const maxAttempts = 8;
    let keepRetrying = true;
    const run = () => {
      if (!keepRetrying) return;
      attempts += 1;
      Promise.resolve(rendition.display(targetCfi)).catch(() => void 0).finally(() => {
        if (keepRetrying && attempts < maxAttempts) {
          window.setTimeout(run, 180);
        }
      });
    };
    const stopRetry = (relocated: any) => {
      const relocatedCfi = relocated?.start?.cfi || relocated?.end?.cfi || "";
      if (relocatedCfi === targetCfi) {
        keepRetrying = false;
        rendition.off("relocated", stopRetry);
      }
    };
    rendition.on("relocated", stopRetry);
    window.setTimeout(() => {
      keepRetrying = false;
      rendition.off("relocated", stopRetry);
    }, 3000);
    window.setTimeout(run, 80);
  };
  const refreshHighlightPanes = (rendition) => {
    window.setTimeout(() => {
      window.requestAnimationFrame(() => {
        var _a, _b;
        try {
          if (!rendition || !rendition.manager || !rendition.manager.stage)
            return;
          const views = (typeof rendition.manager.visible === "function" ? rendition.manager.visible() : null) || [];
          for (const view of views) {
            if (view && view.pane && typeof view.pane.render === "function") {
              view.pane.render();
            }
          }
        } catch (error) {
          console.warn("Jarvis Reader highlight refresh failed.", error);
        }
      });
    }, 80);
  };
  const purgeHighlightMarks = (rendition, cfiRange) => {
    if (!rendition || !cfiRange)
      return;
    try {
      rendition.annotations?.remove(cfiRange, "highlight");
      rendition.annotations?.remove(cfiRange, "underline");
      const viewsCollection = typeof rendition.views === "function" ? rendition.views() : null;
      const views = viewsCollection ? (typeof viewsCollection.all === "function" ? viewsCollection.all() : viewsCollection) : [];
      for (const view of views) {
        const pane = view?.pane;
        if (!pane || !Array.isArray(pane.marks) || typeof pane.removeMark !== "function")
          continue;
        const staleMarks = pane.marks.filter((mark) => mark?.data?.epubcfi === cfiRange && String(mark?.className || "").startsWith("jarvis-reader-highlight"));
        for (const mark of staleMarks) {
          pane.removeMark(mark);
        }
        if (view.highlights)
          delete view.highlights[cfiRange];
        if (view.underlines)
          delete view.underlines[cfiRange];
      }
    } catch (error) {
      console.warn("Jarvis Reader stale highlight cleanup failed.", error);
    }
  };
  const applyHighlight = (rendition, highlight) => {
    if (!rendition || !rendition.annotations || !highlight || !highlight.cfiRange)
      return;
    if (!rendition.__awesomeReaderHighlightIds) {
      rendition.__awesomeReaderHighlightIds =  new Set();
    }
    const key = highlight.id || highlight.cfiRange;
    if (rendition.__awesomeReaderHighlightIds.has(key))
      return;
    rendition.__awesomeReaderHighlightIds.add(key);
    try {
      purgeHighlightMarks(rendition, highlight.cfiRange);
      const eventHandler = (event) => {
        const liveHighlight = (highlightListRef.current || []).find((item) => item.id === highlight.id || item.cfiRange === highlight.cfiRange) || highlight;
        selectHighlight(liveHighlight);
        if ((liveHighlight.comment || "").trim()) {
          openHighlightCommentEditor(liveHighlight);
          return;
        }
        setPendingSelection(null);
        setHighlightComment("");
        setWikiSuggest(null);
        setWikiEditRange(null);
        setPendingHighlightMenu({
          ...liveHighlight,
          chapterTitle: liveHighlight.chapterTitle || readerTitleRef.current,
          rect: getEventHighlightMenuRect(event)
        });
      };

      if (highlight.comment) {
        const commentColor = currentColors?.comment || "#f97316";
        rendition.annotations.highlight(highlight.cfiRange, { id: highlight.id, cfiRange: highlight.cfiRange }, eventHandler, "jarvis-reader-highlight-with-comment-bg", {
          fill: commentColor,
          "fill-opacity": "0.15",
          "mix-blend-mode": "multiply"
        });
        rendition.annotations.underline(highlight.cfiRange, { id: highlight.id, cfiRange: highlight.cfiRange }, eventHandler, "jarvis-reader-highlight-with-comment", {
          stroke: commentColor,
          "stroke-opacity": "0.98",
          "stroke-width": "2.0",
          "mix-blend-mode": "multiply"
        });
      } else {
        const normalColor = currentColors?.normal || "#ffeb3b";
        rendition.annotations.highlight(highlight.cfiRange, { id: highlight.id, cfiRange: highlight.cfiRange }, eventHandler, "jarvis-reader-highlight", {
          fill: normalColor,
          "fill-opacity": "0.24",
          "mix-blend-mode": "multiply"
        });
      }
      refreshHighlightPanes(rendition);
    } catch (error) {
      console.warn("Jarvis Reader highlight render failed.", error);
    }
  };
  const applyHighlights = (rendition, list) => {
    for (const highlight of dedupeHighlightsByCfi(list).filter((item) => item?.cfiRange)) {
      applyHighlight(rendition, highlight);
    }
    refreshHighlightPanes(rendition);
  };
  const removeHighlightMark = (rendition, highlight) => {
    if (!rendition || !rendition.annotations || !highlight || !highlight.cfiRange)
      return;
    try {
      purgeHighlightMarks(rendition, highlight.cfiRange);
      if (rendition.__awesomeReaderHighlightIds) {
        for (const key of [...rendition.__awesomeReaderHighlightIds]) {
          const sameHighlight = (highlightListRef.current || []).find((item) => (item.id || item.cfiRange) === key);
          if (key === highlight.id || key === highlight.cfiRange || sameHighlight?.cfiRange === highlight.cfiRange)
            rendition.__awesomeReaderHighlightIds.delete(key);
        }
      }
      refreshHighlightPanes(rendition);
    } catch (error) {
      console.warn("Jarvis Reader highlight remove failed.", error);
    }
  };
  const clearWordHoverHideTimer = () => {
    if (wordHoverHideTimerRef.current) {
      window.clearTimeout(wordHoverHideTimerRef.current);
      wordHoverHideTimerRef.current = null;
    }
  };
  const hideWordHoverCard = () => {
    clearWordHoverHideTimer();
    setActiveWordHover(null);
  };
  const scheduleHideWordHoverCard = () => {
    clearWordHoverHideTimer();
    wordHoverHideTimerRef.current = window.setTimeout(() => {
      setActiveWordHover((prev) => (prev && prev.isPinned) ? prev : null);
    }, 120);
  };
  const loadWordDisplayIntoHover = (asset) => {
    const normalized = normalizeWordSelection((asset == null ? void 0 : asset.lemma) || "");
    if (!normalized || !asset || asset.display || typeof loadWordDisplay !== "function")
      return;
    const cacheKey = normalized.lemma;
    const cache = wordDisplayCacheRef.current;
    if (cache.has(cacheKey)) {
      const cachedDisplay = cache.get(cacheKey);
      cache.delete(cacheKey);
      cache.set(cacheKey, cachedDisplay);
      setActiveWordHover((current) => current && current.asset && normalizeWordSelection(current.asset.lemma || "") && normalizeWordSelection(current.asset.lemma || "").lemma === normalized.lemma ? {
        ...current,
        asset: {
          ...current.asset,
          display: cachedDisplay
        }
      } : current);
      return;
    }
    Promise.resolve(loadWordDisplay(asset)).then((display) => {
      const nextDisplay = truncateWordDisplay(display);
      if (!nextDisplay)
        return;
      cache.set(cacheKey, nextDisplay);
      while (cache.size > WORD_DISPLAY_CACHE_LIMIT) {
        const oldestKey = cache.keys().next().value;
        cache.delete(oldestKey);
      }
      setActiveWordHover((current) => current && current.asset && normalizeWordSelection(current.asset.lemma || "") && normalizeWordSelection(current.asset.lemma || "").lemma === normalized.lemma ? {
        ...current,
        asset: {
          ...current.asset,
          display: nextDisplay
        }
      } : current);
    }).catch(() => {
    });
  };
  const playWordAudioText = (text) => {
    if (!enableWordAudio || !text)
      return;
    const audioUrl = buildWordAudioUrl(wordAudioTemplate, text, wordAudioAccent);
    if (audioUrl) {
      try {
        const audio = new Audio(audioUrl);
        audio.play().catch(() => {
          if (typeof speechSynthesis === "undefined")
            return;
          speechSynthesis.cancel();
          const utterance = new SpeechSynthesisUtterance(text);
          utterance.lang = speechLang || (String(wordAudioAccent || "us").toLowerCase() === "uk" ? "en-GB" : "en-US");
          utterance.rate = 0.92;
          speechSynthesis.speak(utterance);
        });
        return;
      } catch (error) {
        console.warn("Jarvis Reader word audio URL failed.", error);
      }
    }
    if (typeof speechSynthesis === "undefined")
      return;
    try {
      speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = speechLang || (String(wordAudioAccent || "us").toLowerCase() === "uk" ? "en-GB" : "en-US");
      utterance.rate = 0.92;
      speechSynthesis.speak(utterance);
    } catch (error) {
      console.warn("Jarvis Reader word audio failed.", error);
    }
  };

  const beginWordHoverCardMove = (event) => {
    if (event.button != null && event.button !== 0) return;
    event.preventDefault();
    clearWordHoverHideTimer();
    const startX = event.clientX;
    const startY = event.clientY;
    const target = event.target;
    target.setPointerCapture(event.pointerId);
    setActiveWordHover((prev) => {
      if (!prev) return null;
      const startLeft = prev.left || 0;
      const startTop = prev.top || 0;
      const onMove = (moveEvent) => {
        const nextLeft = startLeft + moveEvent.clientX - startX;
        const nextTop = startTop + moveEvent.clientY - startY;
        setActiveWordHover((current) => current ? { ...current, left: nextLeft, top: nextTop, isPinned: true } : null);
      };
      const onUp = (upEvent) => {
        target.removeEventListener("pointermove", onMove);
        target.removeEventListener("pointerup", onUp);
        target.releasePointerCapture(event.pointerId);
      };
      target.addEventListener("pointermove", onMove);
      target.addEventListener("pointerup", onUp, { once: true });
      return { ...prev, isPinned: true };
    });
  };
  const resetWordHoverCardPosition = () => {
    setActiveWordHover((prev) => {
      if (!prev) return null;
      scheduleHideWordHoverCard();
      return { ...prev, isPinned: false };
    });
  };
const showWordHoverCard = (asset, element) => {
    if (!asset || !element)
      return;
    clearWordHoverHideTimer();
    const rect = typeof element.getBoundingClientRect === "function" ? element.getBoundingClientRect() : null;
    const position = clampFloatingCardPosition(containerRef.current, rect, 320, 190);
    setActiveWordHover({
      asset,
      left: position.left,
      top: position.top
    });
    loadWordDisplayIntoHover(asset);
  };
  const showWordHoverCardAtRect = (asset, rect) => {
    if (!asset || !rect)
      return;
    clearWordHoverHideTimer();
    const position = clampFloatingCardPosition(containerRef.current, rect, 360, 220);
    setActiveWordHover({
      asset,
      left: position.left,
      top: position.top
    });
    loadWordDisplayIntoHover(asset);
  };
  const getWordAssetAtPoint = (contents2, event) => {
    var _a, _b;
    const doc = contents2 == null ? void 0 : contents2.document;
    const win = ((_a = contents2 == null ? void 0 : contents2.window) != null ? _a : doc == null ? void 0 : doc.defaultView);
    if (!doc || !win || !wordAssetsRef.current)
      return null;
    const selectionText = normalizeHighlightQuote((_b = win.getSelection == null ? void 0 : win.getSelection().toString()) != null ? _b : "");
    if (selectionText)
      return null;
    let range = null;
    try {
      if (typeof doc.caretRangeFromPoint === "function") {
        range = doc.caretRangeFromPoint(event.clientX, event.clientY);
      } else if (typeof doc.caretPositionFromPoint === "function") {
        const position = doc.caretPositionFromPoint(event.clientX, event.clientY);
        if (position && position.offsetNode) {
          range = doc.createRange();
          range.setStart(position.offsetNode, position.offset);
          range.collapse(true);
        }
      }
    } catch (error) {
      return null;
    }
    const node = range == null ? void 0 : range.startContainer;
    if (!node || node.nodeType !== Node.TEXT_NODE)
      return null;
    const text = node.nodeValue || "";
    let offset = Math.max(0, Math.min(text.length, range.startOffset || 0));
    if (offset === text.length && offset > 0)
      offset -= 1;
    if (!/[A-Za-z'-]/.test(text.charAt(offset)) && offset > 0 && /[A-Za-z'-]/.test(text.charAt(offset - 1)))
      offset -= 1;
    if (!/[A-Za-z'-]/.test(text.charAt(offset)))
      return null;
    let start = offset;
    let end = offset + 1;
    while (start > 0 && /[A-Za-z'-]/.test(text.charAt(start - 1)))
      start -= 1;
    while (end < text.length && /[A-Za-z'-]/.test(text.charAt(end)))
      end += 1;
    const normalized = normalizeWordSelection(text.slice(start, end));
    if (!normalized)
      return null;
    const asset = findWordAssetBySurface(wordAssetsRef.current, normalized.surface);
    if (!asset || asset.mastered)
      return null;
    const wordRange = doc.createRange();
    wordRange.setStart(node, start);
    wordRange.setEnd(node, end);
    const rect = wordRange.getBoundingClientRect();
    if (!rect || !rect.width || !rect.height)
      return null;
    const frameElement = win.frameElement;
    const frameRect = frameElement && typeof frameElement.getBoundingClientRect === "function" ? frameElement.getBoundingClientRect() : { left: 0, top: 0 };
    return {
      asset,
      rect: {
        left: frameRect.left + rect.left,
        right: frameRect.left + rect.right,
        top: frameRect.top + rect.top,
        bottom: frameRect.top + rect.bottom,
        width: rect.width,
        height: rect.height
      }
    };
  };
  const clearWordLookup = () => {
    pendingWordLookupRef.current += 1;
    setPendingWordSelection(null);
    setWordLookupState({ status: "idle", result: null, error: "", savedLemma: "" });
  };
  const openWordTranslator = async (item, options: { autoLocalOnly?: boolean } = {}) => {
    if (!item || typeof translateSelection !== "function")
      return false;
    wordTranslationRectRef.current = null;
    setWordTranslationRect(null);
    const normalized = normalizeWordSelection(item.quote || "");
    if (options.autoLocalOnly) {
      if (!normalized || !normalized.isSingleWord)
        return false;
      const requestId = pendingWordLookupRef.current + 1;
      pendingWordLookupRef.current = requestId;
      setPendingHighlightMenu(null);
      setPendingWordSelection({
        ...item,
        normalized
      });
      setWordLookupState({ status: "loading", result: null, error: "", savedLemma: "" });
      try {
        const localDictionaryResult = await translateSelection(item.quote || normalized.surface, item.sentence || "", { localOnly: true });
        if (pendingWordLookupRef.current !== requestId)
          return true;
        if (!localDictionaryResult)
          return false;
        setPendingSelection(null);
        setPendingHighlightMenu(null);
        setHighlightComment("");
        setWikiSuggest(null);
        setWikiEditRange(null);
        setPendingWordSelection({
          ...item,
          normalized
        });
        setWordLookupState({
          status: "ready",
          result: localDictionaryResult,
          error: "",
          savedLemma: ""
        });
        return true;
      } catch (error) {
        if (pendingWordLookupRef.current !== requestId)
          return true;
        console.warn("Jarvis Reader automatic local dictionary lookup failed.", error);
        return false;
      }
    }
    setPendingSelection(null);
    setPendingHighlightMenu(null);
    setHighlightComment("");
    setWikiSuggest(null);
    setWikiEditRange(null);
    setPendingWordSelection({
      ...item,
      normalized
    });
    setWordLookupState({ status: "loading", result: null, error: "", savedLemma: "" });
    if (normalized && normalized.isSingleWord) {
      try {
        const localDictionaryResult = await translateSelection(item.quote || normalized.surface, item.sentence || "", { localOnly: true });
        if (localDictionaryResult) {
          setWordLookupState({
            status: "ready",
            result: localDictionaryResult,
            error: "",
            savedLemma: ""
          });
          return true;
        }
      } catch (error) {
        console.warn("Jarvis Reader local dictionary lookup failed; trying saved card or AI.", error);
      }
    }
    const existingWordAsset = normalized ? findWordAssetBySurface(wordAssetsRef.current, normalized.surface) : null;
    if (existingWordAsset) {
      setWordLookupState({
        status: "ready",
        result: getWordLookupResultFromAsset(existingWordAsset, item.quote || normalized.surface),
        error: "",
        savedLemma: normalized.lemma
      });
      if (!existingWordAsset.display && typeof loadWordDisplay === "function") {
        Promise.resolve(loadWordDisplay(existingWordAsset)).then((display) => {
          const nextDisplay = truncateWordDisplay(display);
          if (!nextDisplay)
            return;
          setWordLookupState((current) => current.savedLemma === normalized.lemma && current.result ? {
            ...current,
            result: {
              ...current.result,
              display: nextDisplay
            }
          } : current);
        }).catch(() => {
        });
      }
      return true;
    }
    const requestId = pendingWordLookupRef.current + 1;
    pendingWordLookupRef.current = requestId;
    try {
      const result = await translateSelection(item.quote || "", item.sentence || "");
      if (pendingWordLookupRef.current !== requestId)
        return;
      setWordLookupState({
        status: "ready",
        result,
        error: "",
        savedLemma: ""
      });
    } catch (error) {
      if (pendingWordLookupRef.current !== requestId)
        return;
      setWordLookupState({
        status: "error",
        result: null,
        error: error && error.message ? error.message : String(error || "Translation failed."),
        savedLemma: ""
      });
    }
  };
  const persistPendingWordAsset = async () => {
    if (!pendingWordSelection || !wordLookupState.result || typeof saveWordAsset !== "function")
      return;
    try {
      let resultToSave = wordLookupState.result;
      if (resultToSave.sourceType === "online-translation" && typeof translateSelection === "function") {
        setWordLookupState((current) => ({
          ...current,
          status: "loading"
        }));
        resultToSave = await translateSelection(pendingWordSelection.quote || "", pendingWordSelection.sentence || "", { forceAi: true });
        setWordLookupState((current) => ({
          ...current,
          status: "ready",
          result: resultToSave
        }));
      }
      const asset = await saveWordAsset(pendingWordSelection, resultToSave);
      if (!asset)
        return;
      setCurrentWordAssets((current) => {
        const next = {
          ...current,
          [asset.lemma]: asset
        };
        wordAssetsRef.current = next;
        return next;
      });
      setWordLookupState((current) => ({
        ...current,
        savedLemma: asset.lemma
      }));
      if (renditionRef.current) {
        clearWordHoverHideTimer();
        setActiveWordHover(null);
        window.setTimeout(() => syncAutoWordHighlights(renditionRef.current), 0);
      }
    } catch (error) {
      new Notice(error && error.message ? error.message : "Failed to save translation.");
    }
  };
  const translatePendingWordWithAi = async () => {
    if (!pendingWordSelection || typeof translateSelection !== "function")
      return;
    const requestId = pendingWordLookupRef.current + 1;
    pendingWordLookupRef.current = requestId;
    setWordLookupState((current) => ({
      ...current,
      status: "loading",
      error: ""
    }));
    try {
      const result = await translateSelection(pendingWordSelection.quote || "", pendingWordSelection.sentence || "", { forceAi: true });
      if (pendingWordLookupRef.current !== requestId)
        return;
      setWordLookupState({
        status: "ready",
        result,
        error: "",
        savedLemma: ""
      });
      return true;
    } catch (error) {
      if (pendingWordLookupRef.current !== requestId)
        return;
      setWordLookupState({
        status: "error",
        result: null,
        error: error && error.message ? error.message : String(error || "Translation failed."),
        savedLemma: ""
      });
      return true;
    }
  };
  const restorePendingWordAsset = async () => {
    if (!savedWordAsset || typeof setWordMastered !== "function")
      return;
    const assetKey = getTranslationAssetStorageKey(savedWordAsset);
    if (!assetKey)
      return;
    try {
      const updated = await setWordMastered(savedWordAsset, false);
      setCurrentWordAssets((current) => {
        const next = {
          ...current,
          [assetKey]: updated || {
            ...savedWordAsset,
            mastered: false
          }
        };
        wordAssetsRef.current = next;
        return next;
      });
      clearAutoWordHighlights(renditionRef.current);
      syncAutoWordHighlights(renditionRef.current);
      new Notice("Word restored.");
    } catch (error) {
      new Notice(error && error.message ? error.message : "Failed to restore word.");
    }
  };
  const markActiveWordMastered = async () => {
    const asset = activeWordHover == null ? void 0 : activeWordHover.asset;
    const assetKey = getTranslationAssetStorageKey(asset);
    if (!asset || !assetKey || typeof setWordMastered !== "function")
      return;
    try {
      const updated = await setWordMastered(asset, true);
      setCurrentWordAssets((current) => {
        const next = {
          ...current,
          [assetKey]: updated || {
            ...asset,
            mastered: true
          }
        };
        wordAssetsRef.current = next;
        return next;
      });
      clearAutoWordHighlights(renditionRef.current);
      syncAutoWordHighlights(renditionRef.current);
      setActiveWordHover(null);
    } catch (error) {
      new Notice(error && error.message ? error.message : "Failed to mark mastered.");
    }
  };
  const deleteActiveWordAsset = async () => {
    const asset = activeWordHover == null ? void 0 : activeWordHover.asset;
    const assetKey = getTranslationAssetStorageKey(asset);
    if (!asset || !assetKey || typeof deleteWordAsset !== "function")
      return;
    const effectiveApp = app || (window as any).app;
    if (!effectiveApp) {
      new Notice("无法获取 Obsidian App 实例。");
      return;
    }
    const confirmed = await confirmDestructiveAction(
      effectiveApp,
      "删除词条",
      `确定要彻底删除词条“${asset.title || asset.lemma}”吗？此操作不可恢复。`
    );
    if (!confirmed)
      return;
    try {
      const deleted = await deleteWordAsset(asset);
      if (!deleted)
        return;
      setCurrentWordAssets((current) => {
        const next = {
          ...current
        };
        delete next[assetKey];
        wordAssetsRef.current = next;
        return next;
      });
      wordDisplayCacheRef.current.delete(assetKey);
      hideWordHoverCard();
      clearAutoWordHighlights(renditionRef.current);
      syncAutoWordHighlights(renditionRef.current);
    } catch (error) {
      new Notice(error && error.message ? error.message : "Failed to delete translation card.");
    }
  };
  const translateActiveWordWithAi = async () => {
    const asset = activeWordHover == null ? void 0 : activeWordHover.asset;
    const assetKey = getTranslationAssetStorageKey(asset);
    if (!asset || !assetKey || typeof translateSelection !== "function" || typeof saveWordAsset !== "function")
      return;
    new Notice("正在使用AI翻译...");
    try {
      const quote = asset.title || asset.lemma || "";
      const sentence = (asset.sources && asset.sources[0] && asset.sources[0].sentence) || (asset.sources && asset.sources[0] && asset.sources[0].quote) || "";
      const result = await translateSelection(quote, sentence, { forceAi: true });
      if (!result) return;
      const updatedAsset = await saveWordAsset({
        quote,
        sentence,
        chapterTitle: (asset.sources && asset.sources[0] && asset.sources[0].chapterTitle) || "",
        cfiRange: (asset.sources && asset.sources[0] && asset.sources[0].cfiRange) || ""
      }, result);
      if (!updatedAsset) return;
      setCurrentWordAssets((current) => {
        const next = { ...current, [assetKey]: updatedAsset };
        wordAssetsRef.current = next;
        return next;
      });
      setActiveWordHover((current) => current ? { ...current, asset: updatedAsset } : null);
      new Notice("AI翻译完成并已更新词卡");
    } catch (error) {
      new Notice(error && error.message ? error.message : "AI翻译失败");
    }
  };
  const clearAutoWordHighlights = (rendition) => {
    if (!rendition || !rendition.annotations)
      return;
    const ids = rendition.__jarvisReaderWordHighlightIds;
    const cleanupMap = rendition.__jarvisReaderWordHighlightCleanup;
    const hoverCleanupMap = rendition.__jarvisReaderWordHoverCleanup;
    if (hoverCleanupMap && typeof hoverCleanupMap.forEach === "function") {
      hoverCleanupMap.forEach((cleanup) => {
        if (typeof cleanup === "function") {
          cleanup();
        }
      });
      hoverCleanupMap.clear();
    }
    if (cleanupMap && typeof cleanupMap.forEach === "function") {
      cleanupMap.forEach((cleanup) => {
        if (typeof cleanup === "function") {
          cleanup();
        }
      });
      cleanupMap.clear();
    }
    if (ids && typeof ids.forEach === "function") {
      ids.forEach((cfiRange) => {
        try {
          rendition.annotations.remove(cfiRange, "underline");
          rendition.annotations.remove(cfiRange, "highlight");
        } catch (error) {
        }
      });
      ids.clear();
    }
  };
  const applyAutoWordHighlight = (rendition, asset, cfiRange) => {
    if (!rendition || !rendition.annotations || !asset || !cfiRange)
      return;
    if (!rendition.__jarvisReaderWordHighlightIds) {
      rendition.__jarvisReaderWordHighlightIds =  new Set();
    }
    if (!rendition.__jarvisReaderWordHighlightCleanup) {
      rendition.__jarvisReaderWordHighlightCleanup =  new Map();
    }
    if (rendition.__jarvisReaderWordHighlightIds.has(cfiRange))
      return;
    rendition.__jarvisReaderWordHighlightIds.add(cfiRange);
    try {
      const kind = getTranslationAssetKind(asset);
      const strokeColorVar = kind === "sentence" ? (currentColors?.sentence || "#40c057") : kind === "phrase" ? (currentColors?.phrase || "#ae3ec9") : (currentColors?.word || "#4dabf7");
      const openWordCardFromEvent = (event) => {
        if (event && typeof event.preventDefault === "function")
          event.preventDefault();
        const element = event && (event.currentTarget || event.target);
        if (element && typeof element.getBoundingClientRect === "function") {
          showWordHoverCard(asset, element);
        }
      };
      const annotationBg = rendition.annotations.highlight(cfiRange, { lemma: asset.lemma }, openWordCardFromEvent, "jarvis-reader-word-highlight-bg", {
        fill: strokeColorVar,
        "fill-opacity": "0.15",
        "mix-blend-mode": "multiply"
      });
      const annotationUl = rendition.annotations.underline(cfiRange, { lemma: asset.lemma }, openWordCardFromEvent, "jarvis-reader-word-highlight", {
        stroke: strokeColorVar,
        "stroke-opacity": "0.92",
        "stroke-width": "2.0",
        "mix-blend-mode": "multiply"
      });
      const bindWordHighlightElement = (mark) => {
        const element = mark == null ? void 0 : mark.element;
        if (!element)
          return;
        const paneElement = element.ownerSVGElement;
        if (paneElement) {
          paneElement.style.pointerEvents = "none";
        }
        element.style.pointerEvents = "none";
        Array.from(element.children || []).forEach((child: Element) => {
          (child as SVGElement).style.pointerEvents = "none";
        });
      };
      bindWordHighlightElement(annotationBg == null ? void 0 : annotationBg.mark);
      if (annotationBg && typeof annotationBg.on === "function") {
        annotationBg.on("attach", bindWordHighlightElement);
      }
      bindWordHighlightElement(annotationUl == null ? void 0 : annotationUl.mark);
      if (annotationUl && typeof annotationUl.on === "function") {
        annotationUl.on("attach", bindWordHighlightElement);
      }
    } catch (error) {
      console.warn("Jarvis Reader word highlight render failed.", error);
    }
  };
  const attachAutoWordHover = (rendition, contents2) => {
    const doc = contents2 == null ? void 0 : contents2.document;
    if (!rendition || !doc)
      return;
    if (!rendition.__jarvisReaderWordHoverCleanup) {
      rendition.__jarvisReaderWordHoverCleanup =  new Map();
    }
    if (rendition.__jarvisReaderWordHoverCleanup.has(doc))
      return;
    const onMouseDown = () => {
      if (!pendingWordSelectionRef.current)
        return;
      clearHighlightUi();
      hideWordHoverCard();
    };
    doc.addEventListener("mousedown", onMouseDown);
    rendition.__jarvisReaderWordHoverCleanup.set(doc, () => {
      doc.removeEventListener("mousedown", onMouseDown);
    });
  };
  const collectAutoWordMatches = (contents2, assetsMap) => {
    if (!contents2 || !contents2.document || !contents2.document.body || !assetsMap)
      return [];
    const assets = (Object.values(assetsMap) as WordAsset[]).filter((asset) => asset && asset.lemma && !asset.mastered && getTranslationAssetKind(asset) !== "sentence").flatMap((asset) => getWordAssetSurfaceForms(asset).map((surface) => ({
      asset,
      surface,
      regex: buildWordMatchRegex(surface)
    }))).filter((item) => item.regex).sort((a, b) => b.surface.length - a.surface.length);
    if (!assets.length)
      return [];
    const doc = contents2.document;
    const matches = [];
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        var _a;
        const text = (node == null ? void 0 : node.nodeValue) || "";
        const parentTag = ((_a = node == null ? void 0 : node.parentElement) == null ? void 0 : _a.tagName) || "";
        if (!text.trim())
          return NodeFilter.FILTER_REJECT;
        if (["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA"].includes(parentTag))
          return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    let node = walker.nextNode();
    while (node) {
      const text = node.nodeValue || "";
      const candidates = [];
      for (const entry of assets) {
        entry.regex.lastIndex = 0;
        let match;
        while ((match = entry.regex.exec(text)) !== null) {
          const prefix = match[1] || "";
          const body = match[2] || "";
          const start = match.index + prefix.length;
          const end = start + body.length;
          candidates.push({
            start,
            end,
            asset: entry.asset
          });
        }
      }
      candidates.sort((a, b) => a.start !== b.start ? a.start - b.start : b.end - a.end);
      let lastEnd = -1;
      for (const candidate of candidates) {
        if (candidate.start < lastEnd)
          continue;
        try {
          const range = doc.createRange();
          range.setStart(node, candidate.start);
          range.setEnd(node, candidate.end);
          const cfiRange = contents2.cfiFromRange(range);
          if (cfiRange) {
            matches.push({
              asset: candidate.asset,
              cfiRange
            });
            lastEnd = candidate.end;
          }
        } catch (error) {
        }
      }
      node = walker.nextNode();
    }
    return matches;
  };
  const syncAutoWordHighlights = (rendition) => {
    if (!rendition || !autoWordHighlight) {
      clearAutoWordHighlights(rendition);
      return;
    }
    clearAutoWordHighlights(rendition);
    const contentsList = typeof rendition.getContents === "function" ? rendition.getContents() || [] : [];
    const seen =  new Set();
    for (const asset of Object.values(wordAssetsRef.current || {}) as WordAsset[]) {
      if (!asset || asset.mastered || !Array.isArray(asset.sources))
        continue;
      for (const source of asset.sources) {
        if (!source || source.bookPath !== bookPath || !source.cfiRange || seen.has(source.cfiRange))
          continue;
        seen.add(source.cfiRange);
        applyAutoWordHighlight(rendition, asset, source.cfiRange);
      }
    }
    for (const contents2 of contentsList) {
      attachAutoWordHover(rendition, contents2);
      const matches = collectAutoWordMatches(contents2, wordAssetsRef.current);
      for (const match of matches) {
        if (!match.cfiRange || seen.has(match.cfiRange))
          continue;
        seen.add(match.cfiRange);
        applyAutoWordHighlight(rendition, match.asset, match.cfiRange);
      }
    }
    refreshHighlightPanes(rendition);
  };
  useEffect(() => {
    highlightPopoverRectRef.current = highlightPopoverRect;
  }, [highlightPopoverRect]);
  useEffect(() => {
    wordTranslationRectRef.current = wordTranslationRect;
  }, [wordTranslationRect]);
  useEffect(() => {
    pendingHighlightMenuRef.current = pendingHighlightMenu;
  }, [pendingHighlightMenu]);
  useEffect(() => {
    pendingWordSelectionRef.current = pendingWordSelection;
  }, [pendingWordSelection]);
  useEffect(() => {
    setCurrentWordAssets(wordAssets || {});
    wordAssetsRef.current = wordAssets || {};
  }, [wordAssets]);
  useEffect(() => {
    setHighlightList(highlights || []);
    highlightListRef.current = highlights || [];
  }, [highlights]);
  useEffect(() => {
    pendingInitLocationRef.current = initLocation;
    if (initLocation) {
      setLocation(initLocation);
      currentLocationRef.current = initLocation;
    }
  }, [initLocation, bookPath]);
  useEffect(() => {
    highlightListRef.current = highlightList;
    applyHighlights(renditionRef.current, highlightList);
  }, [highlightList]);
  useEffect(() => {
    wordAssetsRef.current = currentWordAssets || {};
    syncAutoWordHighlights(renditionRef.current);
  }, [currentWordAssets, autoWordHighlight]);
  useEffect(() => {
    return () => {
      clearWordHoverHideTimer();
      if (typeof speechSynthesis !== "undefined") {
        speechSynthesis.cancel();
      }
      clearAutoWordHighlights(renditionRef.current);
    };
  }, []);
  useEffect(() => {
    if (typeof registerHighlightEditor !== "function")
      return;
    registerHighlightEditor((highlight) => {
      if (!highlight)
        return;
      clearWordLookup();
      selectHighlight(highlight);
      setPendingSelection({
        ...highlight,
        chapterTitle: highlight.chapterTitle || readerTitleRef.current
      });
      setHighlightComment(highlight.comment || "");
      setPendingHighlightMenu(null);
      setWikiSuggest(null);
      setWikiEditRange(null);
    });
    return () => {
      registerHighlightEditor(null);
    };
  }, [registerHighlightEditor, selectHighlight]);
  useEffect(() => {
    if (typeof registerHighlightDeleted !== "function")
      return;
    registerHighlightDeleted((highlight) => {
      removeHighlightMark(renditionRef.current, highlight);
      setPendingHighlightMenu(null);
      setHighlightList((current) => {
        const next = current.filter((item) => item.cfiRange !== highlight.cfiRange);
        highlightListRef.current = next;
        return next;
      });
    });
    return () => {
      registerHighlightDeleted(null);
    };
  }, [registerHighlightDeleted]);
  useEffect(() => {
    const container = containerRef.current;
    if (!container)
      return;
    const onWheel = (event) => {
      if (!event.ctrlKey)
        return;
      event.preventDefault();
      setReaderZoom(event.deltaY < 0 ? 0.05 : -0.05);
    };
    container.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      container.removeEventListener("wheel", onWheel);
    };
  }, [setReaderZoom]);
  useEffect(() => {
    const container = containerRef.current;
    if (!container)
      return;
    const decoratePageButtons = () => {
      const buttons = Array.from(container.querySelectorAll("button")) as HTMLButtonElement[];
      for (const button of buttons) {
        const isPrevious = button.classList.contains("jarvis-reader-page-button-prev") || button.textContent?.trim() === "‹";
        const isNext = button.classList.contains("jarvis-reader-page-button-next") || button.textContent?.trim() === "›";
        if (!isPrevious && !isNext)
          continue;
        const direction = isPrevious ? "prev" : "next";
        const iconClass = `jarvis-reader-page-button-${direction}`;
        if (button.classList.contains(iconClass) && button.querySelector("svg"))
          continue;
        button.classList.add("jarvis-reader-page-button", iconClass);
        button.setAttribute("aria-label", direction === "prev" ? "上一页" : "下一页");
        button.setAttribute("title", direction === "prev" ? "上一页" : "下一页");
        button.replaceChildren();
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("viewBox", "0 0 24 24");
        svg.setAttribute("aria-hidden", "true");
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", direction === "prev" ? "m15 18-6-6 6-6" : "m9 18 6-6-6-6");
        svg.appendChild(path);
        button.appendChild(svg);
      }
    };
    decoratePageButtons();
    const observer = new MutationObserver(decoratePageButtons);
    observer.observe(container, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!pendingHighlightMenu || pendingHighlightMenu.id)
      return;
    const rendition = renditionRef.current;
    const views = rendition && rendition.manager && rendition.manager.stage && typeof rendition.manager.visible === "function" ? rendition.manager.visible() || [] : [];
    const docs = views.map((view) => {
      var _a;
      return ((_a = view == null ? void 0 : view.contents) == null ? void 0 : _a.document) || null;
    }).filter(Boolean);
    if (!docs.length)
      return;
    const hasLiveSelection = () => docs.some((doc) => {
      var _a, _b;
      const selectionText = normalizeHighlightQuote((_b = (_a = doc.defaultView) == null ? void 0 : _a.getSelection()) == null ? void 0 : _b.toString());
      return !!selectionText;
    });
    const closeIfSelectionGone = () => {
      window.setTimeout(() => {
        const current = pendingHighlightMenuRef.current;
        if (!current || current.id)
          return;
        if (!hasLiveSelection()) {
          clearHighlightUi();
        }
      }, 0);
    };
    for (const doc of docs) {
      doc.addEventListener("selectionchange", closeIfSelectionGone);
      doc.addEventListener("mouseup", closeIfSelectionGone);
      doc.addEventListener("keyup", closeIfSelectionGone);
    }
    return () => {
      for (const doc of docs) {
        doc.removeEventListener("selectionchange", closeIfSelectionGone);
        doc.removeEventListener("mouseup", closeIfSelectionGone);
        doc.removeEventListener("keyup", closeIfSelectionGone);
      }
    };
  }, [pendingHighlightMenu]);
  const updateReaderTitle = (relocated) => {
    const href = relocated && relocated.start ? relocated.start.href : "";
    const chapterTitle = findChapterTitle(tocRef.current, href);
    const nextTitle = chapterTitle || title;
    readerTitleRef.current = nextTitle;
    setReaderTitle(nextTitle);
    setProgressLabel(getReaderProgressLabel(relocated, renditionRef.current));
    saveProgress(relocated, nextTitle, renditionRef.current);
  };
  const getSelectionContextSentence = (contents2, selectedText) => {
    var _a, _b;
    const doc = contents2 == null ? void 0 : contents2.document;
    const selection = (_b = (_a = contents2 == null ? void 0 : contents2.window) == null ? void 0 : _a.getSelection) == null ? void 0 : _b.call(_a);
    if (!doc || !selection || !selection.rangeCount || !selectedText)
      return selectedText || "";
    try {
      const range = selection.getRangeAt(0);
      let node = range.startContainer;
      let element = node && node.nodeType === Node.ELEMENT_NODE ? node : node == null ? void 0 : node.parentElement;
      while (element && element !== doc.body) {
        const text = normalizeHighlightQuote(element.innerText || element.textContent || "");
        if (text && text.includes(selectedText)) {
          const index = text.indexOf(selectedText);
          const left = text.slice(0, index);
          const right = text.slice(index + selectedText.length);
          const leftBoundary = Math.max(left.lastIndexOf("."), left.lastIndexOf("?"), left.lastIndexOf("!"), left.lastIndexOf(";"), left.lastIndexOf("\n"), left.lastIndexOf("。"), left.lastIndexOf("？"), left.lastIndexOf("！"));
          const rightMatches = [right.indexOf("."), right.indexOf("?"), right.indexOf("!"), right.indexOf(";"), right.indexOf("\n"), right.indexOf("。"), right.indexOf("？"), right.indexOf("！")].filter((value) => value >= 0);
          const rightBoundary = rightMatches.length ? Math.min(...rightMatches) : -1;
          const start = leftBoundary >= 0 ? leftBoundary + 1 : 0;
          const end = rightBoundary >= 0 ? index + selectedText.length + rightBoundary + 1 : text.length;
          return text.slice(start, end).trim().slice(0, 600) || selectedText;
        }
        element = element.parentElement;
      }
    } catch (error) {
    }
    return selectedText || "";
  };
  const handleTextSelected = (cfiRange, contents2) => {
    var _a, _b;
    const rawSelectedText = (_b = (_a = contents2 == null ? void 0 : contents2.window) == null ? void 0 : _a.getSelection()) == null ? void 0 : _b.toString();
    const selectedText = normalizeHighlightQuote(String(rawSelectedText || "").replace(/[\u00ad\u200b-\u200d\ufeff]/g, ""));
    if (!selectedText) {
      setActiveSelectionInfo(null);
      activeSelectionInfoRef.current = null;
      return;
    }
    const selectionItem = {
      cfiRange,
      quote: selectedText,
      sentence: getSelectionContextSentence(contents2, selectedText),
      chapterTitle: readerTitleRef.current,
      rect: getSelectionHighlightMenuRect(contents2),
      contents2
    };
    setActiveSelectionInfo(selectionItem);
    activeSelectionInfoRef.current = selectionItem;

    const existingHighlight = (highlightListRef.current || []).find((highlight) => highlight.cfiRange === cfiRange);
    clearWordLookup();
    setPendingSelection(null);
    if (existingHighlight) {
      // Defer existing highlights from auto-popover on selection overlap
      return;
    }
    Promise.resolve(openWordTranslator(selectionItem, { autoLocalOnly: true })).then((opened) => {
      if (!opened) {
        clearWordLookup();
        // Do not auto-show pending highlight menu on text selection
      }
    });
    setHighlightComment("");
    setWikiSuggest(null);
    setWikiEditRange(null);
  };
  const getWikiTrigger = (value, cursor) => {
    const before = value.slice(0, cursor);
    const start = before.lastIndexOf("[[");
    if (start < 0)
      return null;
    const query = before.slice(start + 2);
    if (query.includes("]]") || query.includes("\n"))
      return null;
    return { start, end: cursor, query };
  };
  const getWikiLinkAtCursor = (value, cursor) => {
    const pattern = /\[\[([^\]]+)\]\]/g;
    let match;
    while ((match = pattern.exec(value || "")) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      if (cursor >= start && cursor <= end) {
        const target = (match[1] || "").split("|")[0].trim();
        return target || null;
      }
    }
    return null;
  };
  const getWikiLinkRangeAtCursor = (value, cursor) => {
    const pattern = /\[\[([^\]]+)\]\]/g;
    let match;
    while ((match = pattern.exec(value || "")) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      if (cursor >= start && cursor <= end) {
        return { start, end };
      }
    }
    return null;
  };
  const getWikiSuggestItems = (query, sourceCandidates = currentWikiLinkCandidates) => {
    const needle = (query || "").trim().toLowerCase();
    const wantsAnchor = needle.includes("#") || needle.includes("^");
    const candidates = Array.isArray(sourceCandidates) ? sourceCandidates : [];
    return candidates.filter((item) => wantsAnchor || item.kind !== "heading" && item.kind !== "block").map((item) => {
      const title = (item.title || "").toLowerCase();
      const path = (item.path || "").toLowerCase();
      const insertText = (item.insertText || "").toLowerCase();
      let score = 0;
      if (needle) {
        if (insertText === needle || title === needle)
          score = 100;
        else if (insertText.startsWith(needle) || title.startsWith(needle))
          score = 80;
        else if (insertText.includes(needle) || title.includes(needle))
          score = 60;
        else if (path.includes(needle))
          score = 40;
      } else {
        score = 1;
      }
      return { ...item, score };
    }).filter((item) => !needle || item.score > 0).sort((a, b) => {
      if ((b.score || 0) !== (a.score || 0))
        return (b.score || 0) - (a.score || 0);
      const recentDelta = (a.recentIndex ?? Number.POSITIVE_INFINITY) - (b.recentIndex ?? Number.POSITIVE_INFINITY);
      if (recentDelta !== 0)
        return recentDelta;
      if (!needle) {
        const modifiedDelta = (b.modifiedTime || 0) - (a.modifiedTime || 0);
        if (modifiedDelta !== 0)
          return modifiedDelta;
      }
      return (a.title || "").localeCompare(b.title || "", "zh-Hans-CN");
    }).slice(0, 12);
  };
  const updateWikiSuggest = (value, cursor) => {
    const trigger = getWikiTrigger(value, cursor);
    if (!trigger) {
      setWikiSuggest(null);
      return;
    }
    const nextCandidates = typeof getWikiLinkCandidates === "function" ? getWikiLinkCandidates() || [] : currentWikiLinkCandidates;
    setCurrentWikiLinkCandidates(nextCandidates);
    const items = getWikiSuggestItems(trigger.query, nextCandidates);
    setWikiSuggest(items.length ? { ...trigger, items, activeIndex: 0 } : null);
  };
  const updateWikiEditRange = (value, cursor) => {
    setWikiEditRange(getWikiLinkRangeAtCursor(value, cursor));
  };
  const setHighlightCommentWithSelection = (nextValue, start, end = start) => {
    setHighlightComment(nextValue);
    window.requestAnimationFrame(() => {
      const input = highlightInputRef.current;
      if (!input)
        return;
      input.focus();
      input.setSelectionRange(start, end);
    });
  };
  const insertWikiCandidate = (candidate) => {
    if (!candidate || !wikiSuggest)
      return;
    const insertText = `[[${candidate.insertText || candidate.title || ""}]]`;
    const nextValue = highlightComment.slice(0, wikiSuggest.start) + insertText + highlightComment.slice(wikiSuggest.end);
    const nextCursor = wikiSuggest.start + insertText.length;
    setWikiSuggest(null);
    setHighlightCommentWithSelection(nextValue, nextCursor);
  };
  const wrapSelectionAsWikiLink = (input) => {
    if (!input)
      return;
    const start = input.selectionStart || 0;
    const end = input.selectionEnd || start;
    const selected = highlightComment.slice(start, end);
    const insertText = selected ? `[[${selected}]]` : "[[]]";
    const nextValue = highlightComment.slice(0, start) + insertText + highlightComment.slice(end);
    const innerStart = start + 2;
    const innerEnd = selected ? innerStart + selected.length : innerStart;
    setWikiSuggest(null);
    setHighlightCommentWithSelection(nextValue, selected ? start + insertText.length : innerStart, selected ? start + insertText.length : innerEnd);
  };
  const openWikiLinkAtInputCursor = (input) => {
    if (!input || typeof openWikiLink !== "function")
      return;
    const start = input.selectionStart || 0;
    const end = input.selectionEnd || start;
    if (start !== end)
      return;
    const target = getWikiLinkAtCursor(input.value || "", start);
    if (!target)
      return;
    setWikiSuggest(null);
    openWikiLink(target);
  };
  const renderWikiInputPreview = (value) => {
    const text = value || "";
    const nodes = [];
    const pattern = /\[\[([^\]]+)\]\]/g;
    let lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      if (start > lastIndex) {
        nodes.push(React.createElement("span", { key: `t-${lastIndex}` }, text.slice(lastIndex, start)));
      }
      const active = wikiEditRange && wikiEditRange.start === start && wikiEditRange.end === end;
      if (active) {
        nodes.push(React.createElement("span", { key: `r-${start}` }, match[0]));
      } else {
        const raw = match[1] || "";
        const parts = raw.split("|");
        const target = (parts[0] || raw).trim();
        nodes.push(React.createElement("span", {
          key: `l-${start}`,
          className: "jarvis-reader-highlight-input-wikilink",
          onMouseDown: (event) => {
            if (!target || typeof openWikiLink !== "function")
              return;
            event.preventDefault();
            event.stopPropagation();
            openWikiLink(target);
          }
        }, parts[1] || parts[0] || raw));
      }
      lastIndex = end;
    }
    if (lastIndex < text.length) {
      nodes.push(React.createElement("span", { key: `t-${lastIndex}` }, text.slice(lastIndex)));
    }
    return nodes.length ? nodes : React.createElement("span", { className: "jarvis-reader-highlight-input-placeholder" }, "写下你的笔记与思考");
  };
  const clearHighlightUi = () => {
    pendingWordLookupRef.current += 1;
    setPendingSelection(null);
    setPendingHighlightMenu(null);
    setHighlightComment("");
    setWikiSuggest(null);
    setWikiEditRange(null);
    setHighlightCommentMode("edit");
    setEditingNoteIndex(null);
    clearWordLookup();
  };

  const fireSmartCommand = async (cmd: SmartCommand, scope: "selection" | "note") => {
    setSmartCmdMenuScope(null);
    const effectiveApp = app || (window as any).app;
    if (!effectiveApp) {
      new Notice("无法获取 Obsidian App 实例。");
      return;
    }
    let selectionText = "";
    let noteContent = "";
    const currentBookName = bookTitle || title || "";
    const bookPrefix = currentBookName ? `《${currentBookName}》` : "";

    if (scope === "selection" && pendingHighlightMenu) {
      const quoteText = pendingHighlightMenu.quote || "";
      selectionText = `${bookPrefix}原文：${quoteText}`;
    } else if (scope === "note" && pendingSelection) {
      const entries = Array.isArray(pendingSelection.commentEntries)
        ? pendingSelection.commentEntries
        : [];
      noteContent = entries.map((e: any) => e.text || "").filter(Boolean).join("\n\n")
        || (pendingSelection.comment || "");
      const quoteText = pendingSelection.quote || "";
      const quoteFormatted = `${bookPrefix}原文：${quoteText}`;
      selectionText = noteContent ? `${quoteFormatted}\n想法：${noteContent}` : quoteFormatted;
    }
    try {
      const finalPrompt = await prepareSmartCommandPromptFromVault(effectiveApp, cmd, {
        selection: selectionText || noteContent,
        content: noteContent || selectionText,
        book_title: bookTitle || title || "",
        chapter: readerTitleRef.current || ""
      });
      triggerClaudianPrompt(effectiveApp, finalPrompt);
      new Notice(`已发送「${cmd.label}」指令到 Claudian`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("Jarvis Reader smart command failed.", error);
      new Notice(message);
    }
  };

  const copyHighlightQuote = async (item) => {
    if (!item || !item.quote)
      return;
    try {
      await navigator.clipboard.writeText(item.quote);
      new Notice("\u5df2\u590d\u5236");
    } catch (error) {
      console.warn("Jarvis Reader copy highlight failed.", error);
      new Notice("\u590d\u5236\u5931\u8d25");
    }
  };
  const openHighlightCommentEditor = (item) => {
    if (!item)
      return;
    if (typeof getWikiLinkCandidates === "function") {
      setCurrentWikiLinkCandidates(getWikiLinkCandidates() || []);
    }
    clearWordLookup();
    setPendingHighlightMenu(null);
    selectHighlight(item);
    setPendingSelection({
      ...item,
      chapterTitle: item.chapterTitle || readerTitleRef.current
    });
    setHighlightComment("");
    setHighlightCommentMode(item.id && (item.comment || "").trim() ? "view" : "edit");
    setWikiSuggest(null);
    setWikiEditRange(null);
  };
  const savePlainHighlight = async (item) => {
    if (!item || item.id)
      return;
    const created = await createHighlight({
      ...item,
      comment: ""
    });
    if (created) {
      setHighlightList((current) => [...current.filter((highlight) => highlight.id !== created.id && highlight.cfiRange !== created.cfiRange), created]);
      applyHighlight(renditionRef.current, created);
    }
    clearHighlightUi();
  };
  const deleteExistingHighlight = async (item) => {
    if (!item || !item.id)
      return;
    const effectiveApp = app || (window as any).app;
    if (!effectiveApp) {
      new Notice("无法获取 Obsidian App 实例。");
      return;
    }
    const confirmed = await confirmDestructiveAction(
      effectiveApp,
      "删除划线与笔记",
      "确定要删除这条划线及其所有笔记吗？这会清除阅读器中的原文标记和书籍笔记中的对应内容，此操作不可恢复。"
    );
    if (!confirmed)
      return;
    const deleted = await deleteHighlight(item);
    if (deleted) {
      removeHighlightMark(renditionRef.current, item);
      setHighlightList((current) => current.filter((highlight) => highlight.cfiRange !== item.cfiRange));
    }
    clearHighlightUi();
  };

  const deleteNoteEntry = async (indexToDelete: number) => {
    if (!pendingSelection) return;
    const currentEntries = Array.isArray(pendingSelection.commentEntries) ? [...pendingSelection.commentEntries] : [];
    const nextEntries = currentEntries.filter((_, idx) => idx !== indexToDelete);
    
    // If no comments left, do we delete the entire highlight? 
    // Usually no, we just clear comments, leaving a plain highlight.
    const updated = await updateHighlight({
      ...pendingSelection,
      commentEntries: nextEntries,
      comment: nextEntries.map((e: any) => e.text).join("\n\n")
    });
    if (updated) {
      setHighlightList((current) => current.map((item) => item.id === updated.id ? updated : item));
      setPendingSelection({
        ...updated,
        chapterTitle: updated.chapterTitle || readerTitleRef.current
      });
      new Notice("已删除该条笔记。");
    }
  };
  const confirmHighlight = async () => {
    if (!pendingSelection)
      return;
    setWikiSuggest(null);
    const nextComment = highlightComment.trim();
    if (pendingSelection.id) {
      if (!nextComment) {
        if (highlightCommentMode === "append" || editingNoteIndex !== null) {
          setHighlightCommentMode("view");
          setEditingNoteIndex(null);
          return;
        }
        clearHighlightUi();
        return;
      }
      let updated;
      if (editingNoteIndex !== null) {
        const currentEntries = Array.isArray(pendingSelection.commentEntries) ? [...pendingSelection.commentEntries] : [];
        if (currentEntries[editingNoteIndex]) {
          currentEntries[editingNoteIndex] = {
            ...currentEntries[editingNoteIndex],
            text: nextComment
          };
        }
        updated = await updateHighlight({
          ...pendingSelection,
          commentEntries: currentEntries,
          comment: currentEntries.map((e: any) => e.text).join("\n\n")
        });
      } else {
        updated = await updateHighlight({
          ...pendingSelection,
          comment: nextComment,
          appendComment: true
        });
      }
      if (updated) {
        removeHighlightMark(renditionRef.current, pendingSelection);
        applyHighlight(renditionRef.current, updated);
        setHighlightList((current) => current.map((item) => item.id === updated.id ? updated : item));
        setPendingSelection({
          ...updated,
          chapterTitle: updated.chapterTitle || readerTitleRef.current
        });
        setHighlightComment("");
        setHighlightCommentMode("view");
        setEditingNoteIndex(null);
        return;
      }
    } else {
      const created = await createHighlight({
        ...pendingSelection,
        comment: nextComment
      });
      if (created) {
        setHighlightList((current) => [...current.filter((item) => item.id !== created.id && item.cfiRange !== created.cfiRange), created]);
        applyHighlight(renditionRef.current, created);
      }
    }
    clearHighlightUi();
  };
  const isWikiSuggestOpen = !!(wikiSuggest && wikiSuggest.items && wikiSuggest.items.length);
  const activeHighlightPopoverRect = pendingSelection ? highlightPopoverRect || getDefaultHighlightPopoverRect() : null;
  const visibleHighlightPopoverRect = activeHighlightPopoverRect && isWikiSuggestOpen ? clampHighlightPopoverRect({
    ...activeHighlightPopoverRect,
    height: Math.max(activeHighlightPopoverRect.height || 0, 480)
  }) : activeHighlightPopoverRect;
  const isExistingHighlightComment = !!(pendingSelection && pendingSelection.id);
  const isReadingHighlightComment = !!(isExistingHighlightComment && highlightCommentMode !== "append" && editingNoteIndex === null);
  const isAppendingHighlightComment = !isExistingHighlightComment || highlightCommentMode === "append" || editingNoteIndex !== null;
  const highlightCommentPlaceholder = isExistingHighlightComment ? "写下新的笔记，保存后会追加到原块" : "写下你的笔记";
  const formatHighlightNoteTime = (value) => {
    const raw = String(value || "").trim();
    if (!raw)
      return "\u672a\u8bb0\u5f55\u65f6\u95f4";
    const normalized = raw.includes("T") ? raw : raw.replace(" ", "T");
    const date = new Date(normalized);
    if (!Number.isNaN(date.getTime())) {
      const parts = new Intl.DateTimeFormat("zh-CN", {
        timeZone: "Asia/Shanghai",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
      }).formatToParts(date).reduce((acc, part) => {
        if (part.type !== "literal") {
          acc[part.type] = part.value;
        }
        return acc;
      }, {} as Record<string, string>);
      return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
    }
    return raw.replace("T", " ").replace(/\.\d+Z?$/, "").replace(/Z$/, "");
  };
  const getHighlightNoteEntries = (item) => {
    const entries = Array.isArray(item?.commentEntries) ? item.commentEntries.filter((entry) => (entry?.text || "").trim()) : [];
    if (entries.length)
      return entries;
    const fallback = String(item?.comment || "").trim();
    if (!fallback)
      return [];
    return fallback.split(/\n{2,}/).map((text, index) => ({
      label: index === 0 ? "\u7b14\u8bb0" : `\u7b14\u8bb0 ${index + 1}`,
      created: item?.updated || item?.created || "",
      text: text.trim()
    })).filter((entry) => entry.text);
  };
  const highlightNoteEntries = pendingSelection ? getHighlightNoteEntries(pendingSelection) : [];
  const hasPromotableHighlightNote = highlightNoteEntries.length > 0 || !!highlightComment.trim();
  const highlightAiSections = pendingSelection && Array.isArray(pendingSelection.aiSections) ? pendingSelection.aiSections.filter((section) => (section?.text || "").trim() || (section?.links || []).length) : [];
  const renderHighlightNotes = () => highlightNoteEntries.length ? React.createElement("div", {
    className: "jarvis-reader-highlight-note-list"
  }, highlightNoteEntries.map((entry, index) => React.createElement("div", {
    className: "jarvis-reader-highlight-note-card",
    key: `${entry.label || "note"}-${index}`,
    style: { display: "flex", flexDirection: "column", gap: "4px" }
  },
    React.createElement("div", {
      style: { display: "flex", alignItems: "center", justifyContent: "space-between" }
    },
      React.createElement("span", { style: { fontWeight: "600", fontSize: "12px", color: "var(--text-normal)" } }, entry.label || "笔记"),
      React.createElement("div", {
        style: { display: "flex", gap: "6px" }
      },
        React.createElement("button", {
          className: "jarvis-reader-highlight-icon-button",
          type: "button",
          title: "编辑笔记",
          onClick: () => {
            setEditingNoteIndex(index);
            setHighlightComment(entry.text);
            setHighlightCommentMode("edit");
          }
        }, renderObsidianIcon("pencil")),
        React.createElement("button", {
          className: "jarvis-reader-highlight-icon-button",
          type: "button",
          title: "删除笔记",
          onClick: async () => {
            const effectiveApp = app || (window as any).app;
            if (!effectiveApp) {
              new Notice("无法获取 Obsidian App 实例。");
              return;
            }
            const confirmed = await confirmDestructiveAction(
              effectiveApp,
              "删除笔记",
              "确定要删除这条笔记吗？此操作不可恢复。"
            );
            if (confirmed) {
              await deleteNoteEntry(index);
            }
          }
        }, renderObsidianIcon("trash-2"))
      )
    ),
    React.createElement("div", {
      className: "jarvis-reader-highlight-note-card-text",
      style: { marginTop: "2px" }
    }, React.createElement(ObsidianMarkdown, { text: entry.text, onOpenLink: openWikiLink })),
    React.createElement("div", {
      className: "jarvis-reader-highlight-note-card-time",
      style: { marginTop: "2px" }
    }, formatHighlightNoteTime(entry.created))
  ))) : React.createElement("div", {
    className: "jarvis-reader-highlight-empty"
  }, "\u6682\u65e0\u7b14\u8bb0");
  const addAssociatedLink = async (fileName: string) => {
    if (!pendingSelection) return;
    const currentSections = Array.isArray(pendingSelection.aiSections)
      ? [...pendingSelection.aiSections.map((s: any) => ({ ...s, links: s.links ? [...s.links] : [] }))]
      : [];
    let assocSec = currentSections.find((s: any) => s.title === "关联文章");
    if (!assocSec) {
      assocSec = { title: "关联文章", text: "", links: [] };
      currentSections.push(assocSec);
    }
    const currentLinks = assocSec.links || [];
    const linkNames = currentLinks.map((l: string) => l.split("|")[0]);
    if (linkNames.includes(fileName)) {
      new Notice("已经关联了该文件。");
      return;
    }
    const nowStr = formatLocalDateTime(new Date());
    assocSec.links = [...currentLinks, `${fileName}|${nowStr}`];
    
    const updated = await updateHighlight({
      ...pendingSelection,
      aiSections: currentSections
    });
    if (updated) {
      setHighlightList((current) => current.map((item) => item.id === updated.id ? updated : item));
      setPendingSelection({
        ...updated,
        chapterTitle: updated.chapterTitle || readerTitleRef.current
      });
      new Notice("已关联文章。");
    }
    setShowAssocDropdown(false);
  };

  const removeAssociatedLink = async (fileName: string) => {
    if (!pendingSelection) return;
    const currentSections = Array.isArray(pendingSelection.aiSections)
      ? pendingSelection.aiSections.map((s: any) => ({ ...s, links: s.links ? [...s.links] : [] }))
      : [];
    let assocSec = currentSections.find((s: any) => s.title === "关联文章");
    if (!assocSec || !assocSec.links) return;
    
    assocSec.links = assocSec.links.filter((l: string) => l.split("|")[0] !== fileName);
    
    const updated = await updateHighlight({
      ...pendingSelection,
      aiSections: currentSections
    });
    if (updated) {
      setHighlightList((current) => current.map((item) => item.id === updated.id ? updated : item));
      setPendingSelection({
        ...updated,
        chapterTitle: updated.chapterTitle || readerTitleRef.current
      });
      new Notice("已取消关联。");
    }
  };

  const renderHighlightAiSections = () => {
    const currentSections = pendingSelection && Array.isArray(pendingSelection.aiSections) ? pendingSelection.aiSections : [];
    const assocSec = currentSections.find((s: any) => s.title === "关联文章");
    const assocLinks = assocSec ? [...new Set(assocSec.links || [])] : [];

    const recentFiles: string[] = [];
    if (app && app.workspace) {
      const paths = app.workspace.getLastOpenFiles() || [];
      paths.forEach((p: string) => {
        if (p.endsWith(".md")) {
          const name = p.split("/").pop()?.replace(/\.md$/, "") || "";
          if (name && !recentFiles.includes(name)) {
            recentFiles.push(name);
          }
        }
      });
    }
    const displayRecent = recentFiles.slice(0, 15);

    interface SuggestionItem {
      displayName: string;
      subtext?: string;
      insertValue: string;
      icon: string;
    }

    let suggestions: SuggestionItem[] = [];

    if (app && app.vault) {
      const allFiles = app.vault.getFiles() || [];
      const query = assocSearchQuery.trim();

      const hashIdx = query.indexOf("#");
      const caretIdx = query.indexOf("^");

      const getFileDisplayName = (f: any) => f.extension === "md" ? f.basename : f.name;

      if (hashIdx !== -1) {
        const filePart = query.substring(0, hashIdx).toLowerCase();
        const searchPart = query.substring(hashIdx + 1).toLowerCase();
        const targetFile = allFiles.find(f => {
          const name = getFileDisplayName(f);
          return name.toLowerCase() === filePart || (filePart === "" && f.path === activeFileCachePath);
        });

        if (targetFile && targetFile.extension === "md") {
          const cache = app.metadataCache.getFileCache(targetFile);
          const headings = cache?.headings || [];
          suggestions = headings
            .filter(h => h.heading.toLowerCase().includes(searchPart))
            .map(h => ({
              displayName: h.heading,
              subtext: `H${h.level}`,
              insertValue: `${targetFile.basename}#${h.heading}`,
              icon: "hash"
            }))
            .slice(0, 50);
        }
      } else if (caretIdx !== -1) {
        const filePart = query.substring(0, caretIdx).toLowerCase();
        const searchPart = query.substring(caretIdx + 1).toLowerCase();
        const targetFile = allFiles.find(f => {
          const name = getFileDisplayName(f);
          return name.toLowerCase() === filePart || (filePart === "" && f.path === activeFileCachePath);
        });

        if (targetFile && targetFile.extension === "md") {
          if (targetFile.path !== activeFileCachePath) {
            setActiveFileCachePath(targetFile.path);
            app.vault.read(targetFile).then(content => {
              setActiveFileContent(content);
            });
          }

          const cache = app.metadataCache.getFileCache(targetFile);
          const blocks = cache?.blocks || {};
          const lines = activeFileContent ? activeFileContent.split(/\r?\n/) : [];

          suggestions = Object.entries(blocks)
            .map(([id, blockInfo]) => {
              const startLine = (blockInfo as any).position?.start?.line;
              const lineText = lines[startLine] || "";
              const cleanText = lineText.replace(/\s*\^[a-zA-Z0-9-]+$/, "").trim();
              return {
                id,
                text: cleanText || `块 ID: ${id}`
              };
            })
            .filter(b => b.text.toLowerCase().includes(searchPart) || b.id.toLowerCase().includes(searchPart))
            .map(b => ({
              displayName: b.text,
              subtext: `^${b.id}`,
              insertValue: `${targetFile.basename}#^${b.id}`,
              icon: "align-left"
            }))
            .slice(0, 50);
        }
      } else {
        if (query) {
          suggestions = allFiles
            .filter(f => getFileDisplayName(f).toLowerCase().includes(query.toLowerCase()))
            .map(f => ({
              displayName: getFileDisplayName(f),
              subtext: f.parent?.path && f.parent.path !== "/" ? f.parent.path + "/" : "",
              insertValue: getFileDisplayName(f),
              icon: f.extension === "md" ? "file-text" : "file"
            }))
            .slice(0, 50);
        } else {
          const recentSet = new Set(recentFiles);
          const recentItems = recentFiles
            .map(name => allFiles.find(f => getFileDisplayName(f) === name))
            .filter(Boolean) as any[];
          
          const otherItems = allFiles.filter(f => !recentSet.has(getFileDisplayName(f)));
          
          suggestions = [...recentItems, ...otherItems]
            .map(f => ({
              displayName: getFileDisplayName(f),
              subtext: f.parent?.path && f.parent.path !== "/" ? f.parent.path + "/" : "",
              insertValue: getFileDisplayName(f),
              icon: f.extension === "md" ? "file-text" : "file"
            }))
            .slice(0, 50);
        }
        
        if (suggestions.length === 1 && suggestions[0].icon === "file-text") {
          const matchedFile = allFiles.find(f => f.basename === suggestions[0].displayName);
          if (matchedFile && matchedFile.path !== activeFileCachePath) {
            setActiveFileCachePath(matchedFile.path);
            app.vault.read(matchedFile).then(content => {
              setActiveFileContent(content);
            });
          }
        }
      }
    }

    return React.createElement("div", {
      className: "jarvis-reader-highlight-ai-list",
      style: { display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }
    }, 
      React.createElement("div", {
        style: { flex: "0 0 auto", position: "relative", zIndex: 10008, width: "80%", maxWidth: "360px", margin: "0 auto 12px auto" }
      },
        React.createElement("input", {
          className: "jarvis-reader-assoc-search-input",
          type: "text",
          placeholder: "搜索并关联文章...",
          value: assocSearchQuery,
          onChange: (e) => {
            setAssocSearchQuery(e.target.value);
            setShowAssocDropdown(true);
          },
          onFocus: () => setShowAssocDropdown(true),
          onBlur: () => setShowAssocDropdown(false),
          style: {
            width: "100%",
            padding: "6px 12px",
            background: "var(--background-modifier-form-field)",
            border: "1px solid var(--background-modifier-border)",
            borderRadius: "6px",
            color: "var(--text-normal)",
            fontSize: "13px"
          }
        }),
        showAssocDropdown ? React.createElement("div", {
          className: "jarvis-reader-highlight-menu jarvis-reader-assoc-recent-menu",
          style: { position: "absolute", left: 0, right: 0, top: "34px", zIndex: 10008, maxHeight: "250px", overflowY: "auto", display: "flex", flexDirection: "column", background: "var(--background-primary)", border: "1px solid var(--background-modifier-border)", borderRadius: "6px", boxShadow: "0 4px 12px rgba(0,0,0,0.15)", padding: 0 },
          onMouseDown: (e) => e.preventDefault()
        },
          React.createElement("div", { style: { flex: "1 1 auto", overflowY: "auto", padding: "6px" } },
            suggestions.length > 0 ? suggestions.map(item =>
              React.createElement("div", {
                key: item.insertValue,
                className: "jarvis-reader-assoc-suggest-item",
                role: "button",
                onClick: () => {
                  addAssociatedLink(item.insertValue);
                  setAssocSearchQuery("");
                  setShowAssocDropdown(false);
                },
                style: { display: "flex", flexDirection: "column", alignItems: "flex-start", padding: "6px 12px", gap: "2px" }
              },
                React.createElement("div", { style: { display: "flex", alignItems: "center", gap: "6px", width: "100%" } },
                  renderObsidianIcon(item.icon),
                  React.createElement("span", { style: { fontWeight: "500", fontSize: "13px", color: "var(--text-normal)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, item.displayName)
                ),
                item.subtext ? React.createElement("span", { style: { fontSize: "11px", color: "var(--text-muted)", paddingLeft: "20px" } }, item.subtext) : null
              )
            ) : React.createElement("div", { className: "jarvis-reader-context-menu-item-disabled", style: { padding: "6px 12px", color: "var(--text-muted)", fontSize: "12px" } }, "未找到匹配内容")
          ),
          React.createElement("div", {
            className: "jarvis-reader-assoc-dropdown-footer",
            style: {
              padding: "6px 12px",
              borderTop: "1px solid var(--background-modifier-border)",
              color: "var(--text-muted)",
              fontSize: "11px",
              textAlign: "center",
              background: "var(--background-secondary)",
              borderBottomLeftRadius: "6px",
              borderBottomRightRadius: "6px",
              flex: "0 0 auto"
            }
          }, "输入 # 可以链接到标题   输入 ^ 链接文本块   输入 | 指定显示的文本")
        ) : null
      ),
      React.createElement("div", {
        className: "jarvis-reader-highlight-ai-section",
        style: { flex: "1 1 auto", overflowY: "auto", minHeight: 0 }
      },
        assocLinks.length > 0 ? React.createElement("div", {
          className: "jarvis-reader-highlight-note-list is-compact",
          style: { display: "flex", flexDirection: "column", gap: "8px" }
        }, assocLinks.map((link: string, linkIndex: number) => {
          const [linkPath, linkTime] = link.split("|");
          let displayText = linkPath;
          if (linkPath.includes("#^")) {
            const parts = linkPath.split("#^");
            displayText = `${parts[0]} > ^${parts[1]}`;
          } else if (linkPath.includes("#")) {
            const parts = linkPath.split("#");
            displayText = `${parts[0]} > ${parts[1]}`;
          }
          return React.createElement("div", {
            className: "jarvis-reader-highlight-note-card is-assoc",
            key: `${linkPath}-${linkIndex}`,
            style: { display: "flex", alignItems: "center", gap: "8px", padding: "4px 0", height: "28px", minHeight: "28px" }
          },
            React.createElement("span", { style: { color: "var(--text-muted)", fontSize: "14px", display: "inline-flex", alignItems: "center", userSelect: "none" } }, "•"),
            React.createElement("a", {
              className: "internal-link",
              style: { cursor: "pointer", textDecoration: "underline", color: "var(--link-color)", fontSize: "13px", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
              onClick: () => openWikiLink(linkPath)
            }, displayText),
            linkTime ? React.createElement("span", {
              className: "jarvis-reader-highlight-note-card-time",
              style: { margin: "0 12px 0 auto", fontSize: "11px", color: "var(--text-muted)", opacity: 0.8, flexShrink: 0 }
            }, formatHighlightNoteTime(linkTime)) : null,
            React.createElement("button", {
              className: "jarvis-reader-highlight-icon-button",
              type: "button",
              title: "取消关联",
              onClick: () => removeAssociatedLink(linkPath),
              style: { flexShrink: 0 }
            }, renderObsidianIcon("trash-2"))
          );
        })) : React.createElement("div", {
          className: "jarvis-reader-highlight-empty",
          style: { textAlign: "center", padding: "20px", color: "var(--text-muted)", fontSize: "13px" }
        }, "暂无关联文章")
      )
    );
  };
  const openHighlightNoteBlock = () => {
    if (!pendingSelection || !pendingSelection.notePath || typeof openWikiLink !== "function")
      return;
    const blockId = pendingSelection.blockId || pendingSelection.id || "";
    openWikiLink(blockId ? `${pendingSelection.notePath}#^${blockId}` : pendingSelection.notePath);
  };
  const visibleWordPopoverRect = pendingWordSelection
    ? wordTranslationRect || getDefaultWordTranslationRect()
    : null;
  const normalizedPendingWord = pendingWordSelection ? normalizeWordSelection((wordLookupState.result == null ? void 0 : wordLookupState.result.lemma) || pendingWordSelection.quote || "") : null;
  const pendingTranslationKey = pendingWordSelection && wordLookupState.result ? getTranslationAssetKey(pendingWordSelection, wordLookupState.result) : normalizedPendingWord ? normalizedPendingWord.lemma : "";
  const pendingTranslationKind = pendingWordSelection && wordLookupState.result ? getTranslationAssetKind(pendingWordSelection.quote || "", wordLookupState.result) : normalizedPendingWord && normalizedPendingWord.isPhrase ? "phrase" : "word";
  const savedWordAsset = pendingTranslationKey ? currentWordAssets[pendingTranslationKey] || null : null;
  const canPersistPendingWord = !!(pendingWordSelection && wordLookupState.status === "ready" && wordLookupState.result && pendingTranslationKey);
  const canSwitchPendingWordToAi = !!(pendingWordSelection && wordLookupState.status === "ready" && wordLookupState.result && wordLookupState.result.sourceType);
  const persistPendingLabel = pendingTranslationKind === "sentence" ? "\u4fdd\u5b58\u957f\u53e5" : pendingTranslationKind === "phrase" ? "\u4fdd\u5b58\u77ed\u8bed" : "\u4fdd\u5b58\u5355\u8bcd";
  const pendingWordTags = (() => {
    const result = wordLookupState.result;
    if (!result || !result.isWord)
      return [] as Array<{ label: string; tone: "core" | "rank" | "exam" }>;
    const tags: Array<{ label: string; tone: "core" | "rank" | "exam" }> = [];
    if (result.oxford === 1)
      tags.push({ label: "牛津核心", tone: "core" });
    if (result.collins > 0)
      tags.push({ label: '★'.repeat(result.collins), tone: "rank" });
    for (const tag of result.tags || []) {
      tags.push({ label: String(tag).toUpperCase(), tone: "exam" });
    }
    return tags;
  })();
  const renderObsidianIcon = (name) => React.createElement("span", {
    "aria-hidden": "true",
    className: "jarvis-reader-word-card-action-icon",
    ref: (element) => {
      if (!element)
        return;
      while (element.firstChild) {
        element.removeChild(element.firstChild);
      }
      if (typeof setIcon === "function") {
        setIcon(element, name);
      }
    }
  });
  const renderWordDisplayContent = (display) => React.createElement("div", {
    className: "jarvis-reader-word-card-display"
  }, truncateWordDisplay(display || "").split(/\r?\n/).filter((line) => line.trim()).map((line, index) => {
    const meta = getWordCardDisplayLineMeta(line);
    return  React.createElement("div", {
      className: meta.className,
      key: index
    }, renderWordCardDisplayText(meta.text));
  }));
  return  React.createElement("div", {
    className: "jarvis-reader-epub",
    ref: containerRef,
    style: { border: "none", height: "100%", width: "100%", overflow: "hidden" },
    onClick: (event) => {
      if (!pendingSelection && !pendingHighlightMenu && !pendingWordSelection && !activeWordHover)
        return;
      const popover = containerRef.current && containerRef.current.querySelector(".jarvis-reader-highlight-popover");
      if (popover && popover.contains(event.target))
        return;
      const menu = containerRef.current && containerRef.current.querySelector(".jarvis-reader-highlight-menu");
      if (menu && menu.contains(event.target))
        return;
      const wordCard = containerRef.current && containerRef.current.querySelector(".jarvis-reader-word-card");
      if (wordCard && wordCard.contains(event.target))
        return;
      clearHighlightUi();
      hideWordHoverCard();
    }
  }, React.createElement(ReaderSideControls, {
    location: currentLocationRef.current,
    chapterTitle: readerTitleRef.current,
    singlePage,
    scrolled: effectiveScrolled,
    onAddBookmark: addBookmark,
    onOpenBookNote: createBookNote,
    onZoom: setReaderZoom,
    onLineHeight: setReaderLineHeight,
    onScrolledChange: setScrolled,
    onSinglePageChange: setSinglePage,
  }), React.createElement(ReactReader, {
    title: readerTitle,
    showToc: false,
    location,
    locationChanged,
    swipeable: false,
    url: contents,
    tocChanged: (toc) => {
      tocRef.current = Array.isArray(toc) ? toc : [];
      tocMemo(toc);
    },
    getRendition: (rendition) => {
      renditionRef.current = rendition;
      applyPendingInitLocation(rendition);
      syncRenditionTheme(rendition);
      applyHighlights(rendition, highlightList);
      syncAutoWordHighlights(rendition);
      ensureReaderLocations(rendition, updateReaderTitle);
      const jarvisRendition = rendition as typeof rendition & { __awesomeReaderTitleBound?: boolean };
      if (rendition && typeof rendition.on === "function" && !jarvisRendition.__awesomeReaderTitleBound) {
        jarvisRendition.__awesomeReaderTitleBound = true;
        
        rendition.hooks.content.register((contents: any) => {
          const doc = contents?.document;
          if (doc) {
            const interactionEvents = ["mousemove", "keydown", "click", "scroll"];
            const interactionHandler = () => {
              if (typeof onInteraction === "function") {
                onInteraction();
              }
            };
            interactionEvents.forEach(evt => {
              doc.addEventListener(evt, interactionHandler, { passive: true });
            });
            doc.addEventListener("wheel", (event: WheelEvent) => {
              if (!event.ctrlKey) return;
              event.preventDefault();
              setReaderZoom(event.deltaY < 0 ? 0.05 : -0.05);
            }, { passive: false });

            // Right-click contextmenu handler on selected text
            doc.addEventListener("contextmenu", (event: MouseEvent) => {
              const win = contents?.window;
              const selection = win?.getSelection();
              const selectionText = selection ? selection.toString().trim() : "";
              if (selectionText) {
                event.preventDefault();
                event.stopPropagation();

                const frame = win.frameElement;
                const frameRect = frame ? frame.getBoundingClientRect() : null;
                const containerRect = containerRef.current ? containerRef.current.getBoundingClientRect() : null;

                let menuX = event.clientX;
                let menuY = event.clientY;
                if (frameRect && containerRect) {
                  menuX = event.clientX + frameRect.left - containerRect.left;
                  menuY = event.clientY + frameRect.top - containerRect.top;
                }

                const activeSel = activeSelectionInfoRef.current;
                const cfiRange = (activeSel && activeSel.quote === selectionText) ? activeSel.cfiRange : "";

                setPendingHighlightMenu({
                  cfiRange,
                  quote: selectionText,
                  sentence: getSelectionContextSentence(contents, selectionText),
                  chapterTitle: readerTitleRef.current,
                  rect: {
                    x: menuX,
                    y: menuY
                  }
                });
              }
            });
          }
        });

        rendition.on("relocated", (relocated) => {
          const relocatedCfi = relocated?.start?.cfi || relocated?.end?.cfi || "";
          if (pendingInitLocationRef.current && relocatedCfi === pendingInitLocationRef.current) {
            pendingInitLocationRef.current = null;
          }
          updateReaderTitle(relocated);
          syncAutoWordHighlights(rendition);
          refreshHighlightPanes(rendition);
        });
        rendition.on("rendered", () => {
          applyPendingInitLocation(rendition);
          applyHighlights(rendition, highlightListRef.current);
          syncAutoWordHighlights(rendition);
          refreshHighlightPanes(rendition);
        });
        rendition.on("resized", () => {
          syncAutoWordHighlights(rendition);
          refreshHighlightPanes(rendition);
        });
        const handleRenditionClick = (e: any) => {
          const selection = rendition.getContents()[0]?.window?.getSelection();
          if (selection && selection.toString().trim().length > 0) {
            return;
          }
          clearHighlightUi();
          hideWordHoverCard();
        };

        rendition.on("click", handleRenditionClick);
        rendition.on("touchend", handleRenditionClick);
      }
    },
    handleTextSelected,
    epubOptions,
    styles: {
      ...ReactReaderStyle,
      container: {
        ...ReactReaderStyle.container,
        backgroundColor: theme.background,
        color: theme.text
      },
      readerArea: {
        ...ReactReaderStyle.readerArea,
        backgroundColor: theme.background,
        color: theme.text,
        fontFamily: theme.fontFamily,
        fontSize: theme.fontSize
      },
      titleArea: {
        ...ReactReaderStyle.titleArea,
        color: theme.muted,
        fontFamily: theme.fontFamily,
        fontSize: theme.fontSize
      },
      reader: {
        ...ReactReaderStyle.reader,
        backgroundColor: theme.background,
        bottom: 72,
        left: "50%",
        right: "auto",
        transform: "translateX(-50%)",
        width: `min(calc(100% - 96px), ${maxReaderWidth}px)`
      },
      swipeWrapper: {
        ...ReactReaderStyle.swipeWrapper,
        backgroundColor: theme.background
      },
      prev: {
        ...ReactReaderStyle.prev,
        left: "calc(50% - 44px)",
        right: "auto",
        top: "auto",
        bottom: 20,
        transform: "none",
        marginTop: 0,
        width: 36,
        height: 36,
        background: "var(--interactive-normal)",
        borderRadius: "50%",
        border: "1px solid var(--background-modifier-border)",
        color: "var(--text-normal)",
        boxShadow: "0 2px 8px rgb(0 0 0 / 15%)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer"
      },
      next: {
        ...ReactReaderStyle.next,
        left: "calc(50% + 8px)",
        right: "auto",
        top: "auto",
        bottom: 20,
        transform: "none",
        marginTop: 0,
        width: 36,
        height: 36,
        background: "var(--interactive-normal)",
        borderRadius: "50%",
        border: "1px solid var(--background-modifier-border)",
        color: "var(--text-normal)",
        boxShadow: "0 2px 8px rgb(0 0 0 / 15%)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer"
      },
      arrow: {
        ...ReactReaderStyle.arrow,
        alignItems: "center",
        top: "auto",
        bottom: 20,
        boxSizing: "border-box",
        display: "flex",
        width: 36,
        height: 36,
        justifyContent: "center",
        marginTop: 0,
        padding: 0,
        fontSize: 28,
        lineHeight: 1,
        color: theme.faint,
        appearance: "none",
        background: "transparent",
        border: "none",
        borderRadius: 0,
        boxShadow: "none",
        opacity: 0.72,
        outline: "none",
        zIndex: 400
      },
      tocArea: {
        ...ReactReaderStyle.tocArea,
        top: (tocOffset + 20).toString() + "px",
        bottom: 0,
        left: "auto",
        width: 226,
        padding: "10px 9px 14px",
        background: `color-mix(in srgb, ${theme.background} 84%, transparent)`,
        backdropFilter: "blur(18px) saturate(1.2)",
        borderRight: `1px solid ${theme.border}`,
        boxShadow: "8px 0 24px rgb(0 0 0 / 8%)",
        color: theme.text,
        fontFamily: theme.fontFamily,
        fontSize: theme.fontSize
      },
      tocAreaButton: {
        ...ReactReaderStyle.tocAreaButton,
        alignItems: "flex-start",
        appearance: "none",
        background: `color-mix(in srgb, ${theme.background} 58%, transparent)`,
        border: `1px solid color-mix(in srgb, ${theme.border} 26%, transparent)`,
        borderRadius: 9,
        boxSizing: "border-box",
        color: theme.muted,
        display: "block",
        fontFamily: theme.fontFamily,
        fontSize: "0.78em",
        height: "auto",
        lineHeight: 1.36,
        margin: "3px 0",
        minHeight: 0,
        outline: "none",
        overflow: "visible",
        overflowWrap: "anywhere",
        padding: "6px 9px",
        textAlign: "left",
        boxShadow: "none",
        width: "100%",
        whiteSpace: "normal",
        wordBreak: "break-word"
      },
      tocButtonExpanded: {
        ...ReactReaderStyle.tocButtonExpanded,
        backgroundColor: "transparent"
      },
      tocButton: {
        ...ReactReaderStyle.tocButton,
        appearance: "none",
        background: `color-mix(in srgb, ${theme.background} 82%, transparent)`,
        backdropFilter: "blur(14px) saturate(1.2)",
        border: `1px solid color-mix(in srgb, ${theme.border} 68%, transparent)`,
        borderRadius: 10,
        boxShadow: "0 4px 12px rgb(0 0 0 / 8%)",
        height: 34,
        left: 18,
        top: 18,
        width: 34
      },
      tocButtonBar: {
        ...ReactReaderStyle.tocButtonBar,
        background: theme.muted,
        borderRadius: 2,
        height: 2,
        width: "54%",
        margin: "-1px -27%"
      }
    } as any
  }), pendingHighlightMenu ? (() => {
    const containsEnglish = /[a-zA-Z]{2,}/.test(pendingHighlightMenu.quote || "");
    const filteredSmartcmds = (smartCommands || []).filter(c => c.enabled !== false && (c.scope === "selection" || c.scope === "both"));
    return React.createElement("div", {
      className: "jarvis-reader-highlight-menu",
      style: pendingHighlightMenu.rect ? {
        left: pendingHighlightMenu.rect.x,
        top: pendingHighlightMenu.rect.y
      } : void 0,
      onClick: (event) => event.stopPropagation()
    },
      React.createElement("div", {
        className: "jarvis-reader-context-menu-item",
        role: "button",
        onClick: () => {
          copyHighlightQuote(pendingHighlightMenu);
          setPendingHighlightMenu(null);
        }
      }, renderObsidianIcon("copy"), React.createElement("span", null, "复制")),
      containsEnglish ? React.createElement("div", {
        className: "jarvis-reader-context-menu-item",
        role: "button",
        onClick: () => {
          openWordTranslator(pendingHighlightMenu);
          setPendingHighlightMenu(null);
        }
      }, renderObsidianIcon("languages"), React.createElement("span", null, "翻译")) : null,
      pendingHighlightMenu.id ? null : React.createElement("div", {
        className: "jarvis-reader-context-menu-item",
        role: "button",
        onClick: () => {
          savePlainHighlight(pendingHighlightMenu);
          setPendingHighlightMenu(null);
        }
      }, renderObsidianIcon("highlighter"), React.createElement("span", null, "高亮")),
      React.createElement("div", {
        className: "jarvis-reader-context-menu-item jarvis-reader-highlight-menu-button-primary",
        role: "button",
        onClick: () => {
          openHighlightCommentEditor(pendingHighlightMenu);
          setPendingHighlightMenu(null);
        }
      }, renderObsidianIcon("pencil"), React.createElement("span", null, "笔记")),
      pendingHighlightMenu.id ? React.createElement("div", {
        className: "jarvis-reader-context-menu-item jarvis-reader-context-menu-item-danger",
        role: "button",
        onClick: () => {
          deleteExistingHighlight(pendingHighlightMenu);
          setPendingHighlightMenu(null);
        }
      }, renderObsidianIcon("trash"), React.createElement("span", null, "删除高亮")) : null,
      filteredSmartcmds.length > 0 ? React.createElement(React.Fragment, null,
        React.createElement("div", { className: "jarvis-reader-context-menu-divider" }),
        React.createElement("div", {
          className: "jarvis-reader-context-menu-item has-submenu",
          onMouseEnter: () => setHoveredMenuItem("ai"),
          onMouseLeave: () => setHoveredMenuItem(null),
          style: { position: "relative" }
        },
          renderObsidianIcon("bot"),
          React.createElement("span", null, "智能指令"),
          renderObsidianIcon("chevron-right"),
          hoveredMenuItem === "ai" ? React.createElement("div", {
            className: "jarvis-reader-context-submenu",
          },
            filteredSmartcmds.map(cmd =>
              React.createElement("div", {
                key: cmd.id,
                className: "jarvis-reader-context-menu-item",
                role: "button",
                onClick: (e) => {
                  e.stopPropagation();
                  void fireSmartCommand(cmd, "selection");
                  setPendingHighlightMenu(null);
                  setHoveredMenuItem(null);
                }
              }, renderObsidianIcon(cmd.icon || "bot"), React.createElement("span", null, cmd.label))
            )
          ) : null
        )
      ) : null
    );
  })() : null, pendingWordSelection ?  React.createElement("div", {
    className: "jarvis-reader-highlight-popover is-floating jarvis-reader-word-translate",
    style: visibleWordPopoverRect ? {
      left: visibleWordPopoverRect.x,
      top: visibleWordPopoverRect.y,
      width: visibleWordPopoverRect.width
    } : void 0,
    onClick: (event) => event.stopPropagation()
  },  React.createElement("div", {
    className: "jarvis-reader-word-card-head",
    style: { cursor: "grab" },
    onPointerDown: beginWordTranslationMove,
    onDoubleClick: resetWordTranslationRect
  }, React.createElement("div", {
    className: "jarvis-reader-word-card-head-row"
  }, React.createElement("div", {
    className: "jarvis-reader-highlight-title"
  }, "\u7ffb\u8bd1"), React.createElement("div", {
    style: { flex: "1 1 auto", cursor: "grab", minHeight: "24px", minWidth: "20px" }
  }), React.createElement("div", {
    className: "jarvis-reader-word-card-actions",
    onPointerDown: (event) => event.stopPropagation()
  }, savedWordAsset ?  React.createElement("button", {
    className: "jarvis-reader-word-card-action jarvis-reader-word-card-open",
    title: "\u6253\u5f00\u8bcd\u6761",
    onClick: () => openWordNote(savedWordAsset)
  }, renderObsidianIcon("book-open")) : null, canSwitchPendingWordToAi ?  React.createElement("button", {
    className: "jarvis-reader-word-card-action jarvis-reader-word-card-ai",
    title: "AI \u7ffb\u8bd1",
    onClick: translatePendingWordWithAi
  }, renderObsidianIcon("bot")) : null, savedWordAsset && savedWordAsset.mastered ?  React.createElement("button", {
    className: "jarvis-reader-word-card-action jarvis-reader-word-card-mastered",
    title: "\u91cd\u65b0\u52a0\u5165",
    onClick: restorePendingWordAsset
  }, renderObsidianIcon("rotate-ccw")) : null, canPersistPendingWord && !savedWordAsset ?  React.createElement("button", {
    className: "jarvis-reader-word-card-action jarvis-reader-word-card-save",
    title: persistPendingLabel,
    onClick: persistPendingWordAsset
  }, renderObsidianIcon("bookmark-plus")) : null, React.createElement("button", {
    className: "jarvis-reader-word-card-action jarvis-reader-word-card-close",
    title: "\u5173\u95ed",
    onClick: clearHighlightUi
  }, renderObsidianIcon("x"))))),  React.createElement("div", {
    className: "jarvis-reader-word-panel"
  }, wordLookupState.status === "loading" ?  React.createElement("div", {
    className: "jarvis-reader-word-muted"
  }, "\u6b63\u5728\u7ffb\u8bd1...") : null, wordLookupState.status === "error" ?  React.createElement("div", {
    className: "jarvis-reader-word-error"
  }, wordLookupState.error || "\u7ffb\u8bd1\u5931\u8d25\u3002") : null, wordLookupState.status === "ready" && wordLookupState.result ?  React.createElement(React.Fragment, null, wordLookupState.result.isWord ?  React.createElement("div", {
    className: "jarvis-reader-word-head"
  },  React.createElement("button", {
    className: "jarvis-reader-word-lemma jarvis-reader-word-lemma-button jarvis-reader-word-translate-lemma",
    title: "\u70b9\u51fb\u53d1\u97f3",
    onClick: () => playWordAudioText((wordLookupState.result == null ? void 0 : wordLookupState.result.surface) || (wordLookupState.result == null ? void 0 : wordLookupState.result.lemma) || pendingWordSelection.quote || ""),
    disabled: !enableWordAudio
  }, wordLookupState.result.surface || wordLookupState.result.lemma), wordLookupState.result.phonetic ?  React.createElement("div", {
  }, wordLookupState.result.phonetic) : null) : null, 
  pendingWordTags.length ? React.createElement("div", { className: "jarvis-reader-word-tags" },
    pendingWordTags.slice(0, 3).map((tag) => React.createElement("span", { key: tag.label, className: `jarvis-reader-word-tag is-${tag.tone}` }, tag.label)),
    pendingWordTags.length > 3 ? React.createElement("span", { className: "jarvis-reader-word-tag is-more" }, `+${pendingWordTags.length - 3}`) : null
  ) : null,
  React.createElement("div", { className: "jarvis-reader-word-definition-card" }, wordLookupState.result.display ? renderWordDisplayContent(wordLookupState.result.display) :  React.createElement("div", {
    className: "jarvis-reader-word-translation"
  }, wordLookupState.result.translation))) : null)) : null, pendingSelection ?  React.createElement("div", {
    className: isWikiSuggestOpen ? "jarvis-reader-highlight-popover is-floating is-suggesting" : "jarvis-reader-highlight-popover is-floating",
    style: visibleHighlightPopoverRect ? {
      left: visibleHighlightPopoverRect.x,
      top: visibleHighlightPopoverRect.y,
      width: visibleHighlightPopoverRect.width,
      height: visibleHighlightPopoverRect.height
    } : void 0
  },  React.createElement("div", {
    className: "jarvis-reader-highlight-title-row",
    onPointerDown: beginHighlightPopoverMove,
    onDoubleClick: resetHighlightPopoverRect
  },  React.createElement("div", {
    className: "jarvis-reader-highlight-title"
  }, "笔记"),  React.createElement("div", {
    className: "jarvis-reader-highlight-header-actions",
    onPointerDown: (event) => event.stopPropagation()
  }, isExistingHighlightComment && pendingSelection.notePath ? React.createElement("button", {
    className: "jarvis-reader-highlight-icon-button",
    type: "button",
    title: "\u6253\u5f00\u7b14\u8bb0\u6587\u4ef6",
    onClick: openHighlightNoteBlock
  }, renderObsidianIcon("file-text")) : null, isReadingHighlightComment ? React.createElement("button", {
    className: "jarvis-reader-highlight-icon-button",
    type: "button",
    title: "\u8ffd\u52a0\u7b14\u8bb0",
    onClick: () => {
      setHighlightComment("");
      setHighlightCommentMode("append");
      setHighlightContentTab("notes");
    }
  }, renderObsidianIcon("file-pen-line")) : null,
  isExistingHighlightComment && hasPromotableHighlightNote && typeof promoteHighlight === "function" ? React.createElement("button", {
    className: "jarvis-reader-highlight-icon-button",
    type: "button",
    title: "提升为知识笔记",
    onClick: () => promoteHighlight(pendingSelection)
  }, renderObsidianIcon("file-plus-2")) : null,
  ...(smartCommands || []).filter(c => c.enabled !== false && (c.scope === "note" || c.scope === "both")).map(cmd =>
    React.createElement("button", {
      key: cmd.id,
      className: "jarvis-reader-highlight-icon-button",
      type: "button",
      title: cmd.label,
      onClick: () => { void fireSmartCommand(cmd, "note"); }
    }, renderObsidianIcon(cmd.icon || "bot"))
  ),
  React.createElement("button", {
    className: "jarvis-reader-highlight-icon-button",
    type: "button",
    title: "\u5173\u95ed",
    onClick: clearHighlightUi
  }, renderObsidianIcon("x")))),  React.createElement("div", {
    className: "jarvis-reader-highlight-content-frame"
  }, React.createElement("div", {
    className: "jarvis-reader-highlight-quote"
  }, pendingSelection.quote), isReadingHighlightComment ? React.createElement(React.Fragment, null, React.createElement("div", {
    className: "jarvis-reader-highlight-subtabs"
  }, React.createElement("button", {
    className: highlightContentTab === "notes" ? "jarvis-reader-highlight-subtab is-active" : "jarvis-reader-highlight-subtab",
    type: "button",
    onClick: () => setHighlightContentTab("notes")
  }, renderObsidianIcon("sticky-note"), "笔记"), React.createElement("button", {
    className: highlightContentTab === "ai" ? "jarvis-reader-highlight-subtab is-active" : "jarvis-reader-highlight-subtab",
    type: "button",
    onClick: () => setHighlightContentTab("ai")
  }, renderObsidianIcon("link"), "关联")), React.createElement("div", {
    className: "jarvis-reader-highlight-section"
  }, highlightContentTab === "ai" ? renderHighlightAiSections() : renderHighlightNotes())) : React.createElement(React.Fragment, null, isExistingHighlightComment && highlightNoteEntries.length ? React.createElement("div", {
    className: "jarvis-reader-highlight-note-list is-compact"
  }, highlightNoteEntries.map((entry, index) => React.createElement("div", {
    className: "jarvis-reader-highlight-note-card",
    key: `${entry.label || "note"}-${index}`
  }, React.createElement("div", {
    className: "jarvis-reader-highlight-note-card-text"
  }, entry.text), React.createElement("div", {
    className: "jarvis-reader-highlight-note-card-time"
  }, formatHighlightNoteTime(entry.created))))) : null, React.createElement(WikiLinkCodeMirrorEditor, {
    value: highlightComment,
    onChange: (value) => setHighlightComment(value),
    candidates: currentWikiLinkCandidates,
    onOpenLink: openWikiLink,
    placeholder: highlightCommentPlaceholder
  }),  React.createElement("div", {
    className: "jarvis-reader-highlight-input-shell",
    onMouseDown: (event) => {
      const target = event.target as HTMLElement;
      if (target.closest("textarea, .jarvis-reader-highlight-input-wikilink")) return;
      event.preventDefault();
      highlightInputRef.current?.focus();
    }
  },  React.createElement("div", {
    className: "jarvis-reader-highlight-input-preview"
  }, renderWikiInputPreview(highlightComment)),  React.createElement("textarea", {
    className: "jarvis-reader-highlight-input",
    ref: highlightInputRef,
    value: highlightComment,
    placeholder: highlightCommentPlaceholder,
    autoFocus: true,
    onChange: (event) => {
      const value = event.currentTarget.value;
      setHighlightComment(value);
      updateWikiSuggest(value, event.currentTarget.selectionStart || value.length);
      updateWikiEditRange(value, event.currentTarget.selectionStart || value.length);
    },
    onClick: (event) => {
      const input = event.currentTarget;
      window.setTimeout(() => {
        updateWikiSuggest(input.value, input.selectionStart || 0);
        updateWikiEditRange(input.value, input.selectionStart || 0);
      }, 0);
    },
    onKeyDown: (event) => {
      event.stopPropagation();
      if (event.nativeEvent && typeof event.nativeEvent.stopImmediatePropagation === "function") {
        event.nativeEvent.stopImmediatePropagation();
      }
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        confirmHighlight();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        wrapSelectionAsWikiLink(event.currentTarget);
        return;
      }
      if (wikiSuggest && wikiSuggest.items && wikiSuggest.items.length) {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          const direction = event.key === "ArrowDown" ? 1 : -1;
          setWikiSuggest({
            ...wikiSuggest,
            activeIndex: (wikiSuggest.activeIndex + direction + wikiSuggest.items.length) % wikiSuggest.items.length
          });
          return;
        }
        if (event.key === "Enter" || event.key === "Tab") {
          event.preventDefault();
          insertWikiCandidate(wikiSuggest.items[wikiSuggest.activeIndex] || wikiSuggest.items[0]);
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          setWikiSuggest(null);
          return;
        }
      }
      if (event.key === "Escape") {
        event.preventDefault();
        if (isExistingHighlightComment) {
          setHighlightComment("");
          setHighlightCommentMode("view");
          setHighlightContentTab("notes");
          setWikiSuggest(null);
          setWikiEditRange(null);
          return;
        }
        setPendingSelection(null);
        setHighlightComment("");
        setWikiSuggest(null);
        setWikiEditRange(null);
      }
    },
    onKeyUp: (event) => {
      event.stopPropagation();
      if (event.nativeEvent && typeof event.nativeEvent.stopImmediatePropagation === "function") {
        event.nativeEvent.stopImmediatePropagation();
      }
      if (!["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(event.key)) {
        updateWikiSuggest(event.currentTarget.value, event.currentTarget.selectionStart || 0);
        updateWikiEditRange(event.currentTarget.value, event.currentTarget.selectionStart || 0);
      }
    }
  }))), wikiSuggest && wikiSuggest.items && wikiSuggest.items.length ?  React.createElement("div", {
    className: "jarvis-reader-wikilink-suggest"
  }, wikiSuggest.items.map((item, index) =>  React.createElement("button", {
    key: `${item.path}-${index}`,
    type: "button",
    className: index === wikiSuggest.activeIndex ? "jarvis-reader-wikilink-suggest-item is-active" : "jarvis-reader-wikilink-suggest-item",
    onMouseDown: (event) => {
      event.preventDefault();
      insertWikiCandidate(item);
    }
  },  React.createElement("span", {
    className: "jarvis-reader-wikilink-suggest-title"
  }, item.title),  React.createElement("span", {
    className: "jarvis-reader-wikilink-suggest-path"
  }, item.path)))) : null, isReadingHighlightComment ? null : React.createElement("div", {
    className: "jarvis-reader-highlight-actions"
  },  React.createElement("button", {
    className: "jarvis-reader-highlight-button",
    onClick: () => {
      if (isExistingHighlightComment) {
        setHighlightComment("");
        setHighlightCommentMode("view");
        setEditingNoteIndex(null);
        setHighlightContentTab("notes");
        setWikiSuggest(null);
        setWikiEditRange(null);
        return;
      }
      setPendingSelection(null);
      setHighlightComment("");
      setWikiSuggest(null);
      setWikiEditRange(null);
    }
  }, "取消"),  React.createElement("button", {
    className: "jarvis-reader-highlight-button jarvis-reader-highlight-button-primary",
    onClick: confirmHighlight
  }, isExistingHighlightComment ? "保存笔记" : "保存")), React.createElement("div", {
    className: "jarvis-reader-highlight-resize-handle",
    onPointerDown: beginHighlightPopoverResize,
    title: "Resize"
  }))) : null, activeWordHover ?  React.createElement("div", {
    className: "jarvis-reader-word-card" + (activeWordHover.isPinned ? " is-pinned" : ""),
    style: {
      left: activeWordHover.left,
      top: activeWordHover.top
    },
    onMouseEnter: clearWordHoverHideTimer,
    onMouseLeave: scheduleHideWordHoverCard
  },  React.createElement("div", {
    className: "jarvis-reader-word-card-head",
    style: { cursor: "grab" },
    onPointerDown: beginWordHoverCardMove,
    onDoubleClick: resetWordHoverCardPosition
  },  React.createElement("div", {
    className: "jarvis-reader-word-card-head-row"
  }, getTranslationAssetKind(activeWordHover.asset) === "sentence" ?  React.createElement("div", {
    className: "jarvis-reader-word-card-lemma jarvis-reader-word-card-sentence-title",
    style: { flex: "0 0 auto", cursor: "text", fontSize: "14px", color: "var(--text-muted)" },
    onPointerDown: (e) => e.stopPropagation()
  }, "\u957f\u53e5\u7ffb\u8bd1") :  React.createElement("button", {
    className: "jarvis-reader-word-card-lemma",
    title: "\u70b9\u51fb\u53d1\u97f3",
    style: { flex: "0 0 auto", cursor: "pointer" },
    onPointerDown: (e) => e.stopPropagation(),
    onClick: () => playWordAudioText(activeWordHover.asset.title || activeWordHover.asset.lemma || "")
  }, activeWordHover.asset.title || activeWordHover.asset.lemma),  React.createElement("div", {
    style: { flex: "1 1 auto", cursor: "grab", minHeight: "24px", minWidth: "20px" }
  }),  React.createElement("div", {
    className: "jarvis-reader-word-card-actions",
    onPointerDown: (e) => e.stopPropagation()
  },  React.createElement("button", {
    className: "jarvis-reader-word-card-action jarvis-reader-word-card-open",
    title: "打开词条",
    onClick: () => {
      hideWordHoverCard();
      openWordNote(activeWordHover.asset);
    }
  }, renderObsidianIcon("book")), React.createElement("button", {
    className: "jarvis-reader-word-card-action jarvis-reader-word-card-ai",
    title: "AI翻译",
    onClick: translateActiveWordWithAi
  }, renderObsidianIcon("bot")), React.createElement("button", {
    className: "jarvis-reader-word-card-action jarvis-reader-word-card-mastered",
    title: "\u6807\u8bb0\u5df2\u638c\u63e1",
    onClick: markActiveWordMastered
  }, renderObsidianIcon("check")),  React.createElement("button", {
    className: "jarvis-reader-word-card-action jarvis-reader-word-card-delete",
    title: "\u5220\u9664\u8bcd\u6761",
    onClick: deleteActiveWordAsset
  }, renderObsidianIcon("trash")),  React.createElement("button", {
    className: "jarvis-reader-word-card-action jarvis-reader-word-card-close",
    title: "\u5173\u95ed\u5361\u7247",
    onClick: hideWordHoverCard
  }, renderObsidianIcon("x")))), activeWordHover.asset.phonetic ?  React.createElement("div", {
  }, activeWordHover.asset.phonetic) : null), 
  activeWordHover.asset.isWord && (activeWordHover.asset.tags || activeWordHover.asset.collins || activeWordHover.asset.oxford) ? React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: "4px", marginTop: "4px", marginBottom: "8px", paddingLeft: "16px", paddingRight: "16px" } },
    activeWordHover.asset.oxford === 1 ? React.createElement("span", { className: "jarvis-tag", style: { background: "color-mix(in srgb, var(--color-blue) 20%, transparent)", color: "var(--color-blue)", border: "1px solid color-mix(in srgb, var(--color-blue) 40%, transparent)", fontSize: "0.75em", padding: "1px 6px", borderRadius: "12px" } }, "牛津核心") : null,
    activeWordHover.asset.collins && activeWordHover.asset.collins > 0 ? React.createElement("span", { className: "jarvis-tag", style: { background: "color-mix(in srgb, var(--color-yellow) 20%, transparent)", color: "var(--color-yellow)", border: "1px solid color-mix(in srgb, var(--color-yellow) 40%, transparent)", fontSize: "0.75em", padding: "1px 6px", borderRadius: "12px" } }, '★'.repeat(activeWordHover.asset.collins)) : null,
    activeWordHover.asset.tags ? activeWordHover.asset.tags.map((tag: string) => React.createElement("span", { key: tag, className: "jarvis-tag", style: { background: "color-mix(in srgb, var(--color-green) 15%, transparent)", color: "var(--color-green)", fontSize: "0.75em", padding: "1px 6px", borderRadius: "12px", border: "1px solid color-mix(in srgb, var(--color-green) 40%, transparent)" } }, tag.toUpperCase())) : null
  ) : null,
  React.createElement("div", {
    className: blurWordCardBody ? "jarvis-reader-word-card-body is-blurred" : "jarvis-reader-word-card-body"
  }, (getTranslationAssetKind(activeWordHover.asset) === "sentence" || (activeWordHover.asset.title || activeWordHover.asset.lemma || "").length > 30) ?  React.createElement("div", {
    className: "jarvis-reader-word-card-original-sentence",
    style: { background: "color-mix(in srgb, var(--background-secondary) 78%, transparent)", borderRadius: "10px", padding: "10px 12px", marginBottom: "10px", fontSize: "0.95em", lineHeight: "1.5", color: "var(--text-normal)" }
  }, activeWordHover.asset.title || (activeWordHover.asset.sources && activeWordHover.asset.sources[0] && activeWordHover.asset.sources[0].quote) || "") : null,  React.createElement("div", {
    style: { background: "var(--background-primary)", border: "1px solid color-mix(in srgb, var(--background-modifier-border) 70%, transparent)", borderRadius: "10px", padding: "10px 12px", display: "flex", flexDirection: "column", gap: "6px" }
  }, activeWordHover.asset.display ? renderWordDisplayContent(activeWordHover.asset.display) : null, !activeWordHover.asset.display ?  React.createElement("div", {
    className: "jarvis-reader-word-translation"
  }, activeWordHover.asset.translation || "") : null, !activeWordHover.asset.display && activeWordHover.asset.partOfSpeech ?  React.createElement("div", {
    className: "jarvis-reader-word-pos"
  }, activeWordHover.asset.partOfSpeech) : null, !activeWordHover.asset.display && activeWordHover.asset.example ?  React.createElement("div", {
    className: "jarvis-reader-word-example"
  }, activeWordHover.asset.example) : null)), activeWordHover.asset.sources && activeWordHover.asset.sources.length ?  React.createElement("div", {
    className: "jarvis-reader-word-card-sources"
  },  React.createElement("div", {
    className: "jarvis-reader-word-card-section-title"
  }, "\u6765\u6e90"), activeWordHover.asset.sources.slice(0, 3).map((source, index) =>  React.createElement("div", {
    className: "jarvis-reader-word-card-source",
    key: `${source.bookPath || ""}-${source.cfiRange || index}`
  }, source.bookTitle || source.bookPath || "", source.chapterTitle ? ` \u00b7 ${source.chapterTitle}` : "", source.quote ?  React.createElement("div", {
    className: "jarvis-reader-word-card-source-quote"
  }, source.quote) : null))) : null, activeWordHover.asset.updated ?  React.createElement("div", {
    className: "jarvis-reader-word-card-updated"
  }, `Updated ${formatLocalDate(activeWordHover.asset.updated)}`) : null) : null, progressLabel ?  React.createElement("div", {
    className: "jarvis-reader-progress-label"
  }, progressLabel) : null);
};
