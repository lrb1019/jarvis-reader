import { Plugin, WorkspaceLeaf, Notice, TFile, addIcon } from "obsidian";
import { EpubView } from "./EpubView";
import { resolveSyncConflicts } from "./conflict-resolver";
import { JarvisReaderBookshelfView, BOOKSHELF_VIEW_TYPE } from "./sidebar/BookshelfView";
import { LibraryView, LIBRARY_VIEW_TYPE } from "./library/LibraryView";
import { JarvisReaderSettingTab, DEFAULT_SETTINGS } from "./settings";
import { WordSidebarView, WORD_SIDEBAR_VIEW_TYPE } from "./sidebar/WordSidebarView";
import { WordBookView, WORD_BOOK_VIEW_TYPE } from "./word-book/WordBookView";
import { openOrCreateNote } from "./book-notes";
import { normalizeVaultPath } from "./utils";
import { getTranslationAssetStorageKey, buildWordAssetMetadata } from "./word-assets";
import { getLightWordAsset } from "./EpubReader";
import { buildHighlightMetadata, getPdfTocMd } from "./highlights";
import { normalizeTranslationProvider } from "./translation";
import { DEFAULT_TRANSLATION_PROMPT, DEFAULT_WORD_AUDIO_TEMPLATE } from "./word-assets";
import { registerGlobalMarkdownFeatures } from "./global-markdown";
import { WordAssetService } from "./word-asset-service";
import { HighlightService } from "./highlight-service";
import { BookNoteService } from "./book-note-service";
import { createBookNoteOperations } from "./book-note-operations";
import { KnowledgeNoteService } from "./knowledge-note-service";
import { createKnowledgeNoteStorage } from "./knowledge-note-store";
import { CoverCacheService } from "./cover-cache-service";
import type { BookCoverCache, BookCoverCacheEntry } from "./types";
import { HighlightTransactionService } from "./highlight-transaction-service";
import { SettingsSaveQueue } from "./settings-save-queue";
import { BookStateService } from "./book-state-service";
import {
  readHighlightSidecar,
  readWordAssetSidecar,
  writeHighlightSidecar,
  writeWordAssetSidecar,
  type SidecarFileAdapter,
} from "./index-sidecars";
const JARVIS_LOGO_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-library-big"><path d="M4 20V4h4l1 16H4z"/><path d="M11 20V4h3v16h-3z"/><path d="M16 4h4v16h-4l-1-16z"/></svg>`;
const LIBRARY_BIG_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-library-big"><path d="M4 20V4h4l1 16H4z"/><path d="M11 20V4h3v16h-3z"/><path d="M16 4h4v16h-4l-1-16z"/></svg>`;

export default class JarvisReaderPlugin extends Plugin {
  declare settings: any;
  bookshelfView: any;
  activeReaderView: any;
  wordSidebarView: any;
  lastIndexCounts: any;
  wordAssetSidecarUnavailable = false;
  wordAssetService = new WordAssetService(this);
  highlightService = new HighlightService(this);
  bookNoteService = new BookNoteService(createBookNoteOperations(this.app));
  bookStateService = new BookStateService(this);
  knowledgeNoteService = new KnowledgeNoteService(createKnowledgeNoteStorage(this.app.vault));
  coverCacheService = new CoverCacheService(this.app.vault.adapter);
  coverCacheMigrationComplete = false;
  highlightTransactionService = new HighlightTransactionService({
    adapter: this.app.vault.adapter,
    readNote: async (path) => {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) throw new Error(`找不到书籍笔记：${path}`);
      return this.app.vault.read(file);
    },
    writeNote: async (path, content) => {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) throw new Error(`找不到书籍笔记：${path}`);
      await this.app.vault.modify(file, content);
    },
    getBookHighlights: (bookPath) => this.settings?.bookHighlights?.[bookPath] || [],
    replaceBookHighlights: (bookPath, highlights, reason) => this.highlightService.replaceBookHighlights(bookPath, highlights, reason),
  });
  settingsSaveQueue = new SettingsSaveQueue(
    () => this.getSettingsDataSnapshot(),
    (settingsData) => this.saveData(settingsData),
  );
  highlightSidecarUnavailable = false;

  async onload() {
    addIcon("jarvis-logo", JARVIS_LOGO_SVG);
    addIcon("jarvis-library-big", LIBRARY_BIG_SVG);
    await this.loadSettings();
    const needsStartupIndexPersistence = await this.restoreIndexesFromSidecars();
    const highlightRecovery = await this.highlightTransactionService.recoverPending();
    if (highlightRecovery.finalized || highlightRecovery.rolledBack) {
      new Notice(`已恢复 ${highlightRecovery.finalized + highlightRecovery.rolledBack} 个未完成的高亮操作。`);
    }
    if (highlightRecovery.errors.length) {
      console.error("Jarvis Reader highlight transaction recovery failed.", highlightRecovery.errors);
      new Notice("存在无法自动恢复的高亮操作，恢复记录已保留。请检查开发者工具日志。", 0);
    }
    await resolveSyncConflicts(this);
    if (needsStartupIndexPersistence) {
      await this.persistIndexSidecars("startup");
    }
    await this.saveSettingsData();
    this.registerView("epub", (leaf) => {
      return new EpubView(leaf, this.settings, this);
    });
    this.registerView(BOOKSHELF_VIEW_TYPE, (leaf) => {
      const view = new JarvisReaderBookshelfView(leaf, this);
      this.bookshelfView = view;
      return view;
    });
    this.registerView(WORD_SIDEBAR_VIEW_TYPE, (leaf) => {
      const view = new WordSidebarView(leaf, this);
      this.wordSidebarView = view;
      return view;
    });
    this.registerView(WORD_BOOK_VIEW_TYPE, (leaf) => {
      return new WordBookView(leaf, this);
    });
    this.registerView(LIBRARY_VIEW_TYPE, (leaf) => {
      return new LibraryView(leaf, this);
    });
    try {
      this.registerExtensions(["epub"], "epub");
    } catch (error) {
      console.log(`registerExtensions epub failed.`);
    }
    this.addRibbonIcon("library-big", "打开图书库", () => {
      this.openLibrary();
    });
    this.addCommand({
      id: "open-jarvis-reader-library",
      name: "打开图书库",
      callback: () => {
        this.openLibrary();
      }
    });
    this.addCommand({
      id: "open-jarvis-reader-bookshelf",
      name: "打开阅读辅助边栏",
      callback: () => {
        this.openBookshelfPane(true);
      }
    });
    this.addCommand({
      id: "open-jarvis-reader-word-sidebar",
      name: "打开词条侧边栏",
      callback: () => {
        this.openWordSidebarPane(true);
      }
    });
    this.addCommand({
      id: "open-jarvis-reader-word-book",
      name: "打开词条",
      callback: () => {
        this.openWordBook();
      }
    });
    this.registerEvent(this.app.workspace.on("file-menu", (menu, file) => {
      if (file instanceof TFile && file.extension.toLowerCase() === "pdf") {
        menu.addItem((item) => {
          item.setTitle("\u521b\u5efa\u6216\u6253\u5f00\u8bfb\u4e66\u7b14\u8bb0").setIcon("pencil").onClick(async () => {
            await openOrCreateNote(this.app, file, await getPdfTocMd(file), this.settings);
          });
        });
      }
    }));
    this.registerEvent(this.app.workspace.on("active-leaf-change", (leaf) => {
      const view = leaf == null ? void 0 : leaf.view;
      if (view && view.getViewType() === "epub") {
        this.activeReaderView = view;
        
        // Auto-switch sidebars to this book
        const bookshelfLeaves = this.app.workspace.getLeavesOfType(BOOKSHELF_VIEW_TYPE);
        bookshelfLeaves.forEach(l => {
          if (l.view && typeof (l.view as any).setActiveReader === "function") {
             (l.view as any).setActiveReader(view, null);
          }
        });
        const wordSidebarLeaves = this.app.workspace.getLeavesOfType(WORD_SIDEBAR_VIEW_TYPE);
        wordSidebarLeaves.forEach(l => {
          if (l.view && typeof (l.view as any).setReader === "function") {
             (l.view as any).setReader(view);
          }
        });
      } else if (view instanceof JarvisReaderBookshelfView) {
        this.bookshelfView = view;
        view.render();
      }
    }));
    this.registerEvent(this.app.workspace.on("layout-change", () => {
      setTimeout(() => {
        const epubLeaves = this.app.workspace.getLeavesOfType("epub");
        if (epubLeaves.length === 0) {
          const bookshelfLeaves = this.app.workspace.getLeavesOfType(BOOKSHELF_VIEW_TYPE);
          bookshelfLeaves.forEach(leaf => leaf.detach());
          
          const wordSidebarLeaves = this.app.workspace.getLeavesOfType(WORD_SIDEBAR_VIEW_TYPE);
          wordSidebarLeaves.forEach(leaf => leaf.detach());
          
          this.activeReaderView = null;
        }
      }, 50);
    }));
    registerGlobalMarkdownFeatures(this);
    this.addSettingTab(new JarvisReaderSettingTab(this.app, this));
  }
  onunload() {
  }
  async openBookshelfPane(reveal = true) {
    let leaves = this.app.workspace.getLeavesOfType(BOOKSHELF_VIEW_TYPE);
    if (!leaves.length) {
      const leaf = this.app.workspace.getLeftLeaf(false);
      if (!leaf)
        return;
      await leaf.setViewState({ type: BOOKSHELF_VIEW_TYPE, active: true });
      leaves = [leaf];
    }
    const leaf = leaves[0];
    if (reveal && leaf && typeof this.app.workspace.revealLeaf === "function") {
      this.app.workspace.revealLeaf(leaf);
    }
    const view = leaf == null ? void 0 : leaf.view;
    if (view instanceof JarvisReaderBookshelfView) {
      this.bookshelfView = view;
      view.render();
    } else if (leaf) {
      window.setTimeout(() => {
        const delayedView = leaf.view;
        if (delayedView instanceof JarvisReaderBookshelfView) {
          this.bookshelfView = delayedView;
          delayedView.render();
        }
      }, 50);
    }
  }
  async openWordSidebarPane(reveal = true, targetAsset: any = null) {
    let leaves = this.app.workspace.getLeavesOfType(WORD_SIDEBAR_VIEW_TYPE);
    if (!leaves.length) {
      const leaf = this.app.workspace.getRightLeaf(false);
      if (!leaf)
        return;
      await leaf.setViewState({ type: WORD_SIDEBAR_VIEW_TYPE, active: true });
      leaves = [leaf];
    }
    const leaf = leaves[0];
    if (reveal && leaf && typeof this.app.workspace.revealLeaf === "function") {
      this.app.workspace.revealLeaf(leaf);
    }
    const view = leaf == null ? void 0 : leaf.view;
    if (view instanceof WordSidebarView) {
      this.wordSidebarView = view;
      if (this.activeReaderView) view.setReader(this.activeReaderView);
      if (targetAsset && typeof (view as any).focusAsset === "function") (view as any).focusAsset(targetAsset);
      view.render();
    } else if (leaf) {
      window.setTimeout(() => {
        const delayedView = leaf.view;
        if (delayedView instanceof WordSidebarView) {
          this.wordSidebarView = delayedView;
          if (this.activeReaderView) delayedView.setReader(this.activeReaderView);
          if (targetAsset && typeof (delayedView as any).focusAsset === "function") (delayedView as any).focusAsset(targetAsset);
          delayedView.render();
        }
      }, 50);
    }
  }

  async openWordBook() {
    let leaves = this.app.workspace.getLeavesOfType(WORD_BOOK_VIEW_TYPE);
    if (!leaves.length) {
      const leaf = this.app.workspace.getLeaf("split", "vertical");
      await leaf.setViewState({ type: WORD_BOOK_VIEW_TYPE, active: true });
      leaves = [leaf];
    }
    const leaf = leaves[0];
    if (leaf && typeof this.app.workspace.revealLeaf === "function") {
      this.app.workspace.revealLeaf(leaf);
    }
  }

  async openLibrary() {
    let leaves = this.app.workspace.getLeavesOfType(LIBRARY_VIEW_TYPE);
    if (!leaves.length) {
      const leaf = this.app.workspace.getLeaf("tab");
      await leaf.setViewState({ type: LIBRARY_VIEW_TYPE, active: true });
      leaves = [leaf];
    }
    const leaf = leaves[0];
    if (leaf && typeof this.app.workspace.revealLeaf === "function") {
      this.app.workspace.revealLeaf(leaf);
    }
  }

  async setActiveReader(reader, preferredPanel = "toc") {
    this.activeReaderView = reader;
    if (this.bookshelfView && typeof this.bookshelfView.setActiveReader === "function") {
      this.bookshelfView.setActiveReader(reader, preferredPanel);
    }
    if (this.wordSidebarView && typeof this.wordSidebarView.setReader === "function") {
      this.wordSidebarView.setReader(reader);
    }
  }
  refreshReaderSidebar(reader) {
    if (reader) {
      this.activeReaderView = reader;
    }
    if (this.bookshelfView && typeof this.bookshelfView.render === "function") {
      this.bookshelfView.render();
    }
  }
  refreshWordSidebar(reader) {
    if (this.wordSidebarView && typeof this.wordSidebarView.setReader === "function") {
      this.wordSidebarView.setReader(reader || this.activeReaderView);
    }
  }
  revealHighlightInSidebar(reader, highlightId) {
    if (reader) {
      this.activeReaderView = reader;
    }
    if (this.bookshelfView && typeof this.bookshelfView.revealHighlight === "function") {
      this.bookshelfView.revealHighlight(highlightId);
    }
  }
  async openHighlightsPane(reader, reveal = true) {
    await this.setActiveReader(reader, "highlights");
  }
  closeHighlightsPane(reader) {
    this.clearActiveReader(reader);
  }
  clearActiveReader(reader) {
    if (reader && this.activeReaderView !== reader)
      return;
    this.activeReaderView = null;
    if (this.bookshelfView && typeof this.bookshelfView.clearActiveReader === "function") {
      this.bookshelfView.clearActiveReader(reader);
    }
    if (this.wordSidebarView && typeof this.wordSidebarView.setReader === "function") {
      this.wordSidebarView.setReader(null);
    }
    setTimeout(() => {
        const epubLeaves = this.app.workspace.getLeavesOfType("epub");
        if (epubLeaves.length === 0) {
            const bookshelfLeaves = this.app.workspace.getLeavesOfType(BOOKSHELF_VIEW_TYPE);
            bookshelfLeaves.forEach(leaf => leaf.detach());
            
            const wordSidebarLeaves = this.app.workspace.getLeavesOfType(WORD_SIDEBAR_VIEW_TYPE);
            wordSidebarLeaves.forEach(leaf => leaf.detach());
        }
    }, 50);
  }
  getIndexSidecarPaths() {
    return {
      highlights: ".obsidian/plugins/jarvis-reader/index/highlights.json",
      wordAssets: ".obsidian/plugins/jarvis-reader/index/word-assets.json",
      log: ".obsidian/plugins/jarvis-reader/logs/index-changes.jsonl"
    };
  }
  async ensureAdapterFolder(folderPath) {
    const adapter = this.app.vault.adapter;
    if (!adapter || typeof adapter.exists !== "function" || typeof adapter.mkdir !== "function")
      return;
    const segments = normalizeVaultPath(folderPath).split("/").filter(Boolean);
    let current = "";
    for (const segment of segments) {
      current = current ? `${current}/${segment}` : segment;
      if (!await adapter.exists(current)) {
        await adapter.mkdir(current);
      }
    }
  }
  getIndexSnapshot() {
    const bookHighlights = {};
    for (const [bookPath, list] of Object.entries(this.settings.bookHighlights || {})) {
      if (!Array.isArray(list))
        continue;
      bookHighlights[bookPath] = list.map((highlight) => buildHighlightMetadata(highlight));
    }
    const wordAssets = {};
    for (const [key, asset] of Object.entries(this.settings.wordAssets || {})) {
      if (!asset)
        continue;
      wordAssets[key] = buildWordAssetMetadata(asset);
    }
    return {
      bookHighlights,
      wordAssets
    };
  }
  getIndexCounts(snapshot: any = null) {
    const state: any = snapshot || this.getIndexSnapshot();
    const highlightLists = Object.values(state.bookHighlights || {}) as unknown[];
    const highlightCount = highlightLists.reduce<number>((total, list) => total + (Array.isArray(list) ? list.length : 0), 0);
    const wordAssetCount = Object.keys(state.wordAssets || {}).length;
    return {
      highlightCount,
      wordAssetCount
    };
  }
  async logIndexChange(reason = "save", snapshot = null) {
    try {
      const paths = this.getIndexSidecarPaths();
      const adapter = this.app.vault.adapter;
      if (!adapter || typeof adapter.write !== "function")
        return;
      const counts = this.getIndexCounts(snapshot);
      const previous = this.lastIndexCounts || null;
      const changed = !previous || previous.highlightCount !== counts.highlightCount || previous.wordAssetCount !== counts.wordAssetCount;
      if (!changed && !String(reason || "").startsWith("restore"))
        return;
      this.lastIndexCounts = counts;
      await this.ensureAdapterFolder(".obsidian/plugins/jarvis-reader/logs");
      const line = JSON.stringify({
        time: new Date().toISOString(),
        reason,
        ...counts
      });
      let existing = "";
      if (typeof adapter.exists === "function" && typeof adapter.read === "function" && await adapter.exists(paths.log)) {
        existing = await adapter.read(paths.log);
      }
      await adapter.write(paths.log, `${existing || ""}${existing && !existing.endsWith("\n") ? "\n" : ""}${line}\n`);
    } catch (error) {
      console.warn("Jarvis Reader index log failed.", error);
    }
  }
  mergeHighlightSidecar(bookHighlights) {
    let changed = false;
    this.settings.bookHighlights = this.settings.bookHighlights || {};
    for (const [bookPath, sidecarList] of Object.entries(bookHighlights || {})) {
      if (!Array.isArray(sidecarList) || !sidecarList.length)
        continue;
      const currentList = Array.isArray(this.settings.bookHighlights[bookPath]) ? this.settings.bookHighlights[bookPath] : [];
      if (currentList.length === 0) {
        this.settings.bookHighlights[bookPath] = sidecarList;
        changed = true;
      }
    }
    return changed;
  }
  normalizeWordAssetSidecar(wordAssets) {
    const normalized = {};
    for (const [key, asset] of Object.entries(wordAssets || {})) {
      if (!asset)
        continue;
      const assetKey = getTranslationAssetStorageKey(asset) || key;
      if (assetKey) {
        normalized[assetKey] = getLightWordAsset(asset);
      }
    }
    return normalized;
  }
  async restoreIndexesFromSidecars(): Promise<boolean> {
    try {
      const paths = this.getIndexSidecarPaths();
      const adapter = this.app.vault.adapter as SidecarFileAdapter;
      const highlightsSidecar = await readHighlightSidecar(adapter, paths.highlights);
      let restoredToMemory = false;
      let needsStartupPersistence = false;
      if (highlightsSidecar.status === "ready") {
        this.highlightSidecarUnavailable = false;
        restoredToMemory = this.mergeHighlightSidecar(highlightsSidecar.value);
      } else if (highlightsSidecar.status === "missing") {
        this.highlightSidecarUnavailable = false;
        // Preserve a one-time migration path for pre-sidecar highlight data.
        needsStartupPersistence = true;
      } else {
        this.highlightSidecarUnavailable = true;
        this.settings.bookHighlights = {};
        console.error("Jarvis Reader highlight sidecar is invalid. The original file was left unchanged.");
        new Notice("高亮主数据 highlights.json 损坏或结构非法，原文件未被改写；高亮保存已停止，请先恢复该文件。", 0);
      }
      const wordAssetSidecar = await readWordAssetSidecar(adapter, paths.wordAssets);
      if (wordAssetSidecar.status === "ready") {
        this.wordAssetSidecarUnavailable = false;
        this.settings.wordAssets = this.normalizeWordAssetSidecar(wordAssetSidecar.value);
      } else if (wordAssetSidecar.status === "missing") {
        this.wordAssetSidecarUnavailable = false;
        this.settings.wordAssets = {};
        await this.persistWordAssetSidecar("initialize-empty");
      } else {
        this.wordAssetSidecarUnavailable = true;
        this.settings.wordAssets = {};
        console.error("Jarvis Reader word asset sidecar is invalid. The original file was left unchanged.");
        new Notice("词条主数据 word-assets.json 损坏或结构非法，原文件未被改写；词条功能已停止，请先恢复该文件。", 0);
      }
      if (restoredToMemory) {
        await this.logIndexChange("restore-from-sidecar");
      }
      return needsStartupPersistence;
    } catch (error) {
      this.settings.wordAssets = {};
      console.error("Jarvis Reader word asset sidecar load failed.", error);
      new Notice("词条主数据读取失败；已停止加载词条，请检查 word-assets.json。", 0);
      throw error;
    }
  }
  async persistWordAssetSidecar(reason = "save") {
    if (this.wordAssetSidecarUnavailable) {
      const message = "词条主数据不可用，已停止词条保存以保护损坏文件。请先恢复 word-assets.json。";
      console.error(`Jarvis Reader ${message}`);
      new Notice(message, 0);
      throw new Error(message);
    }
    const paths = this.getIndexSidecarPaths();
    const adapter = this.app.vault.adapter as SidecarFileAdapter;
    if (!adapter || typeof adapter.write !== "function") {
      throw new Error("Vault adapter is not available.");
    }
    const wordAssets = {};
    for (const [key, asset] of Object.entries(this.settings.wordAssets || {})) {
      if (asset) {
        wordAssets[key] = buildWordAssetMetadata(asset);
      }
    }
    await writeWordAssetSidecar(adapter, paths.wordAssets, wordAssets);
    await this.logIndexChange(reason);
  }
  onWordAssetsChanged() {
    this.refreshWordSidebar(this.activeReaderView);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("jarvis-reader-word-assets-changed"));
    }
  }
  onHighlightsChanged() {
    this.refreshReaderSidebar(this.activeReaderView);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("jarvis-reader-highlights-changed"));
    }
  }
  async persistHighlightSidecar(reason = "save") {
    if (this.highlightSidecarUnavailable) {
      const message = "高亮主数据不可用，已停止高亮索引保存以保护损坏文件。请先恢复 highlights.json。";
      console.error(`Jarvis Reader ${message}`);
      new Notice(message, 0);
      throw new Error(message);
    }
    const paths = this.getIndexSidecarPaths();
    const adapter = this.app.vault.adapter as SidecarFileAdapter;
    if (!adapter || typeof adapter.write !== "function") {
      throw new Error("Vault adapter is not available.");
    }
    const snapshot = this.getIndexSnapshot();
    await writeHighlightSidecar(adapter, paths.highlights, snapshot.bookHighlights);
    await this.logIndexChange(reason, snapshot);
  }
  async persistIndexSidecars(reason = "save") {
    try {
      const paths = this.getIndexSidecarPaths();
      const adapter = this.app.vault.adapter as SidecarFileAdapter;
      if (!adapter || typeof adapter.write !== "function") {
        throw new Error("Jarvis Reader sidecar persist failed: vault adapter not available.");
      }
      await this.ensureAdapterFolder(".obsidian/plugins/jarvis-reader/logs");
      const snapshot = this.getIndexSnapshot();
      if (!this.highlightSidecarUnavailable) {
        await this.persistHighlightSidecar(reason);
      }
      if (!this.wordAssetSidecarUnavailable) {
        await this.persistWordAssetSidecar(reason);
        await this.logIndexChange(reason, snapshot);
      }
    } catch (error) {
      console.error("Jarvis Reader sidecar persist failed.", error);
      throw error;
    }
  }

  async loadSettings() {
    const loadedSettings = await this.loadData() || {};
    const legacyCoverCache: BookCoverCache = loadedSettings.bookCoverCache && typeof loadedSettings.bookCoverCache === "object"
      ? loadedSettings.bookCoverCache as BookCoverCache
      : {};
    this.settings = Object.assign({}, DEFAULT_SETTINGS, loadedSettings);
    if (!this.settings.bookInitLocations) {
      this.settings.bookInitLocations = {};
    }
    if (!this.settings.bookHighlights) {
      this.settings.bookHighlights = {};
    }
    if (!this.settings.bookProgress) {
      this.settings.bookProgress = {};
    }
    if (!this.settings.wordAssets || typeof this.settings.wordAssets !== "object") {
      this.settings.wordAssets = {};
    }
    for (const [lemma, asset] of Object.entries(this.settings.wordAssets) as [string, any][]) {
      if (asset && asset.display) {
        this.settings.wordAssets[lemma] = getLightWordAsset(asset);
      }
    }
    if (!this.settings.translationApi || typeof this.settings.translationApi !== "object") {
      this.settings.translationApi = {
        provider: "openai-compatible",
        baseUrl: "",
        apiKey: "",
        model: ""
      };
    }
    this.settings.translationApi.provider = normalizeTranslationProvider(this.settings.translationApi.provider, this.settings.translationApi.baseUrl);
    this.settings.translationApi.baseUrl = String(this.settings.translationApi.baseUrl || "");
    this.settings.translationApi.apiKey = String(this.settings.translationApi.apiKey || "");
    this.settings.translationApi.model = String(this.settings.translationApi.model || "");
    delete (this.settings as any).localDictionary;
    this.settings.translationPrompt = String(this.settings.translationPrompt || DEFAULT_TRANSLATION_PROMPT);
    this.settings.bookNoteFolder = normalizeVaultPath(this.settings.bookNoteFolder || "");
    this.settings.customCoverFolder = normalizeVaultPath(this.settings.customCoverFolder || "00-Attachment");
    this.settings.enableAutoHighlight = this.settings.enableAutoHighlight !== false;
    this.settings.enableWordAudio = this.settings.enableWordAudio !== false;
    this.settings.wordAudioTemplate = String(this.settings.wordAudioTemplate || DEFAULT_WORD_AUDIO_TEMPLATE);
    this.settings.wordAudioAccent = String(this.settings.wordAudioAccent || "us").toLowerCase() === "uk" ? "uk" : "us";
    this.settings.blurWordCardBody = this.settings.blurWordCardBody !== false;
    this.settings.speechLang = String(this.settings.speechLang || "en-US");
    try {
      await this.coverCacheService.load();
      const backupRoot = await this.coverCacheService.migrateLegacy(legacyCoverCache);
      this.settings.bookCoverCache = this.coverCacheService.snapshot();
      this.coverCacheMigrationComplete = true;
      if (backupRoot) {
        await this.saveSettingsData();
        new Notice(`封面缓存已迁出 data.json，原配置备份位于：${backupRoot}`, 10000);
      }
    } catch (error) {
      this.coverCacheMigrationComplete = false;
      this.settings.bookCoverCache = legacyCoverCache;
      console.error("Jarvis Reader cover cache migration failed.", error);
      new Notice("封面缓存迁移失败，旧 data.json 数据已保留；请检查磁盘空间和插件目录权限。", 0);
    }
    if (!["single", "dual"].includes(this.settings.sidebarLayoutMode)) {
      this.settings.sidebarLayoutMode = "single";
    }
    const sidebarPaneSplit = parseFloat(this.settings.sidebarPaneSplit);
    this.settings.sidebarPaneSplit = Number.isFinite(sidebarPaneSplit) ? Math.min(75, Math.max(25, sidebarPaneSplit)) : 48;
    this.settings.bookshelfCoverOnly = !!this.settings.bookshelfCoverOnly;
  }
  async saveSettings() {
    // Index sidecars have dedicated services; ordinary settings must not rewrite them.
    await this.saveSettingsData();
  }
  async saveSettingsData() {
    await this.settingsSaveQueue.request();
  }

  getSettingsDataSnapshot() {
    const settingsData = {
      ...this.settings
    };
    delete settingsData.wordAssets;
    delete settingsData.bookHighlights;
    if (this.coverCacheMigrationComplete) {
      delete settingsData.bookCoverCache;
    }
    return settingsData;
  }

  async flushSettingsData(): Promise<void> {
    await this.settingsSaveQueue.flushNow();
  }

  async saveBookCoverCacheEntry(key: string, entry: BookCoverCacheEntry): Promise<void> {
    if (!this.coverCacheMigrationComplete) {
      throw new Error("封面缓存服务不可用，已停止写入以保护旧配置。");
    }
    await this.coverCacheService.save(key, entry);
    this.settings.bookCoverCache = this.coverCacheService.snapshot();
  }

  async pruneBookCoverCache(validKeys: Iterable<string>): Promise<number> {
    if (!this.coverCacheMigrationComplete) return 0;
    const removed = await this.coverCacheService.prune(validKeys);
    if (removed) this.settings.bookCoverCache = this.coverCacheService.snapshot();
    return removed;
  }
};
