import { Notice, Plugin, type WorkspaceLeaf } from "obsidian";
import type { JarvisReaderSettings } from "./domain/index.ts";
import { DEFAULT_SETTINGS } from "./defaults.ts";
import { EPUB_VIEW_TYPE, EpubFileView } from "./reader/EpubFileView.tsx";
import { IndexRepository } from "./storage/index-repository.ts";
import { createSettingsDataStore, createVaultTextFileStore } from "./storage/obsidian-adapters.ts";
import { loadSettings, saveSettings } from "./storage/settings.ts";

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
}
