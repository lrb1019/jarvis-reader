// Extracted from main.js L51297-51821 — EpubView (Obsidian FileView for epub files)

import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { FileView, WorkspaceLeaf, TFile, Notice } from "obsidian";
import { normalizeHighlightQuote } from "./utils";
import { openOrCreateNote, getOrCreateBookNote } from "./book-notes";
import { getEpubTocMd, createHighlightId, getHighlightsForBook, buildHighlightNoteUpdate } from "./highlights";
import { getTranslationAssetKey, getTranslationAssetStorageKey, buildWordAssetFromSelection } from "./word-assets";
import { translateSelectionWithApi } from "./translation";
import { clampReaderZoom, clampReaderLineHeight, getJarvisReaderTheme, applyObsidianThemeToRendition } from "./theme";
import { getReaderProgress } from "./progress";
import { getMarkdownLinkCandidates } from "./wiki-editor";
import { EpubReader, getLightWordAsset } from "./EpubReader";
import type { JarvisReaderSettings, BookHighlight } from "./types";

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
  pendingStatsSeconds: number = 0;
  statsSaveTimer: any = null;
  interactionCleanup: (() => void) | null = null;
  reactRoot: Root | null = null;

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
      new Notice("Only English words, short phrases, or translated sentences can be saved.");
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

  async openWordNote(asset: any): Promise<void> {
    if (typeof this.plugin.openWordSidebarPane === "function") {
      this.plugin.openWordSidebarPane(true, asset);
    } else {
      new Notice("词句卡片现已无文件化，请在右侧边栏查阅");
    }
  }

  async setWordMastered(asset: any, mastered: boolean): Promise<any> {
    const assetKey = getTranslationAssetStorageKey(asset);
    if (!assetKey)
      return null;
    const current = getWordAssetsMap(this.plugin.settings)[assetKey] || asset;
    const updated = {
      ...current,
      mastered: !!mastered,
      updated: new Date().toISOString(),
    };
    return await this.plugin.wordAssetService.save(getLightWordAsset(updated));
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

  async promoteHighlight(highlight: BookHighlight, reflection: string): Promise<void> {
    if (!highlight.notePath || !reflection.trim()) return;
    const title = reflection.trim().split(/\r?\n/)[0].slice(0, 48) || "未命名想法";
    try {
      const file = await this.plugin.knowledgeNoteService.create({
        folder: this.plugin.settings.knowledgeNoteFolder || "",
        title,
        body: reflection,
        sourceNotePath: highlight.notePath,
        sourceBlockId: highlight.blockId || highlight.id,
        sourceBookTitle: highlight.bookTitle,
        createdAt: new Date().toISOString().slice(0, 10),
      });
      await this.app.workspace.getLeaf(true).openFile(file);
      new Notice("已创建知识笔记。");
    } catch (error) {
      console.error("Jarvis Reader knowledge note creation failed.", error);
      new Notice(`创建知识笔记失败：${error instanceof Error ? error.message : "未知错误"}`);
    }
  }

  async commitHighlightIndex(nextHighlights: BookHighlight[], reason: string): Promise<boolean> {
    const bookPath = this.file!.path;
    try {
      await this.plugin.highlightService.replaceBookHighlights(bookPath, nextHighlights, reason);
      return true;
    } catch (error) {
      console.error("Jarvis Reader highlight index save failed after Markdown write.", error);
      new Notice("书籍笔记已保存，但高亮索引未保存。请先恢复 highlights.json；Markdown 正文不会丢失，但这条 EPUB 标记需要手动重新创建。", 0);
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
    await this.plugin.bookNoteService.appendHighlight(noteFile, highlight);
    const list = getHighlightsForBook(this.plugin.settings, this.file!.path);
    if (!await this.commitHighlightIndex([...list, highlight], "create-highlight")) {
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
    if (noteFile instanceof TFile) {
      if (shouldAppendComment) {
        await this.plugin.bookNoteService.appendReflection(noteFile, updated, nextComment);
        const details = await this.plugin.bookNoteService.readHighlightDetails(noteFile, updated);
        updated = { ...updated, comment: details.comment } as BookHighlight;
        (updated as any).commentEntries = details.commentEntries;
        (updated as any).aiSections = details.aiSections;
      } else {
        await this.plugin.bookNoteService.replaceHighlight(noteFile, updated);
      }
    }
    if (!await this.commitHighlightIndex(list.map((item) => item.id === updated.id ? updated : item), "update-highlight")) {
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
      await this.plugin.bookNoteService.deleteHighlight(noteFile, existing);
    }
    if (!await this.commitHighlightIndex(list.filter((item) => item.id !== existing.id), "delete-highlight")) {
      return false;
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

  jumpToHighlight(highlight: any, skipSidebarRender = false): void {
    if (!highlight || !highlight.cfiRange || !this.currentRendition)
      return;
    this.selectedHighlightId = highlight.id;
    try {
      this.currentRendition.display(highlight.cfiRange);
      this.refreshCurrentHighlightPanes();
      if (!skipSidebarRender) {
        this.renderHighlightsPane();
      }
    } catch (error) {
      console.warn("Jarvis Reader jump to highlight failed.", error);
    }
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
    window.setTimeout(() => {
      window.requestAnimationFrame(() => {
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
  }

  stopThemeSync(): void {
    this.currentRendition = null;
    if (this.themeSyncInterval) {
      window.clearInterval(this.themeSyncInterval);
      this.themeSyncInterval = null;
    }
    if (this.statsSaveTimer) {
      window.clearInterval(this.statsSaveTimer);
      this.statsSaveTimer = null;
    }
    this.saveReadingStats();
    if (this.themeSyncViewportHandler && window.visualViewport) {
      window.visualViewport.removeEventListener("resize", this.themeSyncViewportHandler);
      this.themeSyncViewportHandler = null;
    }
    if (this.interactionCleanup) {
      this.interactionCleanup();
      this.interactionCleanup = null;
    }
  }

  startThemeSync(rendition: any): void {
    this.stopThemeSync();
    this.currentRendition = rendition;
    this.statsSaveTimer = window.setInterval(() => {
      this.saveReadingStats();
    }, 30000);
    let lastThemeKey = "";
    const sync = () => {
      if (Date.now() - this.lastInteractionTime < 120000) {
        this.pendingStatsSeconds++;
      }
      const readerZoom = clampReaderZoom(this.plugin.settings.readerZoom);
      const readerLineHeight = clampReaderLineHeight(this.plugin.settings.readerLineHeight);
      const theme = getJarvisReaderTheme(readerZoom, readerLineHeight);
      const nextThemeKey = `${theme.background}|${theme.text}|${theme.fontFamily}|${theme.fontSize}|${theme.lineHeight}|${readerZoom}`;
      if (nextThemeKey !== lastThemeKey) {
        applyObsidianThemeToRendition(rendition, readerZoom, readerLineHeight);
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
  }

  async saveReadingStats(): Promise<void> {
    if (this.pendingStatsSeconds <= 0) return;
    const file = this.file;
    if (!file) return;
    const seconds = this.pendingStatsSeconds;
    this.pendingStatsSeconds = 0;
    const today = new Date().toLocaleDateString("en-CA");
    if (!this.plugin.settings.readingStats) {
      this.plugin.settings.readingStats = {};
    }
    if (!this.plugin.settings.readingStats[today]) {
      this.plugin.settings.readingStats[today] = {};
    }
    const bookPath = file.path;
    if (!this.plugin.settings.readingStats[today][bookPath]) {
      this.plugin.settings.readingStats[today][bookPath] = 0;
    }
    this.plugin.settings.readingStats[today][bookPath] += seconds;
    await this.plugin.saveSettings();

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

  async setReaderZoom(delta: number): Promise<void> {
    const nextZoom = clampReaderZoom(clampReaderZoom(this.plugin.settings.readerZoom) + delta);
    this.plugin.settings.readerZoom = nextZoom;
    await this.plugin.saveSettings();
    if (this.currentRendition) {
      applyObsidianThemeToRendition(this.currentRendition, nextZoom, this.plugin.settings.readerLineHeight);
      if (typeof this.currentRendition.resize === "function") {
        this.currentRendition.resize();
      }
      this.refreshCurrentHighlightPanes();
    }
  }

  async setReaderLineHeight(delta: number): Promise<void> {
    const nextLineHeight = clampReaderLineHeight(clampReaderLineHeight(this.plugin.settings.readerLineHeight) + delta);
    this.plugin.settings.readerLineHeight = nextLineHeight;
    await this.plugin.saveSettings();
    if (this.currentRendition) {
      applyObsidianThemeToRendition(this.currentRendition, this.plugin.settings.readerZoom, nextLineHeight);
      if (typeof this.currentRendition.resize === "function") {
        this.currentRendition.resize();
      }
      this.refreshCurrentHighlightPanes();
    }
  }

  async setScrolledView(value: boolean): Promise<void> {
    this.plugin.settings.scrolledView = value;
    await this.plugin.saveSettings();
    await this.onLoadFile(this.file!);
  }

  async setSinglePageView(value: boolean): Promise<void> {
    this.plugin.settings.singlePageView = value;
    if (!value) {
      this.plugin.settings.scrolledView = false;
    }
    await this.plugin.saveSettings();
    await this.onLoadFile(this.file!);
  }

  async setInitLocation(initLocation: string): Promise<void> {
    this.plugin.settings.bookInitLocations[this.file!.path] = initLocation;
    await this.plugin.saveSettings();
  }

  async setBookProgress(relocated: any, chapterTitle: string = "", rendition: any = null): Promise<void> {
    const progress = getReaderProgress(relocated, rendition);
    if (!progress)
      return;
    (progress as any).chapterTitle = chapterTitle || "";
    if (!this.plugin.settings.bookProgress) {
      this.plugin.settings.bookProgress = {};
    }
    this.plugin.settings.bookProgress[this.file!.path] = progress;
    await this.plugin.saveSettings();
  }

  async getInitLocation(): Promise<string | null> {
    const location = this.plugin.settings.bookInitLocations[this.file!.path];
    return location ? location : null;
  }

  async onLoadFile(file: TFile): Promise<void> {
    this.setHeaderMenuVisibility(true);
    this.stopThemeSync();
    if (this.reactRoot) {
      this.reactRoot.unmount();
      this.reactRoot = null;
    }
    (this.contentEl as any).empty();

    this.lastInteractionTime = Date.now();
    this.pendingStatsSeconds = 0;
    
    const interactionEvents = ["mousemove", "keydown", "click", "scroll"];
    const interactionHandler = () => { this.lastInteractionTime = Date.now(); };
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
    const contents = await this.app.vault.adapter.readBinary(file.path);
    this.plugin.activeReaderView = this;
    await this.plugin.setActiveReader(this, "toc");
    this.reactRoot = createRoot(this.contentEl);
    this.reactRoot.render(React.createElement(EpubReader, {
      contents,
      title: file.basename,
      bookPath: file.path,
      scrolled: this.settings.scrolledView,
      singlePage: this.settings.singlePageView,
      readerZoom: clampReaderZoom(this.settings.readerZoom),
      readerLineHeight: clampReaderLineHeight(this.settings.readerLineHeight),
      tocOffset,
      initLocation: await this.getInitLocation(),
      saveLocation: (location: string) => { this.setInitLocation(location); },
      saveProgress: (relocated: any, chapterTitle: string, rendition: any) => { this.setBookProgress(relocated, chapterTitle, rendition); },
      tocMemo: (toc: any) => { this.fileToc = toc; this.plugin.refreshReaderSidebar(this); },
      createBookNote: () => { this.createBookNote(); },
      highlights: await this.getBookHighlightsForReader(),
      createHighlight: (selection: any) => this.createHighlight(selection),
      updateHighlight: (highlight: any) => this.updateHighlight(highlight),
      deleteHighlight: (highlight: any) => this.deleteHighlight(highlight),
      selectHighlight: (highlight: any) => { this.selectHighlight(highlight); },
      registerHighlightEditor: (editor: any) => { this.registerHighlightEditor(editor); },
      registerHighlightDeleted: (callback: any) => { this.registerHighlightDeleted(callback); },
      setScrolled: (value: boolean) => { this.setScrolledView(value); },
      setSinglePage: (value: boolean) => { this.setSinglePageView(value); },
      setReaderZoom: (delta: number) => { this.setReaderZoom(delta); },
      setReaderLineHeight: (delta: number) => { this.setReaderLineHeight(delta); },
      syncRenditionTheme: (rendition: any) => { this.startThemeSync(rendition); },
      wordAssets: this.getWordAssets(),
      translateSelection: (text: string, sentence: string = "", options: any = {}) => this.translateSelection(text, sentence, options),
      saveWordAsset: (selection: any, translation: any) => this.saveWordAsset(selection, translation),
      openWordNote: (asset: any) => { this.openWordNote(asset); },
      addBookmark: (cfi: string, title: string) => { this.addBookmark(cfi, title); },
      setWordMastered: (asset: any, mastered: boolean) => this.setWordMastered(asset, mastered),
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
      promoteHighlight: (highlight: BookHighlight, reflection: string) => this.promoteHighlight(highlight, reflection),
      onInteraction: () => { this.lastInteractionTime = Date.now(); },
      app: this.app,
      smartCommands: this.plugin.settings.smartCommands || [],
      bookTitle: file.basename
    }));
  }

  onunload(): void {
    this.setHeaderMenuVisibility(false);
    this.stopThemeSync();
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
    if (!this.plugin.settings.bookBookmarks) {
      this.plugin.settings.bookBookmarks = {};
    }
    if (!this.plugin.settings.bookBookmarks[path]) {
      this.plugin.settings.bookBookmarks[path] = [];
    }
    
    // Check if already exists
    const exists = this.plugin.settings.bookBookmarks[path].find((b: any) => b.cfi === cfi);
    if (!exists) {
      this.plugin.settings.bookBookmarks[path].push({
        cfi,
        title: title || "未知章节",
        created: Date.now()
      });
      await this.plugin.saveSettings();
      new Notice("🔖 书签已添加");
      
      // Fire event to refresh LibraryApp
      const event = new CustomEvent("jarvis-reader-bookmarks-updated", { detail: path });
      window.dispatchEvent(event);
    } else {
      new Notice("🔖 该位置已存在书签");
    }
  }

  canAcceptExtension(extension: string): boolean {
    return extension === "epub";
  }

  getViewType(): string {
    return "epub";
  }
}
