import { Plugin, WorkspaceLeaf, Notice, TFile, addIcon } from "obsidian";
import { EpubView } from "./EpubView";
import { resolveSyncConflicts } from "./conflict-resolver";
import { JarvisReaderBookshelfView, BOOKSHELF_VIEW_TYPE } from "./sidebar/BookshelfView";
import { LibraryView, LIBRARY_VIEW_TYPE } from "./library/LibraryView";
import { JarvisReaderSettingTab, DEFAULT_SETTINGS } from "./settings";
import { findBookNote, openOrCreateNote } from "./book-notes";
import { normalizeVaultPath } from "./utils";
import { openFileOnceInActiveTab } from "./workspace-navigation";
import { parseReadingSourceTarget } from "./reading-source-link";
import { getTranslationAssetStorageKey, buildWordAssetMetadata, getLightWordAsset } from "./word-assets";
import { buildHighlightMetadata, getPdfTocMd } from "./highlights";
import { normalizeTranslationProvider } from "./translation";
import { DEFAULT_TRANSLATION_PROMPT, DEFAULT_WORD_AUDIO_TEMPLATE } from "./word-assets";
import { WordAssetService } from "./word-asset-service";
import { HighlightService } from "./highlight-service";
import { BookNoteService } from "./book-note-service";
import { createBookNoteOperations } from "./book-note-operations";
import { KnowledgeNoteService } from "./knowledge-note-service";
import { createKnowledgeNoteStorage } from "./knowledge-note-store";
import { CoverCacheService, saveCustomBookCover } from "./cover-cache-service";
import type { BookCoverCache, BookCoverCacheEntry, BookHighlight } from "./types";
import { HighlightTransactionService, writeExistingRecoveryNote } from "./highlight-transaction-service";
import { SettingsSaveQueue } from "./settings-save-queue";
import { removeSmartCommandsWithBackup } from "./smart-command-migration";
import { removeReviewData } from "./review-migration";
import { BookStateService } from "./book-state-service";
import { configureStorageFolders, type StorageFolders } from "./storage-folders";
import { BookPathService, resolveBookPath } from "./book-path-service";
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
      // 启动恢复可能早于 Obsidian 完成笔记索引。
      await writeExistingRecoveryNote<TFile>(
        path,
        content,
        file instanceof TFile ? file : null,
        (note, body) => this.app.vault.modify(note, body),
        this.app.vault.adapter,
      );
    },
    getBookHighlights: (bookPath) => this.settings?.bookHighlights?.[bookPath] || [],
    replaceBookHighlights: (bookPath, highlights, reason) => this.highlightService.replaceBookHighlights(bookPath, highlights, reason),
  });
  settingsSaveQueue = new SettingsSaveQueue(
    () => this.getSettingsDataSnapshot(),
    (settingsData) => this.saveData(settingsData),
  );
  highlightSidecarUnavailable = false;
  bookPathUpdateInProgress = false;
  bookPathUpdateBlocked = false;
  private bookPathQueue: Promise<void> = Promise.resolve();
  private readonly pendingNotePaths = new Set<string>();
  private readonly bookPathPending = ".obsidian/plugins/jarvis-reader/pending/book-path-rename.json";
  bookPathService = new BookPathService({
    state: () => this.settings,
    readPending: async () => await this.app.vault.adapter.exists(this.bookPathPending) ? this.app.vault.adapter.read(this.bookPathPending) : null,
    writePending: async content => {
      await this.ensureAdapterFolder(".obsidian/plugins/jarvis-reader/pending");
      await this.app.vault.adapter.write(this.bookPathPending, content);
    },
    clearPending: () => this.app.vault.adapter.remove(this.bookPathPending),
    persist: async () => {
      if (this.highlightSidecarUnavailable || this.wordAssetSidecarUnavailable || !this.coverCacheMigrationComplete) throw new Error("索引或封面存储不可用，路径同步已停止");
      const snapshot = this.getIndexSnapshot(); const paths = this.getIndexSidecarPaths();
      await writeHighlightSidecar(this.app.vault.adapter, paths.highlights, snapshot.bookHighlights);
      await writeWordAssetSidecar(this.app.vault.adapter, paths.wordAssets, snapshot.wordAssets);
      const covers: BookCoverCache = this.settings.bookCoverCache || {};
      const current = this.coverCacheService.snapshot();
      for (const [key, entry] of Object.entries(covers)) {
        if (JSON.stringify(current[key]) !== JSON.stringify(entry)) await this.coverCacheService.save(key, entry);
      }
      await this.coverCacheService.prune(Object.keys(covers));
      this.settings.bookCoverCache = this.coverCacheService.snapshot();
      await this.saveSettingsData();
    },
  });


  async onload() {
    addIcon("jarvis-logo", JARVIS_LOGO_SVG);
    addIcon("jarvis-library-big", LIBRARY_BIG_SVG);
    await this.loadSettings();
    const needsStartupIndexPersistence = await this.restoreIndexesFromSidecars();
    await this.migrateReviewData();
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
    try {
      if (await this.bookPathService.recover()) new Notice("已恢复未完成的书籍路径同步");
    } catch (error) {
      this.bookPathUpdateBlocked = true;
      console.error("Jarvis Reader book path recovery failed", error);
      new Notice("书籍路径同步需要恢复，保存已暂停，恢复记录保留。请检查日志。", 0);
    }
    if (!this.bookPathUpdateBlocked) await this.saveSettingsData();
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      if (file instanceof TFile && file.extension.toLowerCase() === "md" && oldPath.toLowerCase().endsWith(".md")) {
        const tracked = this.pendingNotePaths.has(oldPath) || Object.values(this.settings.bookNotePaths || {}).includes(oldPath)
          || Object.values(this.settings.bookHighlights || {}).some(items => Array.isArray(items) && items.some((item: BookHighlight) => item.notePath === oldPath));
        if (!tracked) return;
        this.bookPathUpdateInProgress = true;
        const newPath = file.path;
        this.pendingNotePaths.add(newPath);
        this.bookPathQueue = this.bookPathQueue.then(async () => {
          if (this.bookPathUpdateBlocked) throw new Error("上一次路径同步尚未恢复");
          await this.flushSettingsData();
          await this.bookPathService.renameNote(oldPath, newPath);
          this.pendingNotePaths.delete(newPath);
          this.bookPathUpdateInProgress = this.pendingNotePaths.size > 0;
          this.onHighlightsChanged();
          window.dispatchEvent(new CustomEvent("jarvis-reader-folders-updated"));
        }).catch(error => {
          this.bookPathUpdateInProgress = false;
          this.bookPathUpdateBlocked = true;
          console.error("Jarvis Reader note path synchronization failed", error);
          new Notice("读书笔记已移动，但关联同步未完成；原记录和恢复信息已保留，请恢复后重载插件。", 0);
        });
        return;
      }
      if (!(file instanceof TFile) || file.extension.toLowerCase() !== "epub" || !oldPath.toLowerCase().endsWith(".epub")) return;
      this.bookPathUpdateInProgress = true;
      const newPath = file.path;
      const readers = this.app.workspace.getLeavesOfType("epub").map(leaf => leaf.view).filter((view): view is EpubView => view instanceof EpubView && !!view.file);
      const preparing = Promise.all(readers.map(view => view.prepareBookPathChange(view.file === file ? oldPath : view.file!.path)));
      this.bookPathQueue = this.bookPathQueue.then(async () => {
        await preparing;
        await this.flushSettingsData();
        this.bookPathUpdateInProgress = true;
        try {
          if (this.bookPathUpdateBlocked) throw new Error("上一次路径同步尚未恢复");
          const basename = oldPath.slice(oldPath.lastIndexOf("/") + 1, -5);
          const previousFile = { path: oldPath, basename, extension: "epub", parent: { path: oldPath.slice(0, Math.max(0, oldPath.lastIndexOf("/"))) } } as TFile;
          const note = findBookNote(this.app, previousFile, this.settings) || findBookNote(this.app, file, this.settings);
          await this.bookPathService.rename(oldPath, newPath, note?.path);
          this.onHighlightsChanged(); this.onWordAssetsChanged();
          window.dispatchEvent(new CustomEvent("jarvis-reader-bookmarks-updated"));
        } finally { this.bookPathUpdateInProgress = false; }
        for (const view of readers) {
          try { if (view.file) await view.onLoadFile(view.file); } catch (error) {
            console.error("Jarvis Reader renamed book could not reopen", error);
            new Notice("阅读记录已同步，但书籍重新打开失败，请重新打开书籍");
          }
        }
      }).catch(error => {
        this.bookPathUpdateInProgress = false;
        this.bookPathUpdateBlocked = true;
        console.error("Jarvis Reader book path synchronization failed", error);
        new Notice("书籍已改名，但阅读记录同步未完成；保存已暂停，请勿继续改名，原记录已保留，请检查日志并恢复后重载插件。", 0);
      });
    }));
    this.registerView("epub", (leaf) => {
      return new EpubView(leaf, this.settings, this);
    });
    this.registerView(BOOKSHELF_VIEW_TYPE, (leaf) => {
      const view = new JarvisReaderBookshelfView(leaf, this);
      this.bookshelfView = view;
      return view;
    });
    this.registerView(LIBRARY_VIEW_TYPE, (leaf) => {
      return new LibraryView(leaf, this);
    });
    try {
      this.registerExtensions(["epub"], "epub");
    } catch (error) {
      console.log(`registerExtensions epub failed.`);
    }
    this.registerObsidianProtocolHandler("jarvis-reader", (parameters) => {
      void this.openReadingSource(parameters);
    });
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
          
          this.activeReaderView = null;
        }
      }, 50);
    }));
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
  sourceJumpPaths = new Set<string>();

  async openReadingSource(parameters: Record<string, string>): Promise<void> {
    const target = parseReadingSourceTarget(parameters);
    if (!target) {
      new Notice("原文链接无效或版本不受支持。");
      return;
    }
    const aliases = this.settings.bookPathAliases || {};
    const originalIndexed = (this.settings.bookHighlights?.[target.bookPath] || []).some((item: BookHighlight) => item.id === target.highlightId || item.blockId === target.highlightId);
    if (!originalIndexed) target.bookPath = resolveBookPath(target.bookPath, aliases);
    const file = this.app.vault.getAbstractFileByPath(target.bookPath);
    if (!(file instanceof TFile)) {
      new Notice("找不到原书，可能已移动或删除。");
      return;
    }
    const indexed = (this.settings.bookHighlights?.[target.bookPath] || []).find((item) => item?.id === target.highlightId || item?.blockId === target.highlightId);
    const cfiRange = indexed?.cfiRange || target.cfiRange;
    if (!cfiRange) {
      new Notice("这条笔记没有可用的原文定位信息。");
      return;
    }
    this.sourceJumpPaths.add(target.bookPath);
    try {
      const leaf = await openFileOnceInActiveTab(this.app.workspace, file, "epub");
      if (!(leaf.view instanceof EpubView)) throw new Error("阅读器未能打开。");
      await leaf.view.jumpToHighlight({ id: indexed?.id || target.highlightId, cfiRange });
    } catch (error) {
      console.error("Jarvis Reader source navigation failed.", error);
      new Notice(`无法定位原文：${error instanceof Error ? error.message : "未知错误"}`);
    } finally {
      this.sourceJumpPaths.delete(target.bookPath);
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
  }
  refreshReaderSidebar(reader) {
    if (reader) {
      this.activeReaderView = reader;
    }
    if (this.bookshelfView && typeof this.bookshelfView.render === "function") {
      this.bookshelfView.render();
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
    setTimeout(() => {
        const epubLeaves = this.app.workspace.getLeavesOfType("epub");
        if (epubLeaves.length === 0) {
            const bookshelfLeaves = this.app.workspace.getLeavesOfType(BOOKSHELF_VIEW_TYPE);
            bookshelfLeaves.forEach(leaf => leaf.detach());
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
      const legacyAsset = asset as Record<string, unknown>;
      const isLegacySentence = key.startsWith("sentence-") || legacyAsset.kind === "sentence" || legacyAsset.isWord === false;
      const assetKey = getTranslationAssetStorageKey(asset) || (isLegacySentence ? key : "");
      if (assetKey) {
        normalized[assetKey] = getLightWordAsset(legacyAsset);
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
  async migrateReviewData(): Promise<void> {
    const migration = removeReviewData(this.settings.wordAssets || {}, this.settings);
    if (!migration.changed) return;

    const adapter = this.app.vault.adapter as SidecarFileAdapter;
    const paths = this.getIndexSidecarPaths();
    await writeWordAssetSidecar(adapter, paths.wordAssets, migration.wordAssets);
    this.settings = migration.settings;
    await this.saveSettingsData();
    new Notice("已移除旧复习和长句词条数据。", 10000);
  }
  async persistWordAssetSidecar(reason = "save") {
    if (this.bookPathUpdateInProgress || this.bookPathUpdateBlocked) throw new Error("书籍路径同步期间保存已暂停");
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
    if (this.bookPathUpdateInProgress || this.bookPathUpdateBlocked) throw new Error("书籍路径同步期间保存已暂停");
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
    let loadedSettings = await this.loadData() || {};
    let smartCommandsBackupPath = "";
    const migration = await removeSmartCommandsWithBackup(loadedSettings, async (content) => {
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      smartCommandsBackupPath = `.obsidian/plugins/jarvis-reader/backups/migrations/smart-commands-${timestamp}.json`;
      await this.ensureAdapterFolder(smartCommandsBackupPath.split("/").slice(0, -1).join("/"));
      await this.app.vault.adapter.write(smartCommandsBackupPath, content);
    });
    loadedSettings = migration.settings;
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
    delete (this.settings as unknown as Record<string, unknown>).enableGlobalMarkdownTranslation;
    this.settings.translationPrompt = String(this.settings.translationPrompt || DEFAULT_TRANSLATION_PROMPT);
    this.settings.bookFolder = normalizeVaultPath(this.settings.bookFolder || "");
    this.settings.bookNoteFolder = normalizeVaultPath(this.settings.bookNoteFolder || "");
    this.settings.customCoverFolder = normalizeVaultPath(this.settings.customCoverFolder ?? DEFAULT_SETTINGS.customCoverFolder);
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
    if (migration.migrated) {
      await this.saveSettingsData();
      new Notice(`智能指令已移除，旧配置备份位于：${smartCommandsBackupPath}`, 10000);
    }
  }
  async configureStorageFolders(draft: StorageFolders): Promise<void> {
    if (this.bookPathUpdateInProgress || this.bookPathUpdateBlocked) throw new Error("书籍路径更新期间不能更改目录");
    await configureStorageFolders({
      stat: path => this.app.vault.adapter.stat(path),
      mkdir: path => this.app.vault.createFolder(path)
    }, this.settings, draft, () => this.saveSettingsData());
    window.dispatchEvent(new CustomEvent("jarvis-reader-folders-updated"));
  }

  async saveSettings() {
    if (this.bookPathUpdateInProgress || this.bookPathUpdateBlocked) throw new Error("书籍路径同步期间保存已暂停");
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
    if (this.bookPathUpdateInProgress || this.bookPathUpdateBlocked) throw new Error("书籍路径同步期间封面保存已暂停");
    if (!this.coverCacheMigrationComplete) {
      throw new Error("封面缓存服务不可用，已停止写入以保护旧配置。");
    }
    await this.coverCacheService.save(key, entry);
    this.settings.bookCoverCache = this.coverCacheService.snapshot();
  }

  async restoreOriginalCover(book: TFile): Promise<void> {
    if (this.bookPathUpdateInProgress || this.bookPathUpdateBlocked) throw new Error("书籍路径同步期间封面保存已暂停");
    if (!this.coverCacheMigrationComplete) throw new Error("封面缓存服务不可用，已停止写入以保护旧配置。");
    const key = `${book.path}|${book.stat?.mtime || 0}|${book.stat?.size || 0}`;
    await this.coverCacheService.restoreOriginal(key);
    this.settings.bookCoverCache = this.coverCacheService.snapshot();
  }

  async saveCustomCover(book: TFile, buffer: ArrayBuffer): Promise<void> {
    await saveCustomBookCover({
      stat: path => this.app.vault.adapter.stat(path),
      mkdir: path => this.app.vault.createFolder(path),
      writeBinary: async (path, data) => {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (file instanceof TFile) {
          await this.app.vault.modifyBinary(file, data);
          return file.path;
        }
        return (await this.app.vault.createBinary(path, data)).path;
      }
    }, book, this.settings.customCoverFolder ?? "Cover", buffer, this.coverCacheService.snapshot(),
    (key, entry) => this.saveBookCoverCacheEntry(key, entry));
  }

  async pruneBookCoverCache(validKeys: Iterable<string>): Promise<number> {
    if (!this.coverCacheMigrationComplete) return 0;
    if (this.bookPathUpdateInProgress || this.bookPathUpdateBlocked) return 0;
    const removed = await this.coverCacheService.prune(validKeys);
    if (removed) this.settings.bookCoverCache = this.coverCacheService.snapshot();
    return removed;
  }
};
