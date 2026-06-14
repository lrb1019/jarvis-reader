import { Plugin, WorkspaceLeaf, Notice, TFile } from "obsidian";
import { EpubView } from "./EpubView";
import { JarvisReaderBookshelfView, BOOKSHELF_VIEW_TYPE, HIGHLIGHTS_VIEW_TYPE } from "./sidebar/BookshelfView";
import { JarvisReaderHighlightsView } from "./sidebar/HighlightsView";
import { JarvisReaderSettingTab, DEFAULT_SETTINGS } from "./settings";
import { openOrCreateNote } from "./book-notes";
import { normalizeVaultPath } from "./utils";
import { getTranslationAssetStorageKey, buildWordAssetMetadata } from "./word-assets";
import { getLightWordAsset } from "./EpubReader";
import { buildHighlightMetadata, getPdfTocMd } from "./highlights";
import { normalizeTranslationProvider } from "./translation";
import { DEFAULT_TRANSLATION_PROMPT, DEFAULT_WORD_AUDIO_TEMPLATE } from "./word-assets";

export default class JarvisReaderPlugin extends Plugin {
  settings: any;
  bookshelfView: any;
  highlightsView: any;
  activeReaderView: any;
  lastIndexCounts: any;

  async onload() {
    await this.loadSettings();
    await this.restoreValueHighlightsIfNeeded();
    await this.restoreIndexesFromSidecars();
    await this.persistIndexSidecars("startup");
    await this.saveSettingsData();
    this.registerView("epub", (leaf) => {
      return new EpubView(leaf, this.settings, this);
    });
    this.registerView(BOOKSHELF_VIEW_TYPE, (leaf) => {
      const view = new JarvisReaderBookshelfView(leaf, this);
      this.bookshelfView = view;
      return view;
    });
    this.registerView(HIGHLIGHTS_VIEW_TYPE, (leaf) => {
      const view = new JarvisReaderHighlightsView(leaf, this);
      this.highlightsView = view;
      return view;
    });
    try {
      this.registerExtensions(["epub"], "epub");
    } catch (error) {
      console.log(`registerExtensions epub failed.`);
    }
    this.addRibbonIcon("library", "\u6253\u5f00 Jarvis Reader \u4e66\u67b6", () => {
      this.openBookshelfPane(true);
    });
    this.addCommand({
      id: "open-jarvis-reader-bookshelf",
      name: "\u6253\u5f00 Jarvis Reader \u4e66\u67b6",
      callback: () => {
        this.openBookshelfPane(true);
      }
    });
    this.registerEvent(this.app.workspace.on("file-menu", (menu, file) => {
      if (file.extension.toLowerCase() === "pdf") {
        menu.addItem((item) => {
          item.setTitle("\u521b\u5efa\u6216\u6253\u5f00\u8bfb\u4e66\u7b14\u8bb0").setIcon("document").onClick(async () => {
            await openOrCreateNote(this.app, file, await getPdfTocMd(file), this.settings);
          });
        });
      }
    }));
    this.registerEvent(this.app.workspace.on("active-leaf-change", (leaf) => {
      const view = leaf == null ? void 0 : leaf.view;
      if (view instanceof EpubView) {
        this.activeReaderView = view;
      } else if (view instanceof JarvisReaderBookshelfView) {
        this.bookshelfView = view;
        view.render();
      }
    }));
    this.app.workspace.onLayoutReady(() => {
      for (const leaf of this.app.workspace.getLeavesOfType(HIGHLIGHTS_VIEW_TYPE)) {
        leaf.detach();
      }
      this.openBookshelfPane(false);
    });
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
  async setActiveReader(reader, preferredPanel = "toc") {
    this.activeReaderView = reader;
    await this.openBookshelfPane(false);
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
    const leaves = this.app.workspace.getLeavesOfType(HIGHLIGHTS_VIEW_TYPE);
    for (const leaf of leaves) {
      leaf.detach();
    }
    this.clearActiveReader(reader);
  }
  clearActiveReader(reader) {
    if (reader && this.activeReaderView !== reader)
      return;
    this.activeReaderView = null;
    if (this.bookshelfView && typeof this.bookshelfView.clearActiveReader === "function") {
      this.bookshelfView.clearActiveReader(reader);
    }
  }
  async restoreValueHighlightsIfNeeded() {
    const bookPath = "09 Books/\u4ef7\u503c\u5fc3\u6cd5 (\u59dc\u80e1\u8bf4).epub";
    const restorePath = ".obsidian/plugins/jarvis-reader/value-highlights-restore.json";
    try {
      const current = Array.isArray(this.settings.bookHighlights && this.settings.bookHighlights[bookPath]) ? this.settings.bookHighlights[bookPath] : [];
      if (current.length >= 99)
        return;
      const adapter = this.app.vault.adapter;
      if (!adapter || typeof adapter.exists !== "function" || typeof adapter.read !== "function")
        return;
      if (!await adapter.exists(restorePath))
        return;
      const restored = JSON.parse(await adapter.read(restorePath));
      if (!Array.isArray(restored) || restored.length < 99)
        return;
      this.settings.bookHighlights = this.settings.bookHighlights || {};
      this.settings.bookHighlights[bookPath] = restored;
      await this.saveSettings();
    } catch (error) {
      console.warn("Jarvis Reader value highlights restore failed.", error);
    }
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
  async readJsonSidecar(path) {
    const adapter = this.app.vault.adapter;
    if (!adapter || typeof adapter.exists !== "function" || typeof adapter.read !== "function")
      return null;
    if (!await adapter.exists(path))
      return null;
    try {
      return JSON.parse(await adapter.read(path));
    } catch (error) {
      console.warn(`Jarvis Reader failed to read sidecar ${path}.`, error);
      return null;
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
  getIndexCounts(snapshot = null) {
    const state = snapshot || this.getIndexSnapshot();
    const highlightCount = Object.values(state.bookHighlights || {}).reduce((total, list) => total + (Array.isArray(list) ? list.length : 0), 0);
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
  async restoreIndexesFromSidecars() {
    try {
      const paths = this.getIndexSidecarPaths();
      const highlightsSidecar = await this.readJsonSidecar(paths.highlights);
      let changed = false;
      if (highlightsSidecar && highlightsSidecar.bookHighlights) {
        changed = this.mergeHighlightSidecar(highlightsSidecar.bookHighlights) || changed;
      }
      const adapter = this.app.vault.adapter;
      const hasWordAssetSidecar = adapter && typeof adapter.exists === "function" && await adapter.exists(paths.wordAssets);
      if (hasWordAssetSidecar) {
        const raw = await adapter.read(paths.wordAssets);
        const parsed = JSON.parse(raw);
        if (!parsed || !parsed.wordAssets || typeof parsed.wordAssets !== "object") {
          throw new Error("word-assets.json does not contain a wordAssets object.");
        }
        this.settings.wordAssets = this.normalizeWordAssetSidecar(parsed.wordAssets);
      } else {
        this.settings.wordAssets = this.normalizeWordAssetSidecar(this.settings.wordAssets);
        await this.persistWordAssetSidecar("migrate-from-data");
      }
      if (changed) {
        await this.logIndexChange("restore-from-sidecar");
      }
    } catch (error) {
      this.settings.wordAssets = {};
      console.error("Jarvis Reader word asset sidecar load failed.", error);
      new Notice("词条主数据读取失败；已停止加载词条，请检查 word-assets.json。", 0);
      throw error;
    }
  }
  async persistWordAssetSidecar(reason = "save") {
    const paths = this.getIndexSidecarPaths();
    const adapter = this.app.vault.adapter;
    if (!adapter || typeof adapter.write !== "function") {
      throw new Error("Vault adapter is not available.");
    }
    await this.ensureAdapterFolder(".obsidian/plugins/jarvis-reader/index");
    const wordAssets = {};
    for (const [key, asset] of Object.entries(this.settings.wordAssets || {})) {
      if (asset) {
        wordAssets[key] = buildWordAssetMetadata(asset);
      }
    }
    await adapter.write(paths.wordAssets, JSON.stringify({
      version: 2,
      updated: new Date().toISOString(),
      wordAssets
    }, null, 2));
    await this.logIndexChange(reason);
  }
  async persistIndexSidecars(reason = "save") {
    try {
      const paths = this.getIndexSidecarPaths();
      const adapter = this.app.vault.adapter;
      if (!adapter || typeof adapter.write !== "function") {
        throw new Error("Jarvis Reader sidecar persist failed: vault adapter not available.");
      }
      await this.ensureAdapterFolder(".obsidian/plugins/jarvis-reader/index");
      await this.ensureAdapterFolder(".obsidian/plugins/jarvis-reader/logs");
      const snapshot = this.getIndexSnapshot();
      await adapter.write(paths.highlights, JSON.stringify({
        version: 1,
        updated: new Date().toISOString(),
        bookHighlights: snapshot.bookHighlights
      }, null, 2));
      await this.persistWordAssetSidecar(reason);
      await this.logIndexChange(reason, snapshot);
    } catch (error) {
      console.error("Jarvis Reader sidecar persist failed.", error);
      throw error;
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
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
    for (const [lemma, asset] of Object.entries(this.settings.wordAssets)) {
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
    if (!this.settings.experimentalInstantTranslation || typeof this.settings.experimentalInstantTranslation !== "object") {
      this.settings.experimentalInstantTranslation = {
        enabled: false
      };
    }
    this.settings.experimentalInstantTranslation.enabled = this.settings.experimentalInstantTranslation.enabled === true;
    delete this.settings.experimentalInstantTranslation.localDictionaryEnabled;
    delete this.settings.experimentalInstantTranslation.localDictionaryPath;
    delete this.settings.localDictionary;
    this.settings.translationPrompt = String(this.settings.translationPrompt || DEFAULT_TRANSLATION_PROMPT);
    this.settings.wordNoteFolder = normalizeVaultPath(this.settings.wordNoteFolder || "09 Books/Words");
    this.settings.autoHighlightFolders = Array.isArray(this.settings.autoHighlightFolders) ? this.settings.autoHighlightFolders.map((folder) => normalizeVaultPath(folder)).filter(Boolean) : ["09 Books"];
    this.settings.enableWordAudio = this.settings.enableWordAudio !== false;
    this.settings.wordAudioTemplate = String(this.settings.wordAudioTemplate || DEFAULT_WORD_AUDIO_TEMPLATE);
    this.settings.wordAudioAccent = String(this.settings.wordAudioAccent || "us").toLowerCase() === "uk" ? "uk" : "us";
    this.settings.blurWordCardBody = this.settings.blurWordCardBody !== false;
    this.settings.speechLang = String(this.settings.speechLang || "en-US");
    if (!this.settings.bookCoverCache) {
      this.settings.bookCoverCache = {};
    }
    if (!["single", "dual"].includes(this.settings.sidebarLayoutMode)) {
      this.settings.sidebarLayoutMode = "single";
    }
    const sidebarPaneSplit = parseFloat(this.settings.sidebarPaneSplit);
    this.settings.sidebarPaneSplit = Number.isFinite(sidebarPaneSplit) ? Math.min(75, Math.max(25, sidebarPaneSplit)) : 48;
    this.settings.bookshelfCoverOnly = !!this.settings.bookshelfCoverOnly;
  }
  async saveSettings() {
    await this.persistIndexSidecars("save");
    await this.saveSettingsData();
  }
  async saveSettingsData() {
    const settingsData = {
      ...this.settings
    };
    delete settingsData.wordAssets;
    await this.saveData(settingsData);
  }
};