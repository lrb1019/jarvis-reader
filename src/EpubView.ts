import { refreshHighlightPanes } from "./epub-annotations-adapter";
// Extracted from main.js L51297-51821 — EpubView (Obsidian FileView for epub files)

import React from "react";
import { clampReaderLetterSpacing, clampReaderWordSpacing, normalizeReaderParagraphIndent, clampReaderWidth, resolveReaderPreferences, type ReaderPreferences } from "./reader-settings";
import { createRoot, type Root } from "react-dom/client";
import { FileView, WorkspaceLeaf, TFile, Notice } from "obsidian";
import { normalizeHighlightQuote } from "./utils";
import { openOrCreateNote, getOrCreateBookNote } from "./book-notes";
import { getEpubTocMd, createHighlightId, getHighlightsForBook, buildHighlightNoteUpdate } from "./highlights";
import { getTranslationAssetKey, getTranslationAssetStorageKey, buildWordAssetFromSelection, getLightWordAsset } from "./word-assets";
import { translateSelectionWithApi } from "./translation";
import { clampReaderZoom, clampReaderLineHeight, getJarvisReaderTheme, applyObsidianThemeToRendition } from "./theme";
import { getReaderProgress } from "./progress";
import { getMarkdownLinkCandidates } from "./wiki-editor";
import { EpubReader } from "./EpubReader";
import type { JarvisReaderSettings, BookHighlight } from "./types";
import { ReadingStatsService } from "./reading-stats-service";
import { buildKnowledgeNoteBody } from "./knowledge-note";
import { HighlightContentConflictError, type HighlightCommentEntry, type HighlightNoteDetails } from "./book-note-document";
import { openFileInActiveTab } from "./workspace-navigation";
import { displayReadingSource } from "./reader-navigation";
import { buildReadingSourceLink } from "./reading-source-link";

function getWordAssetsMap(settings: any): Record<string, any> {
  return settings.wordAssets && typeof settings.wordAssets === "object" ? settings.wordAssets : {};
}



export class EpubView extends FileView {
  settings: any;
  plugin: any;
  fileToc: any = null;
  selectedHighlightId: string | null = null;
  currentRendition: any = null;
  themeSyncInterval: any = null;
  themeSyncViewportHandler: any = null;
  highlightEditor: any = null;
  highlightDeleted: any = null;
  lastInteractionTime: number = Date.now();
  statsSaveTimer: any = null;
  statsBookFile: TFile | null = null;
  readingStatsService = new ReadingStatsService();
  interactionCleanup: (() => void) | null = null;
  reactRoot: Root | null = null;
  renditionReadyResolvers: Array<(rendition: any) => void> = [];
  renditionFilePath = "";
  sourceJumpPending = false;
  sourceJumpSequence = 0;
  private readerLoadSequence = 0;
  private readerUnloaded = false;

  constructor(leaf: WorkspaceLeaf, settings: any, plugin: any) {
    super(leaf);
    this.settings = settings;
    this.plugin = plugin;
  }

  setHeaderMenuVisibility(hidden: boolean): void {
    const header = this.containerEl.parentElement?.querySelector("div.view-header");
    const menuButton = header?.querySelector('[aria-label="More options"], [aria-label="More"], .view-action[aria-label*="More"], .clickable-icon[aria-label*="More"]');
    if (menuButton instanceof HTMLElement) {
      menuButton.style.display = hidden ? "none" : "";
    }
  }

  async createBookNote(): Promise<void> {
    await openOrCreateNote(this.app, this.file!, getEpubTocMd(this.fileToc), this.plugin.settings);
  }

  getWordAssets(): Record<string, any> {
    return getWordAssetsMap(this.plugin.settings);
  }

  async translateSelection(text: string, sentence: string = "", options: any = {}): Promise<any> {
    return await translateSelectionWithApi(this.plugin.settings, text, sentence, this.app, options);
  }

  async saveWordAsset(selection: any, translation: any): Promise<any> {
    const assetMap = getWordAssetsMap(this.plugin.settings);
    const assetKey = getTranslationAssetKey(selection, translation);
    if (!assetKey) {
      new Notice("只能保存英文单词或短语。");
      return null;
    }
    const existing = assetMap[assetKey];
    const asset = buildWordAssetFromSelection(this.file!, selection, translation, existing, this.plugin.settings);
    if (!asset) {
      new Notice("Failed to build word asset.");
      return null;
    }
    
    // FILELESS: Note generation is fully removed
    await this.plugin.wordAssetService.save(getLightWordAsset(asset));
    new Notice("已保存到全局字典");
    return asset;
  }

  async deleteWordAsset(asset: any): Promise<boolean> {
    const assetKey = getTranslationAssetStorageKey(asset);
    if (!assetKey)
      return false;
    await this.plugin.wordAssetService.delete(assetKey);
    new Notice("词条已彻底删除。");
    return true;
  }

  async loadWordDisplay(asset: any): Promise<string> {
    return asset?.display || "";
  }

  shouldAutoHighlightWords(): boolean {
    return this.plugin.settings.enableAutoHighlight !== false;
  }

  getBookHighlights(): BookHighlight[] {
    return getHighlightsForBook(this.plugin.settings, this.file!.path);
  }

  async promoteHighlight(highlight: BookHighlight): Promise<void> {
    if (!highlight.notePath) return;
    try {
      const noteFile = this.app.vault.getAbstractFileByPath(highlight.notePath);
      if (!(noteFile instanceof TFile)) {
        new Notice("找不到这条划线对应的书籍笔记。");
        return;
      }
      const details = await this.plugin.bookNoteService.readHighlightDetails(noteFile, highlight);
      const entries = (details.commentEntries as HighlightCommentEntry[]).filter((entry) => entry.text.trim());
      if (!entries.length) return;
      const file = await this.plugin.knowledgeNoteService.create({
        folder: this.plugin.settings.knowledgeNoteFolder || "",
        title: "读书笔记",
        body: buildKnowledgeNoteBody(details.quote || highlight.quote || "", entries),
        sourceNotePath: highlight.notePath,
        sourceBlockId: highlight.blockId || highlight.id,
        sourceBookTitle: highlight.bookTitle,
        sourceLocationLink: buildReadingSourceLink(highlight),
        createdAt: new Date().toISOString().slice(0, 10),
      });
      await openFileInActiveTab(this.app.workspace, file);
      new Notice("已打开知识笔记。");
    } catch (error) {
      console.error("Jarvis Reader knowledge note creation failed.", error);
      new Notice(`创建知识笔记失败：${error instanceof Error ? error.message : "未知错误"}`);
    }
  }

  async runHighlightTransaction(
    notePath: string,
    previousHighlights: BookHighlight[],
    nextHighlights: BookHighlight[],
    reason: string,
    applyMarkdown: () => Promise<void>,
  ): Promise<boolean> {
    try {
      await this.plugin.highlightTransactionService.execute({
        bookPath: this.file!.path,
        notePath,
        previousHighlights,
        nextHighlights,
        reason,
        applyMarkdown,
      });
      return true;
    } catch (error) {
      console.error("Jarvis Reader highlight transaction failed.", error);
      if (error instanceof HighlightContentConflictError) {
        new Notice(error.message, 0);
      } else {
        new Notice(`高亮操作失败，系统已尝试恢复操作前状态：${error instanceof Error ? error.message : "未知错误"}`, 0);
      }
      return false;
    }
  }

  async getBookHighlightsForReader(): Promise<BookHighlight[]> {
    const list = this.getBookHighlights();
    const enriched: BookHighlight[] = [];
    for (const highlight of list) {
      if (!highlight || !highlight.notePath || !highlight.blockId) {
        enriched.push(highlight);
        continue;
      }
      const noteFile = this.app.vault.getAbstractFileByPath(highlight.notePath);
      if (!(noteFile instanceof TFile)) {
        enriched.push(highlight);
        continue;
      }
      try {
        const details = await this.plugin.bookNoteService.readHighlightDetails(noteFile, highlight);
        enriched.push({
          ...highlight,
          quote: details.quote || highlight.quote,
          comment: details.comment,
          commentEntries: details.commentEntries,
          aiSections: details.aiSections,
        } as any);
      } catch (error) {
        console.warn("Jarvis Reader read highlight comments failed.", error);
        enriched.push(highlight);
      }
    }
    return enriched;
  }
  renderHighlightsPane(): void {
    this.plugin.refreshReaderSidebar(this);
  }

  openWikiLink(linkText: string): void {
    const target = (linkText || "").trim();
    if (!target)
      return;
    this.app.workspace.openLinkText(target, this.file ? this.file.path : "", true);
  }

  revealHighlightInPane(highlightId: string): void {
    if (!highlightId)
      return;
    this.plugin.revealHighlightInSidebar(this, highlightId);
  }

  async createHighlight(selection: any): Promise<BookHighlight | null> {
    const quote = normalizeHighlightQuote(selection?.quote);
    if (!quote || !selection?.cfiRange) {
      new Notice("\u672a\u9009\u4e2d\u6587\u672c");
      return null;
    }
    const noteFile = await getOrCreateBookNote(this.app, this.file!, getEpubTocMd(this.fileToc), this.plugin.settings);
    if (!noteFile)
      return null;
    const id = createHighlightId();
    const highlight: BookHighlight = {
      id,
      bookPath: this.file!.path,
      bookTitle: this.file!.basename,
      chapterTitle: selection.chapterTitle || this.file!.basename,
      cfiRange: selection.cfiRange,
      quote,
      comment: selection.comment || "",
      notePath: noteFile.path,
      blockId: id,
      created: new Date().toISOString(),
    };
    const list = getHighlightsForBook(this.plugin.settings, this.file!.path);
    if (!await this.runHighlightTransaction(
      noteFile.path,
      list,
      [...list, highlight],
      "create-highlight",
      () => this.plugin.bookNoteService.appendHighlight(noteFile, highlight),
    )) {
      return null;
    }
    this.selectedHighlightId = highlight.id;
    this.renderHighlightsPane();
    this.revealHighlightInPane(highlight.id!);
    new Notice(highlight.comment ? "笔记已保存" : "高亮已保存");
    return highlight;
  }

  async updateHighlight(highlight: any): Promise<BookHighlight | null> {
    if (!highlight)
      return null;
    const list = getHighlightsForBook(this.plugin.settings, this.file!.path);
    const index = list.findIndex((item) => item.id === highlight.id);
    if (index < 0)
      return null;
    const updatedAt = new Date().toISOString();
    const nextComment = (highlight.comment || "").trim();
    const shouldAppendComment = !!highlight.appendComment && !!nextComment;
    let updated = buildHighlightNoteUpdate(
      list[index],
      highlight,
      shouldAppendComment ? [list[index].comment, nextComment].map((value) => (value || "").trim()).filter(Boolean).join("\n\n") : nextComment,
      updatedAt,
    );
    if (highlight.aiSections !== undefined) {
      (updated as any).aiSections = highlight.aiSections;
    }
    if (highlight.commentEntries !== undefined) {
      (updated as any).commentEntries = highlight.commentEntries;
    }
    const noteFile = this.app.vault.getAbstractFileByPath(updated.notePath!);
    if (!(noteFile instanceof TFile)) {
      new Notice(`找不到书籍笔记：${updated.notePath || "未知路径"}`);
      return null;
    }
    const nextHighlights = list.map((item) => item.id === updated.id ? updated : item);
    if (!await this.runHighlightTransaction(noteFile.path, list, nextHighlights, "update-highlight", async () => {
      if (shouldAppendComment) {
        await this.plugin.bookNoteService.appendReflection(noteFile, updated, nextComment);
        const details = await this.plugin.bookNoteService.readHighlightDetails(noteFile, updated);
        updated = { ...updated, comment: details.comment } as BookHighlight;
        (updated as any).commentEntries = details.commentEntries;
        (updated as any).aiSections = details.aiSections;
        nextHighlights[index] = updated;
      } else {
        await this.plugin.bookNoteService.replaceHighlight(
          noteFile,
          updated,
          highlight.expectedDetails as Pick<HighlightNoteDetails, "quote" | "commentEntries" | "aiSections"> | undefined,
        );
      }
    })) {
      return null;
    }
    this.selectedHighlightId = updated.id!;
    this.renderHighlightsPane();
    this.revealHighlightInPane(updated.id!);
    new Notice(updated.comment ? "笔记已更新" : "高亮已更新");
    return updated;
  }

  async deleteHighlight(highlight: any): Promise<boolean> {
    if (!highlight)
      return false;
    const list = getHighlightsForBook(this.plugin.settings, this.file!.path);
    const existing = list.find((item) => item.id === highlight.id);
    if (!existing)
      return false;
    const noteFile = this.app.vault.getAbstractFileByPath(existing.notePath!);
    if (noteFile instanceof TFile) {
      if (!await this.runHighlightTransaction(
        noteFile.path,
        list,
        list.filter((item) => item.id !== existing.id),
        "delete-highlight",
        () => this.plugin.bookNoteService.deleteHighlight(noteFile, existing),
      )) {
        return false;
      }
    } else {
      try {
        await this.plugin.highlightService.replaceBookHighlights(
          this.file!.path,
          list.filter((item) => item.id !== existing.id),
          "delete-highlight-with-missing-note",
        );
      } catch (error) {
        console.error("Jarvis Reader orphan highlight delete failed.", error);
        new Notice("书籍笔记已不存在，但高亮索引删除失败；索引保持原样。", 0);
        return false;
      }
    }
    if (this.selectedHighlightId === existing.id) {
      this.selectedHighlightId = null;
    }
    if (this.currentRendition && this.currentRendition.annotations) {
      try {
        this.currentRendition.annotations.remove(existing.cfiRange, "highlight");
      } catch (error) {
        console.warn("Jarvis Reader highlight remove failed.", error);
      }
    }
    if (this.highlightDeleted) {
      this.highlightDeleted(existing);
    }
    this.renderHighlightsPane();
    this.refreshCurrentHighlightPanes();
    new Notice("\u6807\u6ce8\u5df2\u5220\u9664");
    return true;
  }

  selectHighlight(highlight: any): void {
    if (!highlight)
      return;
    this.selectedHighlightId = highlight.id;
    this.renderHighlightsPane();
  }

  async jumpToHighlight(highlight: any, skipSidebarRender = false): Promise<void> {
    if (!highlight?.cfiRange) throw new Error("缺少原文定位信息。");
    const sequence = ++this.sourceJumpSequence;
    this.sourceJumpPending = true;
    const filePath = this.file?.path || "";
    const rendition = this.currentRendition && this.renditionFilePath === filePath
      ? this.currentRendition
      : await new Promise<any>((resolve, reject) => {
        const onReady = (ready: unknown) => { window.clearTimeout(timeout); resolve(ready); };
        const timeout = window.setTimeout(() => {
          this.renditionReadyResolvers = this.renditionReadyResolvers.filter((callback) => callback !== onReady);
          reject(new Error("阅读器加载超时。"));
        }, 10000);
        this.renditionReadyResolvers.push(onReady);
      });
    const isCurrent = () => sequence === this.sourceJumpSequence && this.file?.path === filePath && this.currentRendition === rendition;
    if (!isCurrent()) return;
    this.selectedHighlightId = highlight.id;
    (rendition as any).__jarvisReaderSkipInitialLocation = true;
    if (!await displayReadingSource(rendition, highlight.cfiRange, isCurrent)) return;
    this.refreshCurrentHighlightPanes();
    if (!skipSidebarRender) this.renderHighlightsPane();
  }

  async openHighlightsPane(): Promise<void> {
    await this.plugin.openHighlightsPane(this);
  }

  editHighlight(highlight: any): void {
    if (this.highlightEditor) {
      this.highlightEditor(highlight);
    }
  }

  registerHighlightEditor(editor: any): void {
    this.highlightEditor = editor;
  }

  registerHighlightDeleted(callback: any): void {
    this.highlightDeleted = callback;
  }

  refreshCurrentHighlightPanes(): void {
    const rendition = this.currentRendition;
    refreshHighlightPanes(rendition);
  }

  async stopThemeSync(): Promise<void> {
    const statsFile = this.statsBookFile;
    this.statsBookFile = null;
    this.currentRendition = null;
    this.renditionFilePath = "";
    if (this.themeSyncInterval) {
      window.clearInterval(this.themeSyncInterval);
      this.themeSyncInterval = null;
    }
    if (this.statsSaveTimer) {
      window.clearInterval(this.statsSaveTimer);
      this.statsSaveTimer = null;
    }
    if (this.themeSyncViewportHandler && window.visualViewport) {
      window.visualViewport.removeEventListener("resize", this.themeSyncViewportHandler);
      this.themeSyncViewportHandler = null;
    }
    if (this.interactionCleanup) {
      this.interactionCleanup();
      this.interactionCleanup = null;
    }
    if (statsFile) await this.saveReadingStats(statsFile);
  }

  startThemeSync(rendition: any, isCurrent: () => boolean = () => true): void {
    const sequence = this.readerLoadSequence;
    const isActive = () => !this.readerUnloaded && sequence === this.readerLoadSequence && isCurrent();
    if (!isActive()) return;
    void this.stopThemeSync().then(() => {
      if (!isActive()) return;
      this.currentRendition = rendition;
      this.renditionFilePath = this.file?.path || "";
      for (const resolve of this.renditionReadyResolvers.splice(0)) resolve(rendition);
      this.statsBookFile = this.file;
      this.statsSaveTimer = window.setInterval(() => {
        if (this.statsBookFile) {
          void this.saveReadingStats(this.statsBookFile).catch((error) => this.reportBackgroundSaveError("阅读统计", error));
        }
      }, 30000);
      let lastThemeKey = "";
      const sync = () => {
      if (!isActive()) return;
      if (Date.now() - this.lastInteractionTime < 120000) {
        const bookPath = this.statsBookFile?.path;
        if (bookPath) this.readingStatsService.add(bookPath);
      }
      const readerZoom = clampReaderZoom(this.plugin.settings.readerZoom);
      const readerLineHeight = clampReaderLineHeight(this.plugin.settings.readerLineHeight);
      const letterSpacing = clampReaderLetterSpacing(this.plugin.settings.readerLetterSpacing);
      const wordSpacing = clampReaderWordSpacing(this.plugin.settings.readerWordSpacing);
      const paragraphIndent = normalizeReaderParagraphIndent(this.plugin.settings.readerParagraphIndent);
      const theme = getJarvisReaderTheme(readerZoom, readerLineHeight);
      const nextThemeKey = `${theme.background}|${theme.text}|${theme.fontFamily}|${theme.fontSize}|${theme.lineHeight}|${readerZoom}|${paragraphIndent}|${letterSpacing}|${wordSpacing}`;
      if (nextThemeKey !== lastThemeKey) {
        applyObsidianThemeToRendition(rendition, readerZoom, readerLineHeight, paragraphIndent, letterSpacing, wordSpacing);
        this.refreshCurrentHighlightPanes();
        lastThemeKey = nextThemeKey;
      }
      };
      sync();
      this.themeSyncInterval = window.setInterval(sync, 1000);
      if (window.visualViewport) {
        this.themeSyncViewportHandler = sync;
        window.visualViewport.addEventListener("resize", this.themeSyncViewportHandler);
      }
    }).catch((error) => this.reportBackgroundSaveError("切换阅读状态", error));
  }

  async saveReadingStats(file: TFile): Promise<void> {
    const bookPath = file.path;
    if (this.readingStatsService.pending(bookPath) <= 0) return;
    const today = new Date().toLocaleDateString("en-CA");
    if (!this.plugin.settings.readingStats) {
      this.plugin.settings.readingStats = {};
    }
    await this.readingStatsService.flush(
      bookPath,
      today,
      this.plugin.settings.readingStats,
      () => this.plugin.saveSettings(),
    );

    // Sync reading time to frontmatter
    let totalSecs = 0;
    Object.values(this.plugin.settings.readingStats).forEach(daily => {
      if (daily[bookPath]) totalSecs += daily[bookPath];
    });
    
    try {
      const { getOrCreateBookNote } = await import("./book-notes");
      const { formatDuration } = await import("./utils");
      const noteFile = await getOrCreateBookNote(this.plugin.app, file, "", this.plugin.settings);
      if (noteFile) {
        await this.plugin.app.fileManager.processFrontMatter(noteFile, (fm: any) => {
          fm.reading_time = formatDuration(totalSecs);
        });
      }
    } catch (e) {
      console.warn("Failed to sync reading time to metadata", e);
    }
  }

  reportBackgroundSaveError(context: string, error: unknown): void {
    console.error(`Jarvis Reader ${context}保存失败。`, error);
    new Notice(`${context}保存失败，将在下次操作时重试。`);
  }

  private renderedReaderLayout: Pick<ReaderPreferences, "singlePageView" | "scrolledView" | "readerWidth"> | null = null;
  readerSettingsOpen = false;
  getReaderSettingsOpen = (): boolean => this.readerSettingsOpen;
  setReaderSettingsOpen = (open: boolean): void => { this.readerSettingsOpen = open; };

  getReaderPreferences = (): ReaderPreferences => ({
    readerLetterSpacing: clampReaderLetterSpacing(this.plugin.settings.readerLetterSpacing),
    readerWordSpacing: clampReaderWordSpacing(this.plugin.settings.readerWordSpacing),
    readerParagraphIndent: normalizeReaderParagraphIndent(this.plugin.settings.readerParagraphIndent),
    readerWidth: clampReaderWidth(this.plugin.settings.readerWidth),
    readerZoom: clampReaderZoom(this.plugin.settings.readerZoom),
    readerLineHeight: clampReaderLineHeight(this.plugin.settings.readerLineHeight),
    singlePageView: this.plugin.settings.singlePageView,
    scrolledView: this.plugin.settings.singlePageView && this.plugin.settings.scrolledView,
  });

  updateReaderPreferences = async (patch: Partial<ReaderPreferences>): Promise<void> => {
    const before = this.getReaderPreferences();
    const next = resolveReaderPreferences(before, patch);
    Object.assign(this.plugin.settings, next);
    try { await this.plugin.saveSettings(); }
    catch (error) { this.reportBackgroundSaveError("阅读设置", error); throw error; }
    const rendered = this.renderedReaderLayout || before;
    if (rendered.readerWidth !== next.readerWidth || rendered.singlePageView !== next.singlePageView || rendered.scrolledView !== next.scrolledView) {
      await this.onLoadFile(this.file!);
    } else if (this.currentRendition) {
      applyObsidianThemeToRendition(this.currentRendition, next.readerZoom, next.readerLineHeight, next.readerParagraphIndent, next.readerLetterSpacing, next.readerWordSpacing);
      this.currentRendition.resize?.();
      this.refreshCurrentHighlightPanes();
    }
  };

  async setReaderZoom(delta: number): Promise<void> {
    await this.updateReaderPreferences({ readerZoom: this.getReaderPreferences().readerZoom + delta });
  }

  async setInitLocation(initLocation: string): Promise<void> {
    await this.plugin.bookStateService.saveLocation(this.file!.path, initLocation);
  }

  async setBookProgress(relocated: any, chapterTitle: string = "", rendition: any = null): Promise<void> {
    const progress = getReaderProgress(relocated, rendition);
    if (!progress)
      return;
    progress.chapterTitle = chapterTitle || "";
    await this.plugin.bookStateService.saveProgress(this.file!.path, progress);
  }

  async getInitLocation(): Promise<string | null> {
    const location = this.plugin.settings.bookInitLocations[this.file!.path];
    return location ? location : null;
  }

  async prepareBookPathChange(oldPath: string): Promise<void> {
    ++this.readerLoadSequence;
    this.highlightEditor = null;
    this.highlightDeleted = null;
    this.statsBookFile = null;
    if (this.reactRoot) { this.reactRoot.unmount(); this.reactRoot = null; }
    await this.stopThemeSync();
    const stats = this.plugin.settings.readingStats || (this.plugin.settings.readingStats = {});
    const date = new Date();
    const today = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    await this.readingStatsService.flush(oldPath, today, stats, () => this.plugin.saveSettingsData());
  }

  async onLoadFile(file: TFile): Promise<void> {
    if (this.readerUnloaded) return;
    const sequence = ++this.readerLoadSequence;
    this.highlightEditor = null;
    this.highlightDeleted = null;
    const filePath = file.path;
    const isCurrent = () => !this.readerUnloaded && sequence === this.readerLoadSequence && this.file?.path === filePath;
    this.sourceJumpPending = !!this.plugin.sourceJumpPaths?.has(file.path);
    this.setHeaderMenuVisibility(true);
    await this.stopThemeSync();
    if (!isCurrent()) return;
    if (this.reactRoot) {
      this.reactRoot.unmount();
      this.reactRoot = null;
    }
    (this.contentEl as any).empty();

    this.lastInteractionTime = Date.now();
    
    const interactionEvents = ["mousemove", "keydown", "click", "scroll"];
    const interactionHandler = () => { if (isCurrent()) this.lastInteractionTime = Date.now(); };
    interactionEvents.forEach(evt => {
      this.contentEl.addEventListener(evt, interactionHandler, { passive: true });
    });
    this.interactionCleanup = () => {
      interactionEvents.forEach(evt => {
        this.contentEl.removeEventListener(evt, interactionHandler);
      });
    };

    const style = getComputedStyle(this.containerEl.parentElement!.querySelector("div.view-header")!);
    const width = parseFloat(style.width);
    const height = parseFloat(style.height);
    const tocOffset = height < width ? height : 0;
    const contents = await this.app.vault.adapter.readBinary(filePath);
    if (!isCurrent()) return;
    const initLocation = await this.getInitLocation();
    if (!isCurrent()) return;
    const highlights = await this.getBookHighlightsForReader();
    if (!isCurrent()) return;
    this.plugin.activeReaderView = this;
    await this.plugin.setActiveReader(this, "toc");
    if (!isCurrent()) return;
    this.renderedReaderLayout = { readerWidth: clampReaderWidth(this.settings.readerWidth), singlePageView: this.settings.singlePageView, scrolledView: this.settings.singlePageView && this.settings.scrolledView };
    this.reactRoot = createRoot(this.contentEl);
    this.reactRoot.render(React.createElement(EpubReader, {
      contents,
      title: file.basename,
      bookPath: file.path,
      scrolled: this.settings.scrolledView,
      singlePage: this.settings.singlePageView,
      readerWidth: clampReaderWidth(this.settings.readerWidth),
      readerZoom: clampReaderZoom(this.settings.readerZoom),
      readerLineHeight: clampReaderLineHeight(this.settings.readerLineHeight),
      tocOffset,
      initLocation,
      shouldSkipInitialLocation: () => !isCurrent() || this.sourceJumpPending,
      saveLocation: (location: string) => { if (!isCurrent()) return; void this.setInitLocation(location).catch((error) => this.reportBackgroundSaveError("阅读位置", error)); },
      saveProgress: (relocated: any, chapterTitle: string, rendition: any) => { if (!isCurrent()) return; void this.setBookProgress(relocated, chapterTitle, rendition).catch((error) => this.reportBackgroundSaveError("阅读进度", error)); },
      tocMemo: (toc: any) => { if (!isCurrent()) return; this.fileToc = toc; this.plugin.refreshReaderSidebar(this); },
      createBookNote: () => { this.createBookNote(); },
      highlights,
      createHighlight: (selection: any) => this.createHighlight(selection),
      updateHighlight: (highlight: any) => this.updateHighlight(highlight),
      deleteHighlight: (highlight: any) => this.deleteHighlight(highlight),
      selectHighlight: (highlight: any) => { this.selectHighlight(highlight); },
      registerHighlightEditor: (editor: any) => { if (isCurrent()) this.registerHighlightEditor(editor); },
      registerHighlightDeleted: (callback: any) => { if (isCurrent()) this.registerHighlightDeleted(callback); },
      getPreferences: this.getReaderPreferences,
      getPanelOpen: this.getReaderSettingsOpen,
      onPanelOpenChange: this.setReaderSettingsOpen,
      onPreferencesChange: this.updateReaderPreferences,
      setReaderZoom: (delta: number) => { void this.setReaderZoom(delta).catch(() => {}); },
      syncRenditionTheme: (rendition: any) => { if (isCurrent()) this.startThemeSync(rendition, isCurrent); },
      wordAssets: this.getWordAssets(),
      translateSelection: (text: string, sentence: string = "", options: any = {}) => this.translateSelection(text, sentence, options),
      saveWordAsset: (selection: any, translation: any) => this.saveWordAsset(selection, translation),
      addBookmark: (cfi: string, title: string) => { this.addBookmark(cfi, title); },
      deleteWordAsset: (asset: any) => this.deleteWordAsset(asset),
      loadWordDisplay: (asset: any) => this.loadWordDisplay(asset),
      autoWordHighlight: this.shouldAutoHighlightWords(),
      speechLang: this.plugin.settings.speechLang,
      highlightColors: this.plugin.settings.highlightColors,
      enableWordAudio: !!this.plugin.settings.enableWordAudio,
      wordAudioTemplate: this.plugin.settings.wordAudioTemplate,
      wordAudioAccent: this.plugin.settings.wordAudioAccent,
      blurWordCardBody: !!this.plugin.settings.blurWordCardBody,
      wikiLinkCandidates: getMarkdownLinkCandidates(this.app),
      getWikiLinkCandidates: () => getMarkdownLinkCandidates(this.app),
      openWikiLink: (linkText: string) => { this.openWikiLink(linkText); },
      promoteHighlight: (highlight: BookHighlight) => this.promoteHighlight(highlight),
      onInteraction: () => { if (isCurrent()) this.lastInteractionTime = Date.now(); },
      app: this.app
    }));
  }

  onunload(): void {
    this.readerUnloaded = true;
    ++this.readerLoadSequence;
    this.highlightEditor = null;
    this.highlightDeleted = null;
    this.setHeaderMenuVisibility(false);
    void this.stopThemeSync().catch((error) => this.reportBackgroundSaveError("关闭阅读器时的统计", error));
    this.plugin.clearActiveReader(this);
    if (this.reactRoot) {
      this.reactRoot.unmount();
      this.reactRoot = null;
    }
  }

  async setEphemeralState(state: any): Promise<void> {
    if (state && state.epubcifi) {
      if (this.currentRendition) {
        this.currentRendition.display(state.epubcifi);
      } else {
        this.plugin.settings.bookInitLocations[this.file!.path] = state.epubcifi;
      }
    }
    super.setEphemeralState(state);
  }

  jumpToCfi(cfi: string): void {
    if (this.currentRendition) {
      this.currentRendition.display(cfi);
    }
  }

  async addBookmark(cfi: string, title: string) {
    if (!cfi) return;
    const path = this.file.path;
    try {
      const added = await this.plugin.bookStateService.addBookmark(path, {
        cfi,
        title: title || "未知章节",
        created: Date.now(),
      });
      if (!added) {
        new Notice("该位置已存在书签");
        return;
      }
      new Notice("书签已添加");
      const event = new CustomEvent("jarvis-reader-bookmarks-updated", { detail: path });
      window.dispatchEvent(event);
    } catch (error) {
      console.error("Failed to add bookmark", error);
      new Notice("书签保存失败，未保留本次更改。");
    }
  }

  canAcceptExtension(extension: string): boolean {
    return extension === "epub";
  }

  getViewType(): string {
    return "epub";
  }
}
