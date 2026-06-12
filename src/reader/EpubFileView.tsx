import { FileView, normalizePath, Notice, TFile, WorkspaceLeaf } from "obsidian";
import { createRoot, type Root } from "react-dom/client";
import type { BookHighlight, BookProgress, JarvisReaderSettings } from "../domain/index.ts";
import {
  createBookHighlight,
  deleteBookHighlight,
  deleteHighlightNoteBlock,
  updateBookHighlight,
  upsertBookHighlight,
  upsertHighlightNoteBlock,
} from "../core/highlights.ts";
import { clampReaderLineHeight, clampReaderZoom, type EpubTocItem } from "./core.ts";
import { JarvisEpubReader } from "./EpubReader.tsx";

export const EPUB_VIEW_TYPE = "epub";

export interface ReaderPluginBridge {
  settings: JarvisReaderSettings;
  saveSettings(reason?: string): Promise<void>;
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
        highlights={settings.bookHighlights[file.path] || []}
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
        onCreateHighlight={async (selection) => {
          const highlight = createBookHighlight({
            ...selection,
            bookPath: file.path,
            bookTitle: file.basename,
            notePath: this.getBookNotePath(file),
          });
          await this.writeHighlightNote(highlight);
          settings.bookHighlights[file.path] = upsertBookHighlight(
            settings.bookHighlights[file.path] || [],
            highlight,
          );
          await this.pluginBridge.saveSettings("highlight-create");
          new Notice(highlight.comment ? "想法已保存" : "高亮已保存");
          return highlight;
        }}
        onUpdateHighlight={async (highlight, changes) => {
          const updated = updateBookHighlight(highlight, changes);
          await this.writeHighlightNote(updated);
          settings.bookHighlights[file.path] = upsertBookHighlight(
            settings.bookHighlights[file.path] || [],
            updated,
          );
          await this.pluginBridge.saveSettings("highlight-update");
          new Notice(updated.comment ? "想法已更新" : "高亮已更新");
          return updated;
        }}
        onDeleteHighlight={async (highlight) => {
          await this.deleteHighlightNote(highlight);
          settings.bookHighlights[file.path] = deleteBookHighlight(
            settings.bookHighlights[file.path] || [],
            highlight.id,
          );
          await this.pluginBridge.saveSettings("highlight-delete");
          new Notice("标注已删除");
        }}
      />,
    );
  }

  private getBookNotePath(file: TFile): string {
    const folder = this.pluginBridge.settings.bookNoteFolder || file.parent?.path || "";
    return normalizePath(`${folder ? `${folder}/` : ""}${file.basename}.md`);
  }

  private async ensureParentFolder(path: string): Promise<void> {
    const parts = path.split("/").slice(0, -1);
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!(await this.app.vault.adapter.exists(current))) {
        await this.app.vault.createFolder(current);
      }
    }
  }

  private async writeHighlightNote(highlight: BookHighlight): Promise<void> {
    await this.ensureParentFolder(highlight.notePath);
    const existing = this.app.vault.getAbstractFileByPath(highlight.notePath);
    if (existing instanceof TFile) {
      const content = await this.app.vault.read(existing);
      await this.app.vault.modify(existing, upsertHighlightNoteBlock(content, highlight));
      return;
    }
    await this.app.vault.create(
      highlight.notePath,
      upsertHighlightNoteBlock(`# ${highlight.bookTitle}\n\n`, highlight),
    );
  }

  private async deleteHighlightNote(highlight: BookHighlight): Promise<void> {
    const existing = this.app.vault.getAbstractFileByPath(highlight.notePath);
    if (!(existing instanceof TFile)) return;
    const content = await this.app.vault.read(existing);
    await this.app.vault.modify(
      existing,
      deleteHighlightNoteBlock(content, highlight.blockId),
    );
  }
}
