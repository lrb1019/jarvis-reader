import { FileView, TFile, WorkspaceLeaf } from "obsidian";
import { createRoot, type Root } from "react-dom/client";
import type { BookProgress, JarvisReaderSettings } from "../domain/index.ts";
import { clampReaderLineHeight, clampReaderZoom, type EpubTocItem } from "./core.ts";
import { JarvisEpubReader } from "./EpubReader.tsx";

export const EPUB_VIEW_TYPE = "epub";

export interface ReaderPluginBridge {
  settings: JarvisReaderSettings;
  saveSettings(): Promise<void>;
}

export class EpubFileView extends FileView {
  private root: Root | null = null;
  private toc: EpubTocItem[] = [];

  constructor(
    leaf: WorkspaceLeaf,
    private readonly pluginBridge: ReaderPluginBridge,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return EPUB_VIEW_TYPE;
  }

  canAcceptExtension(extension: string): boolean {
    return extension.toLowerCase() === "epub";
  }

  getToc(): EpubTocItem[] {
    return this.toc;
  }

  async onLoadFile(file: TFile): Promise<void> {
    this.root?.unmount();
    this.contentEl.empty();
    const contents = await this.app.vault.adapter.readBinary(file.path);
    this.root = createRoot(this.contentEl);
    this.renderReader(file, contents);
  }

  onunload(): void {
    this.root?.unmount();
    this.root = null;
  }

  private renderReader(file: TFile, contents: ArrayBuffer): void {
    const settings = this.pluginBridge.settings;
    this.root?.render(
      <JarvisEpubReader
        contents={contents}
        title={file.basename}
        scrolled={settings.scrolledView}
        singlePage={settings.singlePageView}
        readerZoom={clampReaderZoom(settings.readerZoom)}
        readerLineHeight={clampReaderLineHeight(settings.readerLineHeight)}
        initLocation={settings.bookInitLocations[file.path] ?? null}
        onLocationChange={(location) => {
          settings.bookInitLocations[file.path] = location;
          void this.pluginBridge.saveSettings();
        }}
        onProgress={(progress: BookProgress) => {
          settings.bookProgress[file.path] = progress;
          void this.pluginBridge.saveSettings();
        }}
        onTocChange={(toc) => {
          this.toc = toc;
        }}
        onModeChange={(mode) => {
          settings.singlePageView = mode.singlePage;
          settings.scrolledView = mode.scrolled;
          void this.pluginBridge.saveSettings().then(() => this.onLoadFile(file));
        }}
        onZoomChange={(delta) => {
          settings.readerZoom = clampReaderZoom(settings.readerZoom + delta);
          void this.pluginBridge.saveSettings();
          this.renderReader(file, contents);
        }}
        onLineHeightChange={(delta) => {
          settings.readerLineHeight = clampReaderLineHeight(
            settings.readerLineHeight + delta,
          );
          void this.pluginBridge.saveSettings();
          this.renderReader(file, contents);
        }}
      />,
    );
  }
}
