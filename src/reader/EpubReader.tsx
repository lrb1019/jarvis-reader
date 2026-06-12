import { useEffect, useMemo, useRef, useState } from "react";
import { ReactReader } from "react-reader";
import type { Rendition } from "epubjs";
import type { BookHighlight, BookProgress, HighlightColor } from "../domain/index.ts";
import { HIGHLIGHT_COLORS } from "../domain/index.ts";
import {
  DEFAULT_HIGHLIGHT_COLOR,
  HIGHLIGHT_COLOR_STYLES,
  normalizeHighlightColor,
} from "../core/highlights.ts";
import { normalizeHighlightQuote } from "../core/text.ts";
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

interface SelectionDraft {
  cfiRange: string;
  quote: string;
  chapterTitle: string;
  comment: string;
  markColor: HighlightColor;
}

interface SelectionContents {
  window?: Window;
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
}

export function JarvisEpubReader(props: JarvisEpubReaderProps) {
  const [location, setLocation] = useState<string | number>(props.initLocation || 0);
  const [progressLabel, setProgressLabel] = useState("");
  const [chapterTitle, setChapterTitle] = useState(props.title);
  const [highlights, setHighlights] = useState(props.highlights);
  const [draft, setDraft] = useState<SelectionDraft | null>(null);
  const [editing, setEditing] = useState<BookHighlight | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [saving, setSaving] = useState(false);
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
    highlightsRef.current = highlights;
    const rendition = renditionRef.current;
    if (rendition) renderCurrentHighlights(rendition);
  }, [highlights]);

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
    },
    [],
  );

  const openEditor = (highlight: BookHighlight): void => {
    setDraft(null);
    setEditing(highlight);
  };

  const renderCurrentHighlights = (rendition: Rendition): void => {
    renderHighlights(
      rendition as unknown as HighlightRenditionLike,
      highlightsRef.current,
      (highlight) => openEditor(highlight),
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
      setEditing(null);
      setDraft({
        cfiRange,
        quote,
        chapterTitle: chapterTitleRef.current,
        comment: "",
        markColor: DEFAULT_HIGHLIGHT_COLOR,
      });
      contents.window?.getSelection()?.removeAllRanges();
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
    if (!draft || saving) return;
    setSaving(true);
    try {
      const created = await props.onCreateHighlight(draft);
      setHighlights((current) => [...current, created]);
      setDraft(null);
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

  const jumpToHighlight = (highlight: BookHighlight): void => {
    renditionRef.current?.display(highlight.cfiRange);
    openEditor(highlight);
  };

  const active = editing
    ? {
        quote: editing.quote,
        comment: editing.comment,
        markColor: normalizeHighlightColor(editing.markColor),
      }
    : draft;

  const updateActive = (changes: Partial<Pick<SelectionDraft, "comment" | "markColor">>): void => {
    if (editing) setEditing({ ...editing, ...changes });
    else if (draft) setDraft({ ...draft, ...changes });
  };

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
        <div style={{ minWidth: 0, flex: 1, position: "relative" }}>
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
          {active ? (
            <div style={editorStyle}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>{editing ? "编辑标注" : "新建标注"}</div>
              <div style={{ maxHeight: 72, overflow: "auto", color: "var(--text-muted)", marginBottom: 8 }}>{active.quote}</div>
              <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                {HIGHLIGHT_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    aria-label={color}
                    onClick={() => updateActive({ markColor: color })}
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: "50%",
                      border: active.markColor === color ? "2px solid var(--text-normal)" : "1px solid var(--background-modifier-border)",
                      background: HIGHLIGHT_COLOR_STYLES[color].fill,
                    }}
                  />
                ))}
              </div>
              <textarea
                value={active.comment}
                placeholder="写下想法（可选）"
                onChange={(event) => updateActive({ comment: event.currentTarget.value })}
                style={{ width: "100%", minHeight: 70, resize: "vertical" }}
              />
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
                {editing ? <button type="button" disabled={saving} onClick={deleteEditing}>删除</button> : null}
                <button type="button" disabled={saving} onClick={() => { setDraft(null); setEditing(null); }}>取消</button>
                <button type="button" disabled={saving} onClick={editing ? saveEditing : saveDraft}>保存</button>
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
