// Extracted from main.js L51297-51821 — EpubView (Obsidian FileView for epub files)

import React from "react";
import ReactDOM from "react-dom";
import { FileView, WorkspaceLeaf, TFile, Notice } from "obsidian";
import { normalizeHighlightQuote } from "./utils";
import { openOrCreateNote, getOrCreateBookNote } from "./book-notes";
import { getEpubTocMd, createHighlightId, getHighlightsForBook, appendHighlightToBookNote, replaceHighlightInBookNote, deleteHighlightFromBookNote } from "./highlights";
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

function shouldAutoHighlightFile(filePath: string, settings: any): boolean {
  const autoHighlightPaths: string[] = Array.isArray(settings.autoWordHighlightPaths) ? settings.autoWordHighlightPaths : [];
  if (!autoHighlightPaths.length) return true;
  return autoHighlightPaths.some((p: string) => filePath.startsWith(p));
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
    if (!this.plugin.settings.wordAssets || typeof this.plugin.settings.wordAssets !== "object") {
      this.plugin.settings.wordAssets = {};
    }
    this.plugin.settings.wordAssets[asset.lemma] = getLightWordAsset(asset);
    await this.plugin.persistWordAssetSidecar("save");
    await this.plugin.saveSettings();
    new Notice("已保存到全局字典");
    return asset;
  }

  async openWordNote(asset: any): Promise<void> {
    new Notice("单词卡现已无文件化，请在右侧边栏查阅");
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
    if (!this.plugin.settings.wordAssets || typeof this.plugin.settings.wordAssets !== "object") {
      this.plugin.settings.wordAssets = {};
    }
    this.plugin.settings.wordAssets[assetKey] = getLightWordAsset(updated);
    
    // FILELESS: No markdown modification
    await this.plugin.persistWordAssetSidecar("save");
    await this.plugin.saveSettings();
    return updated;
  }

  async deleteWordAsset(asset: any): Promise<boolean> {
    const assetKey = getTranslationAssetStorageKey(asset);
    if (!assetKey)
      return false;
    if (!this.plugin.settings.wordAssets || typeof this.plugin.settings.wordAssets !== "object") {
      this.plugin.settings.wordAssets = {};
    }
    delete this.plugin.settings.wordAssets[assetKey];
    await this.plugin.persistWordAssetSidecar("delete");
    await this.plugin.saveSettingsData();
    
    // FILELESS: No markdown modification
    new Notice("词条已彻底删除。");
    return true;
  }

  async loadWordDisplay(asset: any): Promise<string> {
    return asset?.display || "";
  }

  shouldAutoHighlightWords(): boolean {
    return shouldAutoHighlightFile(this.file!.path, this.plugin.settings);
  }

  getBookHighlights(): BookHighlight[] {
    return getHighlightsForBook(this.plugin.settings, this.file!.path);
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
    await appendHighlightToBookNote(this.app, noteFile, highlight);
    if (!this.plugin.settings.bookHighlights) {
      this.plugin.settings.bookHighlights = {};
    }
    const list = getHighlightsForBook(this.plugin.settings, this.file!.path);
    this.plugin.settings.bookHighlights[this.file!.path] = [...list, highlight];
    await this.plugin.saveSettings();
    this.selectedHighlightId = highlight.id;
    this.renderHighlightsPane();
    this.revealHighlightInPane(highlight.id!);
    new Notice(highlight.comment ? "\u60f3\u6cd5\u5df2\u4fdd\u5b58" : "\u9ad8\u4eae\u5df2\u4fdd\u5b58");
    return highlight;
  }

  async updateHighlight(highlight: any): Promise<BookHighlight | null> {
    if (!highlight)
      return null;
    const list = getHighlightsForBook(this.plugin.settings, this.file!.path);
    const index = list.findIndex((item) => item.id === highlight.id);
    if (index < 0)
      return null;
    const updated: BookHighlight = {
      ...list[index],
      comment: highlight.comment || "",
      updated: new Date().toISOString(),
    };
    const noteFile = this.app.vault.getAbstractFileByPath(updated.notePath!);
    if (noteFile instanceof TFile) {
      await replaceHighlightInBookNote(this.app, noteFile, updated);
    }
    this.plugin.settings.bookHighlights[this.file!.path] = list.map((item) => item.id === updated.id ? updated : item);
    await this.plugin.saveSettings();
    this.selectedHighlightId = updated.id!;
    this.renderHighlightsPane();
    this.revealHighlightInPane(updated.id!);
    new Notice(updated.comment ? "\u60f3\u6cd5\u5df2\u66f4\u65b0" : "\u9ad8\u4eae\u5df2\u66f4\u65b0");
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
      await deleteHighlightFromBookNote(this.app, noteFile, existing);
    }
    this.plugin.settings.bookHighlights[this.file!.path] = list.filter((item) => item.id !== existing.id);
    await this.plugin.saveSettings();
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

  jumpToHighlight(highlight: any): void {
    if (!highlight || !highlight.cfiRange || !this.currentRendition)
      return;
    this.selectedHighlightId = highlight.id;
    try {
      this.currentRendition.display(highlight.cfiRange);
      this.refreshCurrentHighlightPanes();
      this.renderHighlightsPane();
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
          const views = rendition?.manager?.visible?.() || [];
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
    if (this.themeSyncViewportHandler && window.visualViewport) {
      window.visualViewport.removeEventListener("resize", this.themeSyncViewportHandler);
      this.themeSyncViewportHandler = null;
    }
  }

  startThemeSync(rendition: any): void {
    this.stopThemeSync();
    this.currentRendition = rendition;
    let lastThemeKey = "";
    const sync = () => {
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
    ReactDOM.unmountComponentAtNode(this.contentEl);
    (this.contentEl as any).empty();
    const style = getComputedStyle(this.containerEl.parentElement!.querySelector("div.view-header")!);
    const width = parseFloat(style.width);
    const height = parseFloat(style.height);
    const tocOffset = height < width ? height : 0;
    const contents = await this.app.vault.adapter.readBinary(file.path);
    this.plugin.activeReaderView = this;
    await this.plugin.setActiveReader(this, "toc");
    ReactDOM.render(React.createElement(EpubReader, {
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
      highlights: this.getBookHighlights(),
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
      setWordMastered: (asset: any, mastered: boolean) => this.setWordMastered(asset, mastered),
      deleteWordAsset: (asset: any) => this.deleteWordAsset(asset),
      loadWordDisplay: (asset: any) => this.loadWordDisplay(asset),
      autoWordHighlight: this.shouldAutoHighlightWords(),
      autoTranslateSelection: !!(this.plugin.settings.experimentalInstantTranslation && this.plugin.settings.experimentalInstantTranslation.enabled),
      speechLang: this.plugin.settings.speechLang,
      highlightColors: this.plugin.settings.highlightColors,
      enableWordAudio: !!this.plugin.settings.enableWordAudio,
      wordAudioTemplate: this.plugin.settings.wordAudioTemplate,
      wordAudioAccent: this.plugin.settings.wordAudioAccent,
      blurWordCardBody: !!this.plugin.settings.blurWordCardBody,
      wikiLinkCandidates: getMarkdownLinkCandidates(this.app),
      getWikiLinkCandidates: () => getMarkdownLinkCandidates(this.app),
      openWikiLink: (linkText: string) => { this.openWikiLink(linkText); },
    }), this.contentEl);
  }

  onunload(): void {
    this.setHeaderMenuVisibility(false);
    this.stopThemeSync();
    this.plugin.clearActiveReader(this);
    ReactDOM.unmountComponentAtNode(this.contentEl);
  }

  canAcceptExtension(extension: string): boolean {
    return extension === "epub";
  }

  getViewType(): string {
    return "epub";
  }
}
