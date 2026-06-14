import { FileView, Menu, TFile, type WorkspaceLeaf } from "obsidian";
import { useEffect, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ReactReader } from "react-reader";
import type { Rendition } from "epubjs";
import type JarvisReaderPlugin from "../main.ts";
import { findChapterTitle, getReaderProgress, type EpubTocItem as ReaderTocItem, type RelocatedLocation } from "../reader/core.ts";
import { clampReaderLineHeight, clampReaderZoom } from "../reader/core.ts";
import { applyReaderTheme, getReaderThemeKey, getReaderThemeSnapshot } from "../reader/theme.ts";
import { createBookHighlight, DEFAULT_HIGHLIGHT_COLOR, deleteHighlightNoteBlock, formatHighlightNoteBlock, updateBookHighlight, upsertHighlightNoteBlock } from "../core/highlights.ts";
import { normalizeHighlightQuote } from "../core/text.ts";
import type { BookHighlight } from "../domain/highlights.ts";
import { renderHighlight, renderHighlights, type HighlightRenditionLike } from "../reader/highlights.ts";
import { getEpubTocMarkdown, openOrCreateBookNote } from "./utils.ts";
import { getBookNotePath } from "../core/book-notes.ts";

export const EPUB_VIEW_TYPE = "epub";

interface EpubTocItem {
  label: string;
  subitems?: EpubTocItem[];
}

interface UpstreamEpubReaderProps {
  contents: ArrayBuffer;
  title: string;
  scrolled: boolean;
  tocOffset: number;
  initLocation: string | number | null;
  saveLocation(location: string | number): void;
  saveToc(toc: EpubTocItem[]): void;
  readerZoom: number;
  readerLineHeight: number;
  highlights: BookHighlight[];
  saveProgress(progress: import("../domain/reading.ts").BookProgress): void;
  singlePage: boolean;
  createBookNote(): void;
  changeZoom(value: number): void;
  changeLineHeight(value: number): void;
  createHighlight(selection: { cfiRange: string; quote: string; chapterTitle: string }): Promise<BookHighlight>;
  saveThought(selection: { cfiRange: string; quote: string; chapterTitle: string }, comment: string): Promise<BookHighlight>;
  updateThought(highlight: BookHighlight, comment: string): Promise<BookHighlight>;
  deleteThought(highlight: BookHighlight): Promise<void>;
  changeMode(mode: { singlePage: boolean; scrolled: boolean }): void;
}

function UpstreamEpubReader(props: UpstreamEpubReaderProps) {
  const [location, setLocation] = useState<string | number | null>(props.initLocation);
  const [readerTitle, setReaderTitle] = useState(props.title);
  const [progressLabel, setProgressLabel] = useState("");
  const [theme, setTheme] = useState(getReaderThemeSnapshot);
  const [readerZoom, setReaderZoom] = useState(clampReaderZoom(props.readerZoom));
  const [readerLineHeight, setReaderLineHeight] = useState(clampReaderLineHeight(props.readerLineHeight));
  const [highlights, setHighlights] = useState(props.highlights);
  const [pendingSelection, setPendingSelection] = useState<{ cfiRange: string; quote: string; chapterTitle: string } | null>(null);
  const [menuPosition, setMenuPosition] = useState<{ left: number; top: number } | null>(null);
  const [savingHighlight, setSavingHighlight] = useState(false);
  const [thoughtDraft, setThoughtDraft] = useState<{ selection: { cfiRange: string; quote: string; chapterTitle: string }; comment: string; existing?: BookHighlight } | null>(null);
  const [thoughtRect, setThoughtRect] = useState({ left: 0, top: 0, width: 420, height: 300 });
  const renditionRef = useRef<Rendition | null>(null);
  const readerRootRef = useRef<HTMLDivElement | null>(null);
  const selectedHandlerRef = useRef<((cfiRange: string, contents: { window?: Window }) => void) | null>(null);
  const tocRef = useRef<EpubTocItem[]>([]);
  const { background, text, muted, fontFamily } = theme;
  useEffect(() => {
    let previousKey = "";
    const syncTheme = (): void => {
      const rendition = renditionRef.current;
      if (!rendition) return;
      const nextKey = getReaderThemeKey(readerZoom, readerLineHeight);
      if (nextKey === previousKey) return;
      previousKey = nextKey;
      setTheme(getReaderThemeSnapshot());
      applyReaderTheme(rendition, readerZoom, readerLineHeight);
    };
    syncTheme();
    const observer = new MutationObserver(syncTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });
    return () => observer.disconnect();
  }, [readerZoom, readerLineHeight]);
  useEffect(() => () => {
    const rendition = renditionRef.current;
    if (rendition && selectedHandlerRef.current) rendition.off("selected", selectedHandlerRef.current as never);
  }, []);
  const updateZoom = (delta: number): void => {
    const next = clampReaderZoom(readerZoom + delta);
    setReaderZoom(next);
    props.changeZoom(next);
    if (renditionRef.current) applyReaderTheme(renditionRef.current, next, readerLineHeight);
  };
  const updateLineHeight = (delta: number): void => {
    const next = clampReaderLineHeight(readerLineHeight + delta);
    setReaderLineHeight(next);
    props.changeLineHeight(next);
    if (renditionRef.current) applyReaderTheme(renditionRef.current, readerZoom, next);
  };
  const turnPageFromReadingArea = (event: React.MouseEvent<HTMLDivElement>): void => {
    if (props.scrolled || !renditionRef.current) return;
    if (event.button !== 0 || event.defaultPrevented) return;
    const target = event.target;
    if (target instanceof Element && target.closest("button, a, input, textarea, select, .jarvis-reader-side-hover-zone")) return;
    const selection = window.getSelection()?.toString().trim();
    if (selection) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const relativeX = event.clientX - rect.left;
    if (relativeX <= rect.width * 0.22) void renditionRef.current.prev();
    else if (relativeX >= rect.width * 0.78) void renditionRef.current.next();
  };
  const savePlainHighlight = async (): Promise<void> => {
    if (!pendingSelection || savingHighlight) return;
    setSavingHighlight(true);
    try {
      const created = await props.createHighlight(pendingSelection);
      setHighlights((current) => [...current, created]);
      if (renditionRef.current) {
        renderHighlight(renditionRef.current as unknown as HighlightRenditionLike, created, () => undefined);
      }
      setPendingSelection(null);
      setMenuPosition(null);
    } finally {
      setSavingHighlight(false);
    }
  };
  const openThoughtEditor = (): void => {
    if (!pendingSelection) return;
    const root = readerRootRef.current?.getBoundingClientRect();
    setThoughtRect({ left: Math.max(16, (root?.width || 900) - 456), top: Math.max(16, (root?.height || 650) - 336), width: 420, height: 300 });
    setThoughtDraft({ selection: pendingSelection, comment: "" });
    setPendingSelection(null);
    setMenuPosition(null);
  };
  const saveThought = async (): Promise<void> => {
    if (!thoughtDraft || savingHighlight) return;
    setSavingHighlight(true);
    try {
      const saved = thoughtDraft.existing
        ? await props.updateThought(thoughtDraft.existing, thoughtDraft.comment)
        : await props.saveThought(thoughtDraft.selection, thoughtDraft.comment);
      setHighlights((current) => thoughtDraft.existing
        ? current.map((item) => item.id === saved.id ? saved : item)
        : [...current, saved]);
      if (renditionRef.current) renderHighlight(renditionRef.current as unknown as HighlightRenditionLike, saved, () => undefined);
      setThoughtDraft(null);
    } finally {
      setSavingHighlight(false);
    }
  };
  const beginThoughtMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return;
    const start = thoughtRect;
    const startX = event.clientX;
    const startY = event.clientY;
    const move = (next: PointerEvent): void => setThoughtRect((current) => ({ ...current, left: start.left + next.clientX - startX, top: start.top + next.clientY - startY }));
    const stop = (): void => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", stop); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  };
  const beginThoughtResize = (event: React.PointerEvent<HTMLDivElement>): void => {
    event.stopPropagation();
    const start = thoughtRect;
    const startX = event.clientX;
    const startY = event.clientY;
    const move = (next: PointerEvent): void => setThoughtRect((current) => ({ ...current, width: Math.max(360, start.width + next.clientX - startX), height: Math.max(220, start.height + next.clientY - startY) }));
    const stop = (): void => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", stop); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  };
  return (
    <div ref={readerRootRef} className="jarvis-reader-epub" onClick={turnPageFromReadingArea} style={{ border: "none", height: "100%", width: "100%", overflow: "hidden", background }}>
      <div className="jarvis-reader-side-hover-zone">
        <div className="jarvis-reader-side-controls">
          <button className="jarvis-reader-side-button" type="button" title="打开或创建书籍笔记" aria-label="打开或创建书籍笔记" onClick={props.createBookNote}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z" /><path d="M14 2v5h5" /><path d="M9 15h6" /><path d="M9 18h4" /></svg>
          </button>
          <button className="jarvis-reader-side-button" type="button" title="放大" aria-label="放大" onClick={() => updateZoom(0.05)}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14" /><path d="M5 12h14" /></svg>
          </button>
          <button className="jarvis-reader-side-button" type="button" title="缩小" aria-label="缩小" onClick={() => updateZoom(-0.05)}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14" /></svg>
          </button>
          <button className="jarvis-reader-side-button" type="button" title="减小行距" aria-label="减小行距" onClick={() => updateLineHeight(-0.05)}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6h8" /><path d="M8 12h8" /><path d="M8 18h8" /><path d="M4 9l2-2 2 2" /><path d="M4 15l2 2 2-2" /></svg>
          </button>
          <button className="jarvis-reader-side-button" type="button" title="增大行距" aria-label="增大行距" onClick={() => updateLineHeight(0.05)}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6h8" /><path d="M8 12h8" /><path d="M8 18h8" /><path d="M4 6l2-2 2 2" /><path d="M4 18l2 2 2-2" /></svg>
          </button>
          {props.singlePage ? (
            <button className="jarvis-reader-side-button jarvis-reader-side-mode-button" type="button" title={props.scrolled ? "切换到分页" : "切换到滚动"} aria-label={props.scrolled ? "切换到分页" : "切换到滚动"} onClick={() => props.changeMode({ singlePage: true, scrolled: !props.scrolled })}>
              {props.scrolled ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5z" /></svg> : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3 4 7l4 4" /><path d="M4 7h10a6 6 0 0 1 0 12H6" /></svg>}
            </button>
          ) : null}
          <button className="jarvis-reader-side-button jarvis-reader-side-mode-button" type="button" title={props.singlePage ? "切换到双页" : "切换到单页"} aria-label={props.singlePage ? "切换到双页" : "切换到单页"} onClick={() => props.changeMode({ singlePage: !props.singlePage, scrolled: false })}>
            {props.singlePage ? <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="8" height="14" rx="1" /><rect x="13" y="5" width="8" height="14" rx="1" /></svg> : <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="4" width="12" height="16" rx="2" /></svg>}
          </button>
        </div>
      </div>
      <ReactReader
        title={readerTitle}
        showToc
        location={location ?? undefined}
        locationChanged={(nextLocation: string | number) => {
          setLocation(nextLocation);
          props.saveLocation(nextLocation);
        }}
        swipeable={false}
        url={props.contents}
        tocChanged={(toc) => {
          const items = toc as unknown as EpubTocItem[];
          tocRef.current = items;
          props.saveToc(items);
        }}
        getRendition={(rendition) => {
          const previous = renditionRef.current;
          if (previous && selectedHandlerRef.current) previous.off("selected", selectedHandlerRef.current as never);
          renditionRef.current = rendition;
          applyReaderTheme(rendition, readerZoom, readerLineHeight);
          renderHighlights(rendition as unknown as HighlightRenditionLike, highlights, (highlight) => {
            if (!highlight.comment) return;
            const root = readerRootRef.current?.getBoundingClientRect();
            setThoughtRect({ left: Math.max(16, (root?.width || 900) - 456), top: Math.max(16, (root?.height || 650) - 336), width: 420, height: 300 });
            setThoughtDraft({ selection: { cfiRange: highlight.cfiRange, quote: highlight.quote, chapterTitle: highlight.chapterTitle }, comment: highlight.comment, existing: highlight });
          });
          const selected = (cfiRange: string, contents: { window?: Window }): void => {
            const quote = normalizeHighlightQuote(contents.window?.getSelection()?.toString());
            if (!quote) return;
            const rangeRect = contents.window?.getSelection()?.rangeCount
              ? contents.window.getSelection()?.getRangeAt(0).getBoundingClientRect()
              : null;
            const frameRect = contents.window?.frameElement?.getBoundingClientRect();
            const rootRect = readerRootRef.current?.getBoundingClientRect();
            const left = rangeRect && rootRect ? rangeRect.left + (frameRect?.left || 0) - rootRect.left + rangeRect.width / 2 : (rootRect?.width || 800) / 2;
            const top = rangeRect && rootRect ? rangeRect.top + (frameRect?.top || 0) - rootRect.top - 54 : 120;
            setPendingSelection({ cfiRange, quote, chapterTitle: readerTitle || props.title });
            setMenuPosition({ left: Math.max(16, Math.min((rootRect?.width || 800) - 300, left - 140)), top: Math.max(16, top) });
          };
          selectedHandlerRef.current = selected;
          rendition.on("selected", selected as never);
          rendition.on("relocated", ((relocated: RelocatedLocation) => {
            const chapterTitle = findChapterTitle(tocRef.current as ReaderTocItem[], relocated.start?.href) || props.title;
            const progress = getReaderProgress(relocated, rendition as unknown as import("../reader/core.ts").ProgressRenditionLike, chapterTitle);
            setReaderTitle(chapterTitle);
            setProgressLabel(progress?.label || "");
            if (progress) props.saveProgress(progress);
          }) as never);
        }}
        epubOptions={props.scrolled
          ? { flow: "scrolled-doc", manager: "continuous", spread: "none" }
          : props.singlePage ? { spread: "none" } : undefined}
        styles={{
          container: { overflow: "hidden", height: "100%", backgroundColor: background },
          readerArea: { position: "relative", zIndex: 1, height: "100%", width: "100%", backgroundColor: background, color: text, fontFamily },
          containerExpanded: { transform: "translateX(256px)" },
          titleArea: { position: "absolute", top: "20px", left: "50px", right: "50px", textAlign: "center", color: muted, fontFamily },
          reader: { position: "absolute", top: "50px", bottom: "72px", left: "50%", right: "auto", transform: "translateX(-50%)", width: "min(calc(100% - 96px), 1120px)" },
          swipeWrapper: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: background },
          prev: { position: "absolute", top: "auto", bottom: "20px", left: "calc(50% - 36px)", right: "auto", zIndex: 1, cursor: "pointer", userSelect: "none" },
          next: { position: "absolute", top: "auto", bottom: "20px", left: "calc(50% + 8px)", right: "auto", zIndex: 1, cursor: "pointer", userSelect: "none" },
          arrow: { display: "flex", alignItems: "center", justifyContent: "center", width: "36px", height: "36px", color: muted, fontSize: "28px", lineHeight: 1, opacity: 0.72 },
          arrowHover: { color: text },
          tocBackground: { position: "absolute", left: 0, top: 0, bottom: 0, right: 0, zIndex: 1 },
          tocArea: { position: "absolute", left: "auto", top: `${props.tocOffset + 20}px`, bottom: 0, width: "256px", overflowY: "auto", WebkitOverflowScrolling: "touch", backgroundColor: background, padding: "10px 9px 14px" },
          tocAreaButton: { appearance: "none", background: background, border: "1px solid var(--background-modifier-border)", borderRadius: "9px", color: muted, display: "block", fontFamily, fontSize: "0.78em", lineHeight: 1.36, margin: "3px 0", padding: "6px 9px", textAlign: "left", width: "100%", whiteSpace: "normal" },
          tocButton: { position: "absolute", top: "18px", left: "18px", border: "1px solid var(--background-modifier-border)", borderRadius: "10px", width: "34px", height: "34px", background: background, zIndex: 2 },
          tocButtonExpanded: { position: "absolute", top: "10px", left: "10px", width: "32px", height: "32px", backgroundColor: "transparent" },
          tocButtonBar: { position: "absolute", width: "54%", height: "2px", left: "50%", margin: "-1px -27%", background: muted, transition: "all .5s ease" },
          tocButtonBarTop: { top: "35%" },
          tocButtonBarBottom: { top: "66%" },
          loadingView: { position: "absolute", top: "50%", left: "10%", right: "10%", color: muted, textAlign: "center", marginTop: "-0.5em" },
        }}
      />
      {pendingSelection && menuPosition ? (
        <div className="jarvis-reader-highlight-menu" style={{ left: menuPosition.left, top: menuPosition.top, width: 280 }}>
          <button className="jarvis-reader-highlight-menu-button" type="button" onClick={() => void navigator.clipboard.writeText(pendingSelection.quote)}>复制</button>
          <button className="jarvis-reader-highlight-menu-button" type="button" disabled>翻译</button>
          <button className="jarvis-reader-highlight-menu-button" type="button" disabled={savingHighlight} onClick={() => void savePlainHighlight()}>高亮</button>
          <button className="jarvis-reader-highlight-menu-button jarvis-reader-highlight-menu-button-primary" type="button" onClick={openThoughtEditor}>写想法</button>
        </div>
      ) : null}
      {thoughtDraft ? (
        <div className="jarvis-reader-highlight-popover is-floating" style={{ left: thoughtRect.left, top: thoughtRect.top, width: thoughtRect.width, height: thoughtRect.height }} onClick={(event) => event.stopPropagation()}>
          <div className="jarvis-reader-highlight-title" onPointerDown={beginThoughtMove}>写想法</div>
          <div className="jarvis-reader-highlight-quote">{thoughtDraft.selection.quote}</div>
          <textarea className="jarvis-reader-highlight-input" value={thoughtDraft.comment} placeholder="写感想与评价；支持 [[双链]]" onChange={(event) => setThoughtDraft({ ...thoughtDraft, comment: event.currentTarget.value })} />
          <div className="jarvis-reader-highlight-actions">
            {thoughtDraft.existing ? <button className="jarvis-reader-highlight-button" type="button" disabled={savingHighlight} onClick={() => void props.deleteThought(thoughtDraft.existing!).then(() => { setHighlights((current) => current.filter((item) => item.id !== thoughtDraft.existing!.id)); setThoughtDraft(null); })}>删除</button> : null}
            <button className="jarvis-reader-highlight-button" type="button" onClick={() => setThoughtDraft(null)}>取消</button>
            <button className="jarvis-reader-highlight-button jarvis-reader-highlight-button-primary" type="button" disabled={savingHighlight || !thoughtDraft.comment.trim()} onClick={() => void saveThought()}>保存</button>
          </div>
          <div className="jarvis-reader-highlight-resize-handle" onPointerDown={beginThoughtResize} />
        </div>
      ) : null}
      {progressLabel ? <div style={{ position: "absolute", right: 24, bottom: 24, zIndex: 4, color: muted, fontFamily, fontSize: 13 }}>{progressLabel}</div> : null}
    </div>
  );
}

export class UpstreamEpubView extends FileView {
  private root: Root | null = null;
  private fileToc: EpubTocItem[] = [];

  constructor(leaf: WorkspaceLeaf, private readonly plugin: JarvisReaderPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return EPUB_VIEW_TYPE;
  }

  canAcceptExtension(extension: string): boolean {
    return extension.toLowerCase() === "epub";
  }

  onPaneMenu(menu: Menu): void {
    menu.addItem((item) => {
      item
        .setTitle("打开或创建书籍笔记")
        .setIcon("file-text")
        .onClick(async () => {
          if (!this.file) return;
          await openOrCreateBookNote(this.app, this.file, getEpubTocMarkdown(this.fileToc), this.plugin.settings);
        });
    });
  }

  async onLoadFile(file: TFile): Promise<void> {
    this.root?.unmount();
    this.contentEl.empty();
    const viewHeader = this.containerEl.parentElement?.querySelector<HTMLElement>(".view-header");
    const headerStyle = viewHeader ? getComputedStyle(viewHeader) : null;
    const width = headerStyle ? Number.parseFloat(headerStyle.width) : 0;
    const height = headerStyle ? Number.parseFloat(headerStyle.height) : 0;
    const tocOffset = height < width ? height : 0;
    const contents = await this.app.vault.readBinary(file);

    this.root = createRoot(this.contentEl);
    this.root.render(
      <UpstreamEpubReader
        contents={contents}
        title={file.basename}
        scrolled={this.plugin.settings.scrolledView}
        tocOffset={tocOffset}
        initLocation={this.plugin.settings.bookInitLocations[file.path] ?? null}
        saveLocation={(location) => {
          this.plugin.settings.bookInitLocations[file.path] = location;
          void this.plugin.saveSettings();
        }}
        saveToc={(toc) => {
          this.fileToc = toc;
        }}
        readerZoom={this.plugin.settings.readerZoom}
        readerLineHeight={this.plugin.settings.readerLineHeight}
        highlights={this.plugin.settings.bookHighlights[file.path] || []}
        singlePage={this.plugin.settings.singlePageView}
        createBookNote={() => {
          void openOrCreateBookNote(this.app, file, getEpubTocMarkdown(this.fileToc), this.plugin.settings);
        }}
        changeZoom={(value) => {
          this.plugin.settings.readerZoom = value;
          void this.plugin.saveSettings();
        }}
        changeLineHeight={(value) => {
          this.plugin.settings.readerLineHeight = value;
          void this.plugin.saveSettings();
        }}
        createHighlight={async (selection) => {
          const highlight = createBookHighlight({
            ...selection,
            bookPath: file.path,
            bookTitle: file.basename,
            comment: "",
            markColor: DEFAULT_HIGHLIGHT_COLOR,
          });
          this.plugin.settings.bookHighlights[file.path] = [
            ...(this.plugin.settings.bookHighlights[file.path] || []),
            highlight,
          ];
          await this.plugin.saveSettings();
          return highlight;
        }}
        saveThought={async (selection, comment) => {
          const notePath = getBookNotePath({ basename: file.basename, extension: file.extension, parentPath: file.parent?.path }, this.plugin.settings);
          const highlight = createBookHighlight({ ...selection, bookPath: file.path, bookTitle: file.basename, comment, markColor: DEFAULT_HIGHLIGHT_COLOR, notePath });
          const note = this.app.vault.getAbstractFileByPath(notePath);
          if (note instanceof TFile) await this.app.vault.modify(note, upsertHighlightNoteBlock(await this.app.vault.read(note), highlight));
          else await this.app.vault.create(notePath, `${formatHighlightNoteBlock(highlight)}\n`);
          this.plugin.settings.bookHighlights[file.path] = [...(this.plugin.settings.bookHighlights[file.path] || []), highlight];
          await this.plugin.saveSettings();
          return highlight;
        }}
        updateThought={async (highlight, comment) => {
          const updated = updateBookHighlight(highlight, { comment, markColor: highlight.markColor });
          const note = this.app.vault.getAbstractFileByPath(updated.notePath);
          if (note instanceof TFile) await this.app.vault.modify(note, upsertHighlightNoteBlock(await this.app.vault.read(note), updated));
          this.plugin.settings.bookHighlights[file.path] = (this.plugin.settings.bookHighlights[file.path] || []).map((item) => item.id === updated.id ? updated : item);
          await this.plugin.saveSettings();
          return updated;
        }}
        deleteThought={async (highlight) => {
          const note = this.app.vault.getAbstractFileByPath(highlight.notePath);
          if (note instanceof TFile) await this.app.vault.modify(note, deleteHighlightNoteBlock(await this.app.vault.read(note), highlight.blockId));
          this.plugin.settings.bookHighlights[file.path] = (this.plugin.settings.bookHighlights[file.path] || []).filter((item) => item.id !== highlight.id);
          await this.plugin.saveSettings();
        }}
        changeMode={(mode) => {
          this.plugin.settings.singlePageView = mode.singlePage;
          this.plugin.settings.scrolledView = mode.singlePage ? mode.scrolled : false;
          void this.plugin.saveSettings().then(() => this.onLoadFile(file));
        }}
        saveProgress={(progress) => {
          this.plugin.settings.bookProgress[file.path] = progress;
          void this.plugin.saveSettings();
        }}
      />,
    );
  }

  onunload(): void {
    this.root?.unmount();
    this.root = null;
  }
}
