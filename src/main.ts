import { Plugin, type WorkspaceLeaf } from "obsidian";
import type { JarvisReaderSettings } from "./domain/index.ts";
import { DEFAULT_SETTINGS } from "./defaults.ts";
import { EPUB_VIEW_TYPE, EpubFileView } from "./reader/EpubFileView.tsx";
import { createSettingsDataStore } from "./storage/obsidian-adapters.ts";
import { loadSettings, saveSettings } from "./storage/settings.ts";

export default class JarvisReaderMigrationPlugin extends Plugin {
  declare settings: JarvisReaderSettings;

  async onload(): Promise<void> {
    const dataStore = createSettingsDataStore(this);
    this.settings = await loadSettings(dataStore, DEFAULT_SETTINGS);
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

  async saveSettings(): Promise<void> {
    await saveSettings(createSettingsDataStore(this), this.settings);
  }
}
