// Extracted from main.js L49177-51296 — EpubReader React component
import React, { useState, useRef, useEffect, useCallback, useMemo, useLayoutEffect } from "react";
import { Notice, setIcon } from "obsidian";
import { ReactReader } from "react-reader";
import * as ReactReaderModule from "react-reader";
import { normalizeHighlightQuote, normalizeWordDisplayText, escapeRegExp, formatLocalDate } from "./utils";
import { normalizeWordSelection, findWordAssetBySurface, getWordAssetSurfaceForms, getTranslationAssetKind, getTranslationAssetKey, getTranslationAssetStorageKey, buildWordAudioUrl } from "./word-assets";
import { clampReaderZoom, clampReaderLineHeight, getJarvisReaderTheme, applyObsidianThemeToRendition } from "./theme";
import { findChapterTitle, getReaderProgressLabel, ensureReaderLocations, getReaderProgress } from "./progress";
import { dedupeHighlightsByCfi } from "./highlight-core";
import { WikiLinkCodeMirrorEditor } from "./wiki-editor";
import type { BookHighlight, WordAsset } from "./types";

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
  onInteraction?: () => void;
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

// src/EpubView.tsx

export const EpubReader: React.FC<EpubReaderProps> = ({ contents, title, bookPath, scrolled, singlePage, readerZoom, readerLineHeight, tocOffset, initLocation, saveLocation, saveProgress, tocMemo, createBookNote, highlights, createHighlight, updateHighlight, deleteHighlight, selectHighlight, registerHighlightEditor, registerHighlightDeleted, setScrolled, setSinglePage, setReaderZoom, setReaderLineHeight, syncRenditionTheme, wordAssets, translateSelection, saveWordAsset, openWordNote, setWordMastered, deleteWordAsset, loadWordDisplay, addBookmark, autoWordHighlight, speechLang, highlightColors, enableWordAudio, wordAudioTemplate, wordAudioAccent, blurWordCardBody, wikiLinkCandidates, getWikiLinkCandidates, openWikiLink, onInteraction }) => {
  const [location, setLocation] = useState<any>(initLocation);
  const [readerTitle, setReaderTitle] = useState<any>(title);
  const [progressLabel, setProgressLabel] = useState<any>("");
  const [highlightList, setHighlightList] = useState<any[]>(highlights || []);
  const [pendingSelection, setPendingSelection] = useState<any>(null);
  const [highlightComment, setHighlightComment] = useState<any>("");
  const [currentWordAssets, setCurrentWordAssets] = useState<any>(wordAssets || {});
  const [pendingWordSelection, setPendingWordSelection] = useState<any>(null);
  const [wordLookupState, setWordLookupState] = useState<any>({ status: "idle", result: null, error: "", savedLemma: "" });
  const [activeWordHover, setActiveWordHover] = useState<any>(null);
  const [currentWikiLinkCandidates, setCurrentWikiLinkCandidates] = useState<any[]>(wikiLinkCandidates || []);
  const [pendingHighlightMenu, setPendingHighlightMenu] = useState<any>(null);
  const [wikiSuggest, setWikiSuggest] = useState<any>(null);
  const [wikiEditRange, setWikiEditRange] = useState<any>(null);
  const [highlightPopoverRect, setHighlightPopoverRect] = useState<any>(null);
  const containerRef = useRef<any>(null);
  const highlightInputRef = useRef<any>(null);
  const highlightPopoverRectRef = useRef<any>(null);
  const renditionRef = useRef<any>(null);
  const currentLocationRef = useRef<string | null>(initLocation);
  const highlightListRef = useRef<any[]>(highlights || []);
  const wordAssetsRef = useRef<any>(wordAssets || {});
  const wordDisplayCacheRef = useRef<any>( new Map());
  const pendingWordLookupRef = useRef<any>(0);
  const [theme, setTheme] = useState(() => getJarvisReaderTheme(readerZoom, readerLineHeight));
  const [currentColors, setCurrentColors] = useState<any>(highlightColors);

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
    const height = Math.min(320, Math.max(280, bounds.height - 180));
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
  const beginHighlightPopoverMove = (event) => {
    if (event.button != null && event.button !== 0)
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
    setLocation(epubcifi);
    currentLocationRef.current = epubcifi;
    saveLocation(epubcifi);
  };
  const refreshHighlightPanes = (rendition) => {
    window.setTimeout(() => {
      window.requestAnimationFrame(() => {
        var _a, _b;
        try {
          const views = ((_b = (_a = rendition == null ? void 0 : rendition.manager) == null ? void 0 : _a.visible) == null ? void 0 : _b.call(_a)) || [];
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
      const views = typeof rendition.views === "function" ? rendition.views() || [] : [];
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
        rendition.annotations.highlight(highlight.cfiRange, { id: highlight.id }, eventHandler, "jarvis-reader-highlight-with-comment-bg", {
          fill: commentColor,
          "fill-opacity": "0.15",
          "mix-blend-mode": "multiply"
        });
        rendition.annotations.underline(highlight.cfiRange, { id: highlight.id }, eventHandler, "jarvis-reader-highlight-with-comment", {
          stroke: commentColor,
          "stroke-opacity": "0.98",
          "stroke-width": "2.0",
          "mix-blend-mode": "multiply"
        });
      } else {
        const normalColor = currentColors?.normal || "#ffeb3b";
        rendition.annotations.highlight(highlight.cfiRange, { id: highlight.id }, eventHandler, "jarvis-reader-highlight", {
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
    if (!pendingHighlightMenu || pendingHighlightMenu.id)
      return;
    const rendition = renditionRef.current;
    const views = rendition && rendition.manager && typeof rendition.manager.visible === "function" ? rendition.manager.visible() || [] : [];
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
    if (!selectedText)
      return;
    const selectionItem = {
      cfiRange,
      quote: selectedText,
      sentence: getSelectionContextSentence(contents2, selectedText),
      chapterTitle: readerTitleRef.current,
      rect: getSelectionHighlightMenuRect(contents2)
    };
    const existingHighlight = (highlightListRef.current || []).find((highlight) => highlight.cfiRange === cfiRange);
    clearWordLookup();
    setPendingSelection(null);
    if (existingHighlight) {
      setPendingHighlightMenu({
        ...existingHighlight,
        rect: selectionItem.rect
      });
      setHighlightComment("");
      setWikiSuggest(null);
      setWikiEditRange(null);
      return;
    }
    Promise.resolve(openWordTranslator(selectionItem, { autoLocalOnly: true })).then((opened) => {
      if (!opened) {
        clearWordLookup();
        setPendingHighlightMenu(selectionItem);
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
    clearWordLookup();
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
    setHighlightComment(item.comment || "");
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
    const deleted = await deleteHighlight(item);
    if (deleted) {
      removeHighlightMark(renditionRef.current, item);
      setHighlightList((current) => current.filter((highlight) => highlight.cfiRange !== item.cfiRange));
    }
    clearHighlightUi();
  };
  const confirmHighlight = async () => {
    if (!pendingSelection)
      return;
    setWikiSuggest(null);
    if (pendingSelection.id) {
      const updated = await updateHighlight({
        ...pendingSelection,
        comment: highlightComment.trim()
      });
      if (updated) {
        removeHighlightMark(renditionRef.current, pendingSelection);
        applyHighlight(renditionRef.current, updated);
        setHighlightList((current) => current.map((item) => item.id === updated.id ? updated : item));
      }
    } else {
      const created = await createHighlight({
        ...pendingSelection,
        comment: highlightComment.trim()
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
  const activeWordPopoverRect = pendingWordSelection ? highlightPopoverRect || getDefaultHighlightPopoverRect() : null;
  const visibleWordPopoverRect = activeWordPopoverRect ? clampHighlightPopoverRect({
    ...activeWordPopoverRect,
    height: Math.max(activeWordPopoverRect.height || 0, 360)
  }) : null;
  const normalizedPendingWord = pendingWordSelection ? normalizeWordSelection((wordLookupState.result == null ? void 0 : wordLookupState.result.lemma) || pendingWordSelection.quote || "") : null;
  const pendingTranslationKey = pendingWordSelection && wordLookupState.result ? getTranslationAssetKey(pendingWordSelection, wordLookupState.result) : normalizedPendingWord ? normalizedPendingWord.lemma : "";
  const pendingTranslationKind = pendingWordSelection && wordLookupState.result ? getTranslationAssetKind(pendingWordSelection.quote || "", wordLookupState.result) : normalizedPendingWord && normalizedPendingWord.isPhrase ? "phrase" : "word";
  const savedWordAsset = pendingTranslationKey ? currentWordAssets[pendingTranslationKey] || null : null;
  const canPersistPendingWord = !!(pendingWordSelection && wordLookupState.status === "ready" && wordLookupState.result && pendingTranslationKey);
  const canSwitchPendingWordToAi = !!(pendingWordSelection && wordLookupState.status === "ready" && wordLookupState.result && wordLookupState.result.sourceType);
  const persistPendingLabel = pendingTranslationKind === "sentence" ? "\u4fdd\u5b58\u53e5\u5b50" : pendingTranslationKind === "phrase" ? "\u4fdd\u5b58\u77ed\u8bed" : "\u4fdd\u5b58\u5355\u8bcd";
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
  },  React.createElement("div", {
    className: "jarvis-reader-side-hover-zone"
  },  React.createElement("div", {
    className: "jarvis-reader-side-controls"
  },  React.createElement("button", {
    className: "jarvis-reader-side-button",
    title: "添加书签",
    "aria-label": "添加书签",
    onClick: () => {
      if (typeof addBookmark === "function" && currentLocationRef.current && readerTitleRef.current) {
        addBookmark(currentLocationRef.current, readerTitleRef.current);
      }
    },
    dangerouslySetInnerHTML: { __html: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-bookmark"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/></svg>' }
  }),  React.createElement("button", {
    className: "jarvis-reader-side-button",
    title: "\u521b\u5efa\u6216\u6253\u5f00\u8bfb\u4e66\u7b14\u8bb0",
    "aria-label": "\u521b\u5efa\u6216\u6253\u5f00\u8bfb\u4e66\u7b14\u8bb0",
    onClick: createBookNote,
    dangerouslySetInnerHTML: { __html: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>' }
  }),  React.createElement("button", {
    className: "jarvis-reader-side-button",
    title: "\u653e\u5927",
    "aria-label": "\u653e\u5927",
    onClick: () => setReaderZoom(0.05),
    dangerouslySetInnerHTML: { __html: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14"></path><path d="M5 12h14"></path></svg>' }
  }),  React.createElement("button", {
    className: "jarvis-reader-side-button",
    title: "\u7f29\u5c0f",
    "aria-label": "\u7f29\u5c0f",
    onClick: () => setReaderZoom(-0.05),
    dangerouslySetInnerHTML: { __html: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"></path></svg>' }
  }),  React.createElement("button", {
    className: "jarvis-reader-side-button",
    title: "\u51cf\u5c0f\u884c\u8ddd",
    "aria-label": "\u51cf\u5c0f\u884c\u8ddd",
    onClick: () => setReaderLineHeight(-0.05),
    dangerouslySetInnerHTML: { __html: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6h8"></path><path d="M8 12h8"></path><path d="M8 18h8"></path><path d="M4 9l2-2 2 2"></path><path d="M4 15l2 2 2-2"></path></svg>' }
  }),  React.createElement("button", {
    className: "jarvis-reader-side-button",
    title: "\u589e\u5927\u884c\u8ddd",
    "aria-label": "\u589e\u5927\u884c\u8ddd",
    onClick: () => setReaderLineHeight(0.05),
    dangerouslySetInnerHTML: { __html: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6h8"></path><path d="M8 12h8"></path><path d="M8 18h8"></path><path d="M4 6l2-2 2 2"></path><path d="M4 18l2 2 2-2"></path></svg>' }
  }), singlePage ?  React.createElement("button", {
    className: "jarvis-reader-side-button jarvis-reader-side-mode-button",
    title: effectiveScrolled ? "\u5207\u6362\u5230\u5206\u9875" : "\u5207\u6362\u5230\u6eda\u52a8",
    "aria-label": effectiveScrolled ? "\u5207\u6362\u5230\u5206\u9875" : "\u5207\u6362\u5230\u6eda\u52a8",
    onClick: () => setScrolled(!effectiveScrolled),
    dangerouslySetInnerHTML: { __html: effectiveScrolled ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5z"></path></svg>' : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3 4 7l4 4"></path><path d="M4 7h10a6 6 0 0 1 0 12H6"></path></svg>' }
  }) : null,  React.createElement("button", {
    className: "jarvis-reader-side-button jarvis-reader-side-mode-button",
    title: singlePage ? "\u5207\u6362\u5230\u53cc\u9875" : "\u5207\u6362\u5230\u5355\u9875",
    "aria-label": singlePage ? "\u5207\u6362\u5230\u53cc\u9875" : "\u5207\u6362\u5230\u5355\u9875",
    onClick: () => setSinglePage(!singlePage),
    dangerouslySetInnerHTML: { __html: singlePage ? '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="8" height="14" rx="1"></rect><rect x="13" y="5" width="8" height="14" rx="1"></rect></svg>' : '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="4" width="12" height="16" rx="2"></rect></svg>' }
  }))),  React.createElement(ReactReader, {
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
      syncRenditionTheme(rendition);
      applyHighlights(rendition, highlightList);
      syncAutoWordHighlights(rendition);
      ensureReaderLocations(rendition, updateReaderTitle);
      const jarvisRendition = rendition as typeof rendition & { __awesomeReaderTitleBound?: boolean };
      if (rendition && typeof rendition.on === "function" && !jarvisRendition.__awesomeReaderTitleBound) {
        jarvisRendition.__awesomeReaderTitleBound = true;
        
        // Attach wheel event to iframe document to allow zooming when hovering book text
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
          }
        });

        rendition.on("relocated", (relocated) => {
          updateReaderTitle(relocated);
          syncAutoWordHighlights(rendition);
          refreshHighlightPanes(rendition);
        });
        rendition.on("rendered", () => {
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
  }), pendingHighlightMenu ?  React.createElement("div", {
    className: "jarvis-reader-highlight-menu",
    style: pendingHighlightMenu.rect ? {
      left: pendingHighlightMenu.rect.x,
      top: pendingHighlightMenu.rect.y,
      width: pendingHighlightMenu.rect.width
    } : void 0,
    onClick: (event) => event.stopPropagation()
  },  React.createElement("button", {
    className: "jarvis-reader-highlight-menu-button",
    type: "button",
    onClick: () => copyHighlightQuote(pendingHighlightMenu)
  }, "\u590d\u5236"),  React.createElement("button", {
    className: "jarvis-reader-highlight-menu-button",
    type: "button",
    onClick: () => openWordTranslator(pendingHighlightMenu)
  }, "\u7ffb\u8bd1"), pendingHighlightMenu.id ? null :  React.createElement("button", {
    className: "jarvis-reader-highlight-menu-button",
    type: "button",
    onClick: () => savePlainHighlight(pendingHighlightMenu)
  }, "\u9ad8\u4eae"),  React.createElement("button", {
    className: "jarvis-reader-highlight-menu-button jarvis-reader-highlight-menu-button-primary",
    type: "button",
    onClick: () => openHighlightCommentEditor(pendingHighlightMenu)
  }, "写笔记"), pendingHighlightMenu.id ?  React.createElement("button", {
    className: "jarvis-reader-highlight-menu-button jarvis-reader-highlight-menu-button-danger",
    type: "button",
    onClick: () => deleteExistingHighlight(pendingHighlightMenu)
  }, "\u5220\u9664\u9ad8\u4eae") : null) : null, pendingWordSelection ?  React.createElement("div", {
    className: "jarvis-reader-highlight-popover is-floating jarvis-reader-word-translate",
    style: visibleWordPopoverRect ? {
      left: visibleWordPopoverRect.x,
      top: visibleWordPopoverRect.y,
      width: visibleWordPopoverRect.width,
      height: visibleWordPopoverRect.height
    } : void 0,
    onClick: (event) => event.stopPropagation()
  },  React.createElement("div", {
    className: "jarvis-reader-highlight-title",
    onPointerDown: beginHighlightPopoverMove,
    onDoubleClick: resetHighlightPopoverRect
  }, "\u7ffb\u8bd1"),  React.createElement("div", {
    className: "jarvis-reader-highlight-quote"
  }, pendingWordSelection.quote),  React.createElement("div", {
    className: "jarvis-reader-word-panel"
  }, wordLookupState.status === "loading" ?  React.createElement("div", {
    className: "jarvis-reader-word-muted"
  }, "\u6b63\u5728\u7ffb\u8bd1...") : null, wordLookupState.status === "error" ?  React.createElement("div", {
    className: "jarvis-reader-word-error"
  }, wordLookupState.error || "\u7ffb\u8bd1\u5931\u8d25\u3002") : null, wordLookupState.status === "ready" && wordLookupState.result ?  React.createElement(React.Fragment, null, wordLookupState.result.isWord ?  React.createElement("div", {
    className: "jarvis-reader-word-head"
  },  React.createElement("button", {
    className: "jarvis-reader-word-lemma jarvis-reader-word-lemma-button",
    title: "\u70b9\u51fb\u53d1\u97f3",
    onClick: () => playWordAudioText((wordLookupState.result == null ? void 0 : wordLookupState.result.surface) || (wordLookupState.result == null ? void 0 : wordLookupState.result.lemma) || pendingWordSelection.quote || ""),
    disabled: !enableWordAudio
  }, wordLookupState.result.surface || wordLookupState.result.lemma), wordLookupState.result.phonetic ?  React.createElement("div", {
  }, wordLookupState.result.phonetic) : null) : null, 
  wordLookupState.result.isWord && (wordLookupState.result.tags || wordLookupState.result.collins || wordLookupState.result.oxford) ? React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: "4px", marginTop: "4px", marginBottom: "8px" } },
    wordLookupState.result.oxford === 1 ? React.createElement("span", { className: "jarvis-tag", style: { background: "color-mix(in srgb, var(--color-blue) 20%, transparent)", color: "var(--color-blue)", border: "1px solid color-mix(in srgb, var(--color-blue) 40%, transparent)", fontSize: "0.75em", padding: "1px 6px", borderRadius: "12px" } }, "牛津核心") : null,
    wordLookupState.result.collins && wordLookupState.result.collins > 0 ? React.createElement("span", { className: "jarvis-tag", style: { background: "color-mix(in srgb, var(--color-yellow) 20%, transparent)", color: "var(--color-yellow)", border: "1px solid color-mix(in srgb, var(--color-yellow) 40%, transparent)", fontSize: "0.75em", padding: "1px 6px", borderRadius: "12px" } }, '★'.repeat(wordLookupState.result.collins)) : null,
    wordLookupState.result.tags ? wordLookupState.result.tags.map((tag: string) => React.createElement("span", { key: tag, className: "jarvis-tag", style: { background: "color-mix(in srgb, var(--color-green) 15%, transparent)", color: "var(--color-green)", fontSize: "0.75em", padding: "1px 6px", borderRadius: "12px", border: "1px solid color-mix(in srgb, var(--color-green) 40%, transparent)" } }, tag.toUpperCase())) : null
  ) : null,
  wordLookupState.result.display ? renderWordDisplayContent(wordLookupState.result.display) :  React.createElement("div", {
    className: "jarvis-reader-word-translation"
  }, wordLookupState.result.translation)) : null),  React.createElement("div", {
    className: "jarvis-reader-highlight-actions"
  },  React.createElement("button", {
    className: "jarvis-reader-highlight-button",
    onClick: clearHighlightUi
  }, "\u53d6\u6d88"), savedWordAsset ?  React.createElement("button", {
    className: "jarvis-reader-highlight-button",
    onClick: () => openWordNote(savedWordAsset)
  }, "\u6253\u5f00\u8bcd\u6761") : null, canSwitchPendingWordToAi ?  React.createElement("button", {
    className: "jarvis-reader-highlight-button",
    onClick: translatePendingWordWithAi
  }, "AI\u7ffb\u8bd1") : null, savedWordAsset && savedWordAsset.mastered ?  React.createElement("button", {
    className: "jarvis-reader-highlight-button jarvis-reader-highlight-button-primary",
    onClick: restorePendingWordAsset
  }, "\u91cd\u65b0\u52a0\u5165") : null, canPersistPendingWord && !savedWordAsset ?  React.createElement("button", {
    className: "jarvis-reader-highlight-button jarvis-reader-highlight-button-primary",
    onClick: persistPendingWordAsset
  }, persistPendingLabel) : null,  React.createElement("div", {
    className: "jarvis-reader-highlight-resize-handle",
    onPointerDown: beginHighlightPopoverResize,
    title: "Resize"
  }))) : null, pendingSelection ?  React.createElement("div", {
    className: isWikiSuggestOpen ? "jarvis-reader-highlight-popover is-floating is-suggesting" : "jarvis-reader-highlight-popover is-floating",
    style: visibleHighlightPopoverRect ? {
      left: visibleHighlightPopoverRect.x,
      top: visibleHighlightPopoverRect.y,
      width: visibleHighlightPopoverRect.width,
      height: visibleHighlightPopoverRect.height
    } : void 0
  },  React.createElement("div", {
    className: "jarvis-reader-highlight-title",
    onPointerDown: beginHighlightPopoverMove,
    onDoubleClick: resetHighlightPopoverRect
  }, "写笔记"),  React.createElement("div", {
    className: "jarvis-reader-highlight-quote"
  }, pendingSelection.quote),  React.createElement(WikiLinkCodeMirrorEditor, {
    value: highlightComment,
    onChange: (value) => setHighlightComment(value),
    candidates: currentWikiLinkCandidates,
    onOpenLink: openWikiLink,
    placeholder: "写下你的笔记与思考"
  }),  React.createElement("div", {
    className: "jarvis-reader-highlight-input-shell"
  },  React.createElement("div", {
    className: "jarvis-reader-highlight-input-preview"
  }, renderWikiInputPreview(highlightComment)),  React.createElement("textarea", {
    className: "jarvis-reader-highlight-input",
    ref: highlightInputRef,
    value: highlightComment,
    placeholder: "写下你的笔记与思考",
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
  })), wikiSuggest && wikiSuggest.items && wikiSuggest.items.length ?  React.createElement("div", {
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
  }, item.path)))) : null,  React.createElement("div", {
    className: "jarvis-reader-highlight-actions"
  },  React.createElement("button", {
    className: "jarvis-reader-highlight-button",
    onClick: () => {
      setPendingSelection(null);
      setHighlightComment("");
      setWikiSuggest(null);
      setWikiEditRange(null);
    }
  }, "\u53d6\u6d88"),  React.createElement("button", {
    className: "jarvis-reader-highlight-button jarvis-reader-highlight-button-primary",
    onClick: confirmHighlight
  }, "\u4fdd\u5b58"),  React.createElement("div", {
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
  }, "\u539f\u53e5\u7ffb\u8bd1") :  React.createElement("button", {
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
