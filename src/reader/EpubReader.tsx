import { useEffect, useMemo, useRef, useState } from "react";
import { ReactReader } from "react-reader";
import type { Rendition } from "epubjs";
import type { BookHighlight, BookProgress, HighlightColor, WordAsset } from "../domain/index.ts";
import { HIGHLIGHT_COLORS } from "../domain/index.ts";
import {
  DEFAULT_HIGHLIGHT_COLOR,
  HIGHLIGHT_COLOR_STYLES,
  normalizeHighlightColor,
} from "../core/highlights.ts";
import { normalizeHighlightQuote } from "../core/text.ts";
import { playWordAudio, stopWordAudio, type WordAudioOptions } from "../core/word-audio.ts";
import {
  findChapterTitle,
  getReaderOptions,
  getReaderProgress,
  type EpubTocItem,
  type ProgressRenditionLike,
  type RelocatedLocation,
} from "./core.ts";
import {
  removeRenderedHighlight,
  renderHighlights,
  type HighlightRenditionLike,
} from "./highlights.ts";
import { applyReaderTheme } from "./theme.ts";
import type { TranslationResult } from "../translation/core.ts";
import {
  removeWordAssetMarks,
  renderWordAssets,
  type WordAssetRenditionLike,
} from "./word-assets.ts";

interface SelectionDraft {
  cfiRange: string;
  quote: string;
  sentence?: string;
  chapterTitle: string;
  comment: string;
  markColor: HighlightColor;
}

interface SelectionContents {
  window?: Window;
}

interface MenuRect {
  x: number;
  y: number;
  width: number;
}

type SelectionItem = SelectionDraft | BookHighlight;

function getSelectionSentence(contents: SelectionContents, selectedText: string): string {
  const selection = contents.window?.getSelection();
  const node = selection?.anchorNode;
  const text = node?.parentElement?.textContent?.replace(/\s+/g, " ").trim() || selectedText;
  const index = text.indexOf(selectedText);
  if (index < 0) return selectedText;
  const left = text.slice(0, index);
  const right = text.slice(index + selectedText.length);
  const leftBoundary = Math.max(...[".", "?", "!", ";", "。", "？", "！"].map((mark) => left.lastIndexOf(mark)));
  const rightBoundaries = [".", "?", "!", ";", "。", "？", "！"]
    .map((mark) => right.indexOf(mark))
    .filter((value) => value >= 0);
  const start = leftBoundary >= 0 ? leftBoundary + 1 : 0;
  const end = rightBoundaries.length
    ? index + selectedText.length + Math.min(...rightBoundaries) + 1
    : text.length;
  return text.slice(start, end).trim().slice(0, 600) || selectedText;
}

export interface JarvisEpubReaderProps {
  contents: ArrayBuffer;
  title: string;
  scrolled: boolean;
  singlePage: boolean;
  readerZoom: number;
  readerLineHeight: number;
  initLocation: string | number | null;
  highlights: BookHighlight[];
  bookPath: string;
  wordAssets: WordAsset[];
  instantTranslation: boolean;
  wordAudio: WordAudioOptions;
  onLocationChange(location: string | number): void;
  onProgress(progress: BookProgress): void;
  onTocChange(toc: EpubTocItem[]): void;
  onModeChange(mode: { scrolled: boolean; singlePage: boolean }): void;
  onZoomChange(value: number): void;
  onLineHeightChange(value: number): void;
  onCreateHighlight(selection: SelectionDraft): Promise<BookHighlight>;
  onUpdateHighlight(
    highlight: BookHighlight,
    changes: { comment: string; markColor: HighlightColor },
  ): Promise<BookHighlight>;
  onDeleteHighlight(highlight: BookHighlight): Promise<void>;
  onTranslate(
    selection: SelectionDraft,
    forceAi: boolean,
    localOnly?: boolean,
  ): Promise<TranslationResult>;
  onSaveWordAsset(selection: SelectionDraft, translation: TranslationResult): Promise<WordAsset>;
  onDeleteWordAsset(asset: WordAsset): Promise<void>;
}

export function JarvisEpubReader(props: JarvisEpubReaderProps) {
  const [location, setLocation] = useState<string | number>(props.initLocation || 0);
  const [progressLabel, setProgressLabel] = useState("");
  const [chapterTitle, setChapterTitle] = useState(props.title);
  const [highlights, setHighlights] = useState(props.highlights);
  const [commentDraft, setCommentDraft] = useState<SelectionDraft | null>(null);
  const [pendingMenu, setPendingMenu] = useState<SelectionItem | null>(null);
  const [menuRect, setMenuRect] = useState<MenuRect | null>(null);
  const [translationSelection, setTranslationSelection] = useState<SelectionDraft | null>(null);
  const [editing, setEditing] = useState<BookHighlight | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [saving, setSaving] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [translation, setTranslation] = useState<TranslationResult | null>(null);
  const [savedAsset, setSavedAsset] = useState<WordAsset | null>(null);
  const [translationError, setTranslationError] = useState("");
  const [wordAssets, setWordAssets] = useState(props.wordAssets);
  const [activeWordAsset, setActiveWordAsset] = useState<WordAsset | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const relocatedHandlerRef = useRef<((relocated: RelocatedLocation) => void) | null>(null);
  const selectedHandlerRef = useRef<((cfiRange: string, contents: SelectionContents) => void) | null>(null);
  const tocRef = useRef<EpubTocItem[]>([]);
  const chapterTitleRef = useRef(chapterTitle);
  const highlightsRef = useRef(highlights);
  const options = useMemo(
    () => getReaderOptions({ scrolled: props.scrolled, singlePage: props.singlePage }),
    [props.scrolled, props.singlePage],
  );

  useEffect(() => {
    setHighlights(props.highlights);
  }, [props.highlights]);

  useEffect(() => {
    setWordAssets(props.wordAssets);
  }, [props.wordAssets]);

  useEffect(() => {
    highlightsRef.current = highlights;
    const rendition = renditionRef.current;
    if (rendition) renderCurrentHighlights(rendition);
  }, [highlights]);

  useEffect(() => {
    const rendition = renditionRef.current;
    if (rendition) renderCurrentWordAssets(rendition);
  }, [wordAssets]);

  useEffect(() => {
    chapterTitleRef.current = chapterTitle;
  }, [chapterTitle]);

  useEffect(() => {
    const rendition = renditionRef.current;
    if (rendition) applyReaderTheme(rendition, props.readerZoom, props.readerLineHeight);
  }, [props.readerZoom, props.readerLineHeight]);

  useEffect(
    () => () => {
      const rendition = renditionRef.current;
      if (rendition && relocatedHandlerRef.current) {
        rendition.off("relocated", relocatedHandlerRef.current as never);
      }
      if (rendition && selectedHandlerRef.current) {
        rendition.off("selected", selectedHandlerRef.current as never);
      }
      renditionRef.current = null;
      stopWordAudio();
    },
    [],
  );

  const clearTransientUi = (): void => {
    setPendingMenu(null);
    setMenuRect(null);
    setCommentDraft(null);
    setEditing(null);
    setTranslationSelection(null);
    setTranslation(null);
    setSavedAsset(null);
    setTranslationError("");
  };

  const getDefaultMenuRect = (): MenuRect => {
    const bounds = containerRef.current?.getBoundingClientRect();
    const width = 280;
    return {
      x: Math.max(14, ((bounds?.width || 800) - width) / 2),
      y: Math.max(18, (bounds?.height || 600) * 0.28),
      width,
    };
  };

  const clampMenuRect = (rect: MenuRect): MenuRect => {
    const bounds = containerRef.current?.getBoundingClientRect();
    if (!bounds) return rect;
    const margin = 14;
    const width = Math.min(320, Math.max(280, rect.width));
    return {
      x: Math.min(Math.max(margin, bounds.width - width - margin), Math.max(margin, rect.x)),
      y: Math.min(Math.max(margin, bounds.height - 62), Math.max(margin, rect.y)),
      width,
    };
  };

  const getSelectionMenuRect = (contents: SelectionContents): MenuRect => {
    try {
      const selection = contents.window?.getSelection();
      const rangeRect = selection?.rangeCount ? selection.getRangeAt(0).getBoundingClientRect() : null;
      const frameRect = contents.window?.frameElement?.getBoundingClientRect();
      const containerRect = containerRef.current?.getBoundingClientRect();
      if (!rangeRect || !containerRect) return getDefaultMenuRect();
      const left = rangeRect.left + (frameRect?.left || 0) - containerRect.left;
      const top = rangeRect.top + (frameRect?.top || 0) - containerRect.top;
      return clampMenuRect({ x: left + rangeRect.width / 2 - 140, y: top - 58, width: 280 });
    } catch {
      return getDefaultMenuRect();
    }
  };

  const getEventMenuRect = (event: MouseEvent): MenuRect => {
    const containerRect = containerRef.current?.getBoundingClientRect();
    const target = event.currentTarget as Element | null;
    const targetRect = target?.getBoundingClientRect();
    if (!containerRect || !targetRect) return getDefaultMenuRect();
    return clampMenuRect({
      x: targetRect.left + targetRect.width / 2 - containerRect.left - 140,
      y: targetRect.top - containerRect.top - 58,
      width: 280,
    });
  };

  const asDraft = (item: SelectionItem): SelectionDraft => ({
    cfiRange: item.cfiRange,
    quote: item.quote,
    sentence: "sentence" in item ? item.sentence : item.quote,
    chapterTitle: item.chapterTitle || chapterTitleRef.current,
    comment: item.comment || "",
    markColor: normalizeHighlightColor(item.markColor),
  });

  const openTranslator = async (item: SelectionItem, localOnly = false): Promise<boolean> => {
    const selection = asDraft(item);
    clearTransientUi();
    setTranslationSelection(selection);
    setTranslating(true);
    try {
      const result = await props.onTranslate(selection, false, localOnly);
      if (!result) {
        setTranslationSelection(null);
        return false;
      }
      setTranslation(result);
      return true;
    } catch (error) {
      if (localOnly) {
        setTranslationSelection(null);
        return false;
      }
      setTranslationError(error instanceof Error ? error.message : String(error));
      return true;
    } finally {
      setTranslating(false);
    }
  };

  const openCommentEditor = (item: SelectionItem): void => {
    setPendingMenu(null);
    setTranslationSelection(null);
    setTranslation(null);
    if ("id" in item) {
      setCommentDraft(null);
      setEditing(item);
    } else {
      setEditing(null);
      setCommentDraft(asDraft(item));
    }
  };

  const openEditor = (highlight: BookHighlight): void => {
    setCommentDraft(null);
    setPendingMenu(null);
    setTranslationSelection(null);
    setEditing(highlight);
    setTranslation(null);
    setSavedAsset(null);
    setTranslationError("");
  };

  const savePlainHighlight = async (item: SelectionItem): Promise<void> => {
    if ("id" in item || saving) return;
    setSaving(true);
    try {
      const created = await props.onCreateHighlight({ ...item, comment: "" });
      setHighlights((current) => [...current, created]);
      setPendingMenu(null);
    } finally {
      setSaving(false);
    }
  };

  const copySelection = async (item: SelectionItem): Promise<void> => {
    await navigator.clipboard.writeText(item.quote);
  };

  const renderCurrentHighlights = (rendition: Rendition): void => {
    renderHighlights(
      rendition as unknown as HighlightRenditionLike,
      highlightsRef.current,
      (highlight, event) => {
        if (highlight.comment) {
          openEditor(highlight);
          return;
        }
        setEditing(null);
        setCommentDraft(null);
        setTranslationSelection(null);
        setPendingMenu(highlight);
        setMenuRect(getEventMenuRect(event));
      },
    );
  };

  const renderCurrentWordAssets = (rendition: Rendition): void => {
    renderWordAssets(
      rendition as unknown as WordAssetRenditionLike,
      wordAssets,
      props.bookPath,
      (asset) => setActiveWordAsset(asset),
    );
  };

  const bindRendition = (rendition: Rendition): void => {
    const previous = renditionRef.current;
    if (previous && relocatedHandlerRef.current) {
      previous.off("relocated", relocatedHandlerRef.current as never);
    }
    if (previous && selectedHandlerRef.current) {
      previous.off("selected", selectedHandlerRef.current as never);
    }
    renditionRef.current = rendition;
    applyReaderTheme(rendition, props.readerZoom, props.readerLineHeight);
    renderCurrentHighlights(rendition);
    renderCurrentWordAssets(rendition);

    const relocated = (next: RelocatedLocation): void => {
      const nextChapter = findChapterTitle(tocRef.current, next.start?.href) || props.title;
      chapterTitleRef.current = nextChapter;
      setChapterTitle(nextChapter);
      const progress = getReaderProgress(
        next,
        rendition as unknown as ProgressRenditionLike,
        nextChapter,
      );
      if (progress) {
        setProgressLabel(progress.label);
        props.onProgress(progress);
      }
    };
    const selected = (cfiRange: string, contents: SelectionContents): void => {
      const quote = normalizeHighlightQuote(contents.window?.getSelection()?.toString());
      if (!quote) return;
      const selection: SelectionDraft = {
        cfiRange,
        quote,
        sentence: getSelectionSentence(contents, quote),
        chapterTitle: chapterTitleRef.current,
        comment: "",
        markColor: DEFAULT_HIGHLIGHT_COLOR,
      };
      clearTransientUi();
      if (props.instantTranslation && /^\s*[A-Za-z]+(?:['-][A-Za-z]+)*\s*$/.test(quote)) {
        void openTranslator(selection, true).then((opened) => {
          if (!opened) {
            setPendingMenu(selection);
            setMenuRect(getSelectionMenuRect(contents));
          }
        });
      } else {
        setPendingMenu(selection);
        setMenuRect(getSelectionMenuRect(contents));
      }
    };
    relocatedHandlerRef.current = relocated;
    selectedHandlerRef.current = selected;
    rendition.on("relocated", relocated as never);
    rendition.on("selected", selected as never);
  };

  const changeLocation = (next: string | number): void => {
    setLocation(next);
    props.onLocationChange(next);
  };

  const changeToc = (toc: EpubTocItem[]): void => {
    tocRef.current = toc;
    props.onTocChange(toc);
  };

  const saveDraft = async (): Promise<void> => {
    if (!commentDraft || saving) return;
    setSaving(true);
    try {
      const created = await props.onCreateHighlight(commentDraft);
      setHighlights((current) => [...current, created]);
      setCommentDraft(null);
    } finally {
      setSaving(false);
    }
  };

  const saveEditing = async (): Promise<void> => {
    if (!editing || saving) return;
    setSaving(true);
    try {
      const updated = await props.onUpdateHighlight(editing, {
        comment: editing.comment,
        markColor: normalizeHighlightColor(editing.markColor),
      });
      if (renditionRef.current) {
        removeRenderedHighlight(
          renditionRef.current as unknown as HighlightRenditionLike,
          editing,
        );
      }
      setHighlights((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      setEditing(null);
    } finally {
      setSaving(false);
    }
  };

  const deleteEditing = async (): Promise<void> => {
    if (!editing || saving) return;
    setSaving(true);
    try {
      await props.onDeleteHighlight(editing);
      if (renditionRef.current) {
        removeRenderedHighlight(
          renditionRef.current as unknown as HighlightRenditionLike,
          editing,
        );
      }
      setHighlights((current) => current.filter((item) => item.id !== editing.id));
      setEditing(null);
    } finally {
      setSaving(false);
    }
  };

  const deleteHighlightItem = async (highlight: BookHighlight): Promise<void> => {
    if (saving) return;
    setSaving(true);
    try {
      await props.onDeleteHighlight(highlight);
      if (renditionRef.current) {
        removeRenderedHighlight(
          renditionRef.current as unknown as HighlightRenditionLike,
          highlight,
        );
      }
      setHighlights((current) => current.filter((item) => item.id !== highlight.id));
      setPendingMenu(null);
    } finally {
      setSaving(false);
    }
  };

  const jumpToHighlight = (highlight: BookHighlight): void => {
    renditionRef.current?.display(highlight.cfiRange);
    openEditor(highlight);
  };

  const runTranslation = async (forceAi = false, localOnly = false): Promise<boolean> => {
    if (!translationSelection || translating) return false;
    setTranslating(true);
    setTranslationError("");
    try {
      const result = await props.onTranslate(translationSelection, forceAi, localOnly);
      if (!result) return false;
      setTranslation(result);
      setSavedAsset(null);
      return true;
    } catch (error) {
      setTranslationError(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      setTranslating(false);
    }
  };

  const saveTranslation = async (): Promise<void> => {
    if (!translationSelection || !translation || saving) return;
    setSaving(true);
    try {
      const asset = await props.onSaveWordAsset(translationSelection, translation);
      setSavedAsset(asset);
      setWordAssets((current) => [...current.filter((item) => item.lemma !== asset.lemma), asset]);
      setActiveWordAsset(asset);
      setTranslationError("");
    } catch (error) {
      setTranslationError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const deleteSavedAsset = async (): Promise<void> => {
    if (!savedAsset || saving) return;
    setSaving(true);
    try {
      await props.onDeleteWordAsset(savedAsset);
      if (renditionRef.current) {
        removeWordAssetMarks(
          renditionRef.current as unknown as WordAssetRenditionLike,
          savedAsset,
          props.bookPath,
        );
      }
      setWordAssets((current) => current.filter((item) => item.lemma !== savedAsset.lemma));
      setSavedAsset(null);
      setActiveWordAsset(null);
      setTranslationError("");
    } catch (error) {
      setTranslationError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const active = editing
    ? {
        quote: editing.quote,
        comment: editing.comment,
        markColor: normalizeHighlightColor(editing.markColor),
      }
    : commentDraft;

  const updateActive = (changes: Partial<Pick<SelectionDraft, "comment" | "markColor">>): void => {
    if (editing) setEditing({ ...editing, ...changes });
    else if (commentDraft) setCommentDraft({ ...commentDraft, ...changes });
  };

  const pronounce = (text: string): void => playWordAudio(text, props.wordAudio);

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={toolbarStyle}>
        <button type="button" onClick={() => props.onModeChange({ singlePage: !props.singlePage, scrolled: false })}>
          {props.singlePage ? "单页" : "双页"}
        </button>
        <button type="button" disabled={!props.singlePage} onClick={() => props.onModeChange({ singlePage: true, scrolled: !props.scrolled })}>
          {props.scrolled ? "滚动" : "分页"}
        </button>
        <button type="button" onClick={() => props.onZoomChange(-0.05)}>字号-</button>
        <button type="button" onClick={() => props.onZoomChange(0.05)}>字号+</button>
        <button type="button" onClick={() => props.onLineHeightChange(-0.05)}>行距-</button>
        <button type="button" onClick={() => props.onLineHeightChange(0.05)}>行距+</button>
        <button type="button" onClick={() => setSidebarOpen((value) => !value)}>标注 {highlights.length}</button>
        <span style={{ marginLeft: "auto", color: "var(--text-muted)" }}>{progressLabel}</span>
      </div>
      <div style={{ minHeight: 0, flex: 1, display: "flex", overflow: "hidden" }}>
        <div ref={containerRef} style={{ minWidth: 0, flex: 1, position: "relative" }}>
          <ReactReader
            title={props.title}
            showToc
            location={location}
            locationChanged={changeLocation}
            tocChanged={changeToc as unknown as (toc: never) => void}
            getRendition={bindRendition}
            swipeable={false}
            url={props.contents}
            epubOptions={options}
          />
          {pendingMenu ? (
            <div
              className="jarvis-reader-highlight-menu"
              style={{ left: menuRect?.x, top: menuRect?.y, width: menuRect?.width }}
            >
              <button className="jarvis-reader-highlight-menu-button" type="button" onClick={() => void copySelection(pendingMenu)}>复制</button>
              <button className="jarvis-reader-highlight-menu-button" type="button" onClick={() => void openTranslator(pendingMenu)}>翻译</button>
              {"id" in pendingMenu ? null : (
                <button className="jarvis-reader-highlight-menu-button" type="button" disabled={saving} onClick={() => void savePlainHighlight(pendingMenu)}>高亮</button>
              )}
              <button className="jarvis-reader-highlight-menu-button jarvis-reader-highlight-menu-button-primary" type="button" onClick={() => openCommentEditor(pendingMenu)}>写想法</button>
              {"id" in pendingMenu ? (
                <button className="jarvis-reader-highlight-menu-button jarvis-reader-highlight-menu-button-danger" type="button" disabled={saving} onClick={() => void deleteHighlightItem(pendingMenu)}>删除高亮</button>
              ) : null}
            </div>
          ) : null}
          {active ? (
            <div style={editorStyle}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>
                写想法
              </div>
              <div style={{ maxHeight: 72, overflow: "auto", color: "var(--text-muted)", marginBottom: 8 }}>{active.quote}</div>
              <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                {HIGHLIGHT_COLORS.map((color) => (
                  <button key={color} type="button" aria-label={color} onClick={() => updateActive({ markColor: color })} style={{ width: 26, height: 26, borderRadius: "50%", border: active.markColor === color ? "2px solid var(--text-normal)" : "1px solid var(--background-modifier-border)", background: HIGHLIGHT_COLOR_STYLES[color].fill }} />
                ))}
              </div>
              <textarea value={active.comment} placeholder="写感想与评价" onChange={(event) => updateActive({ comment: event.currentTarget.value })} style={{ width: "100%", minHeight: 70, resize: "vertical" }} />
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
                {editing ? <button type="button" disabled={saving} onClick={deleteEditing}>删除</button> : null}
                <button type="button" disabled={saving} onClick={() => { setCommentDraft(null); setEditing(null); }}>取消</button>
                <button type="button" disabled={saving} onClick={editing ? saveEditing : saveDraft}>保存</button>
              </div>
            </div>
          ) : null}
          {translationSelection ? (
            <div className="jarvis-reader-highlight-popover is-floating jarvis-reader-word-translate" style={editorStyle}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>翻译</div>
              <div style={{ maxHeight: 72, overflow: "auto", color: "var(--text-muted)", marginBottom: 8 }}>{translationSelection.quote}</div>
              {translating ? <div>正在翻译...</div> : null}
              {translationError ? <div style={{ color: "var(--text-error)", marginTop: 8 }}>{translationError}</div> : null}
              {translation ? (
                <>
                  {translation.isWord ? (
                    <div className="jarvis-reader-word-head">
                      <button className="jarvis-reader-word-lemma jarvis-reader-word-lemma-button" type="button" title="点击发音" disabled={!props.wordAudio.enabled} onClick={() => pronounce(translation.surface || translation.lemma || translationSelection.quote)}>
                        {translation.surface || translation.lemma || translationSelection.quote}
                      </button>
                      {translation.phonetic ? <div className="jarvis-reader-word-phonetic">{translation.phonetic}</div> : null}
                    </div>
                  ) : null}
                  <div style={{ whiteSpace: "pre-wrap", maxHeight: 260, overflow: "auto" }}>{translation.display}</div>
                </>
              ) : null}
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
                <button type="button" onClick={clearTransientUi}>取消</button>
                {translation?.sourceType === "local-dictionary" ? <button type="button" disabled={translating} onClick={() => void runTranslation(true)}>AI 翻译</button> : null}
                {savedAsset ? <button type="button" disabled={saving} onClick={() => void deleteSavedAsset()}>彻底删除</button> : null}
                {translation ? <button type="button" disabled={saving || Boolean(savedAsset)} onClick={() => void saveTranslation()}>{savedAsset ? "已保存" : "保存词卡"}</button> : null}
              </div>
            </div>
          ) : null}
          {activeWordAsset && !active && !translationSelection && !pendingMenu ? (
            <div style={editorStyle}>
              <button className="jarvis-reader-word-lemma jarvis-reader-word-lemma-button" type="button" title="点击发音" disabled={!props.wordAudio.enabled} onClick={() => pronounce(activeWordAsset.title || activeWordAsset.lemma)}>{activeWordAsset.title || activeWordAsset.lemma}</button>
              <div style={{ whiteSpace: "pre-wrap", maxHeight: 260, overflow: "auto" }}>{activeWordAsset.display || activeWordAsset.translation}</div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
                <button type="button" onClick={() => setActiveWordAsset(null)}>关闭</button>
                <button type="button" disabled={saving} onClick={async () => {
                  setSaving(true);
                  try {
                    await props.onDeleteWordAsset(activeWordAsset);
                    if (renditionRef.current) removeWordAssetMarks(renditionRef.current as unknown as WordAssetRenditionLike, activeWordAsset, props.bookPath);
                    setWordAssets((current) => current.filter((item) => item.lemma !== activeWordAsset.lemma));
                    setActiveWordAsset(null);
                  } finally {
                    setSaving(false);
                  }
                }}>彻底删除</button>
              </div>
            </div>
          ) : null}
        </div>
        {sidebarOpen ? (
          <aside style={sidebarStyle}>
            <div style={{ fontWeight: 600, padding: "10px 12px", borderBottom: "1px solid var(--background-modifier-border)" }}>标注</div>
            {highlights.length ? highlights.map((highlight) => (
              <button key={highlight.id} type="button" onClick={() => jumpToHighlight(highlight)} style={highlightItemStyle}>
                <span style={{ width: 7, alignSelf: "stretch", borderRadius: 4, background: HIGHLIGHT_COLOR_STYLES[normalizeHighlightColor(highlight.markColor)].fill }} />
                <span style={{ minWidth: 0, textAlign: "left", whiteSpace: "normal", overflowWrap: "anywhere" }}>
                  <strong style={{ display: "block", marginBottom: 4 }}>{highlight.chapterTitle || props.title}</strong>
                  <span style={{ display: "block", color: "var(--text-muted)" }}>{highlight.quote}</span>
                  {highlight.comment ? <span style={{ display: "block", marginTop: 6 }}>{highlight.comment}</span> : null}
                </span>
              </button>
            )) : <div style={{ padding: 12, color: "var(--text-muted)" }}>暂无标注</div>}
          </aside>
        ) : null}
      </div>
    </div>
  );
}

const toolbarStyle = {
  display: "flex",
  gap: 8,
  alignItems: "center",
  padding: "6px 10px",
  borderBottom: "1px solid var(--background-modifier-border)",
} as const;

const editorStyle = {
  position: "absolute",
  zIndex: 20,
  right: 20,
  bottom: 20,
  width: 360,
  maxWidth: "calc(100% - 40px)",
  padding: 12,
  borderRadius: 10,
  background: "var(--background-primary)",
  border: "1px solid var(--background-modifier-border)",
  boxShadow: "var(--shadow-s)",
} as const;

const sidebarStyle = {
  width: 320,
  minWidth: 260,
  maxWidth: "34%",
  flex: "0 0 320px",
  overflow: "auto",
  borderLeft: "1px solid var(--background-modifier-border)",
  background: "var(--background-secondary)",
} as const;

const highlightItemStyle = {
  width: "100%",
  height: "auto",
  minHeight: 0,
  display: "flex",
  alignItems: "flex-start",
  gap: 9,
  padding: 10,
  border: 0,
  borderBottom: "1px solid var(--background-modifier-border)",
  borderRadius: 0,
  background: "transparent",
  whiteSpace: "normal",
  lineHeight: 1.45,
  overflow: "visible",
} as const;
