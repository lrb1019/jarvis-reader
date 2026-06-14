import { Menu, Plugin, TFile, type TAbstractFile, type WorkspaceLeaf } from "obsidian";
import { DEFAULT_UPSTREAM_SETTINGS, type UpstreamReaderSettings } from "./upstream/settings.ts";
import { EPUB_VIEW_TYPE, UpstreamEpubView } from "./upstream/EpubView.tsx";
import { getPdfTocMarkdown, openOrCreateBookNote } from "./upstream/utils.ts";

export default class JarvisReaderPlugin extends Plugin {
  settings: UpstreamReaderSettings = { ...DEFAULT_UPSTREAM_SETTINGS };

  async onload(): Promise<void> {
    await this.loadSettings();

    this.registerView(EPUB_VIEW_TYPE, (leaf: WorkspaceLeaf) => {
      return new UpstreamEpubView(leaf, this);
    });

    try {
      this.registerExtensions(["epub"], EPUB_VIEW_TYPE);
    } catch (error) {
      console.warn("Jarvis Reader could not register the EPUB extension.", error);
    }

    this.registerEvent(
      this.app.workspace.on("file-menu", (menu: Menu, file: TAbstractFile) => {
        if (!(file instanceof TFile) || file.extension.toLowerCase() !== "pdf") return;
        menu.addItem((item) => {
          item
            .setTitle("打开或创建书籍笔记")
            .setIcon("file-text")
            .onClick(async () => {
              await openOrCreateBookNote(this.app, file, await getPdfTocMarkdown(this.app, file), this.settings);
            });
        });
      }),
    );
  }

  async loadSettings(): Promise<void> {
    const stored = (await this.loadData()) as Partial<UpstreamReaderSettings> | null;
    this.settings = { ...DEFAULT_UPSTREAM_SETTINGS, ...(stored || {}) };
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
