import { Notice, Plugin, TFile, type WorkspaceLeaf } from "obsidian";
import { findWordAssetBySurface } from "./core/word-assets.ts";
import { upsertWordEntryInContent } from "./core/word-markdown.ts";
import type { JarvisReaderSettings, WordAsset } from "./domain/index.ts";
import { DEFAULT_SETTINGS } from "./defaults.ts";
import { EPUB_VIEW_TYPE, EpubFileView } from "./reader/EpubFileView.tsx";
import { IndexRepository } from "./storage/index-repository.ts";
import { createSettingsDataStore, createVaultTextFileStore } from "./storage/obsidian-adapters.ts";
import { loadSettings, saveSettings } from "./storage/settings.ts";
import { WordCardModal } from "./ui/WordCardModal.ts";

export default class JarvisReaderMigrationPlugin extends Plugin {
  declare settings: JarvisReaderSettings;
  private indexRepository!: IndexRepository;

  async onload(): Promise<void> {
    const dataStore = createSettingsDataStore(this);
    this.settings = await loadSettings(dataStore, DEFAULT_SETTINGS);
    this.indexRepository = new IndexRepository(createVaultTextFileStore(this.app.vault.adapter));
    try {
      const restored = await this.indexRepository.restore(this.settings);
      if (restored.restoredHighlightBooks > 0) await saveSettings(dataStore, this.settings);
    } catch (error) {
      console.error("Jarvis Reader index restore failed.", error);
      new Notice("Jarvis Reader 索引加载失败，请检查控制台和索引文件");
    }
    const workspaceDocument = this.app.workspace.containerEl.ownerDocument;
    this.registerDomEvent(workspaceDocument, "dblclick", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (!target.closest(".markdown-reading-view, .markdown-source-view")) return;
      globalThis.setTimeout(() => {
        const selected = workspaceDocument.defaultView?.getSelection()?.toString() || "";
        const asset = findWordAssetBySurface(this.settings.wordAssets, selected);
        if (asset) {
          new WordCardModal(
            this.app,
            asset,
            (entry) => this.openWordAsset(entry),
            {
              enabled: this.settings.enableWordAudio,
              template: this.settings.wordAudioTemplate,
              accent: this.settings.wordAudioAccent,
              speechLang: this.settings.speechLang,
            },
          ).open();
        }
      }, 0);
    });
    this.registerView(EPUB_VIEW_TYPE, (leaf: WorkspaceLeaf) => {
      return new EpubFileView(leaf, this);
    });
    try {
      this.registerExtensions(["epub"], EPUB_VIEW_TYPE);
    } catch (error) {
      console.warn("Jarvis Reader could not register the EPUB extension.", error);
    }
    console.info("Jarvis Reader TypeScript migration reader loaded.");
  }

  async saveSettings(reason = "save"): Promise<void> {
    await saveSettings(createSettingsDataStore(this), this.settings);
    if (reason !== "save") await this.indexRepository.persist(this.settings, reason);
  }

  private async openWordAsset(asset: WordAsset): Promise<void> {
    if (!asset.notePath) throw new Error("Word asset note path is missing.");
    const parts = asset.notePath.split("/").slice(0, -1);
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!(await this.app.vault.adapter.exists(current))) await this.app.vault.createFolder(current);
    }
    const existing = this.app.vault.getAbstractFileByPath(asset.notePath);
    if (existing instanceof TFile) {
      const content = await this.app.vault.read(existing);
      const projected = upsertWordEntryInContent(content, asset);
      if (projected !== content) await this.app.vault.modify(existing, projected);
    } else {
      await this.app.vault.create(
        asset.notePath,
        upsertWordEntryInContent(`# 翻译卡片\n`, asset),
      );
    }
    await this.app.workspace.openLinkText(`${asset.notePath}#^${asset.blockId}`, "", true);
  }
}
