import { FileView, normalizePath, Notice, requestUrl, TFile, WorkspaceLeaf } from "obsidian";
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
import { buildWordAsset } from "../core/word-assets.ts";
import { deleteWordEntryInContent, upsertWordEntryInContent } from "../core/word-markdown.ts";
import type { TranslationResult } from "../translation/core.ts";
import { translateSelection } from "../translation/service.ts";
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
        bookPath={file.path}
        wordAssets={Object.values(settings.wordAssets)}
        instantTranslation={settings.experimentalInstantTranslation.enabled}
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
        onTranslate={async (selection, forceAi, localOnly) => {
          return translateSelection(
            settings,
            selection.quote,
            selection.sentence || selection.quote,
            { read: (path) => this.app.vault.adapter.read(path) },
            {
              post: async ({ url, headers, body }) => {
                const response = await requestUrl({
                  url,
                  method: "POST",
                  headers,
                  body: JSON.stringify(body),
                });
                if (response.status >= 400) {
                  throw new Error((response.text || `HTTP ${response.status}`).slice(0, 280));
                }
                return response.json;
              },
            },
            forceAi,
            localOnly,
          );
        }}
        onSaveWordAsset={async (selection, translation) => {
          const key = this.getTranslationKey(selection, translation);
          const previous = key ? settings.wordAssets[key] : undefined;
          const asset = buildWordAsset(
            { path: file.path, title: file.basename },
            selection,
            translation,
            settings,
            previous,
          );
          settings.wordAssets[asset.lemma] = asset;
          try {
            await this.pluginBridge.saveSettings("word-asset-save");
          } catch (error) {
            if (previous) settings.wordAssets[asset.lemma] = previous;
            else delete settings.wordAssets[asset.lemma];
            throw error;
          }
          await this.writeWordAssetNote(asset);
          new Notice("已保存到翻译卡片库");
          return asset;
        }}
        onDeleteWordAsset={async (asset) => {
          const previous = settings.wordAssets[asset.lemma];
          delete settings.wordAssets[asset.lemma];
          try {
            await this.pluginBridge.saveSettings("word-asset-delete");
          } catch (error) {
            if (previous) settings.wordAssets[asset.lemma] = previous;
            throw error;
          }
          await this.deleteWordAssetNote(asset);
          new Notice("词条已彻底删除");
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

  private getTranslationKey(
    selection: { quote: string; cfiRange: string },
    translation: TranslationResult,
  ): string {
    if (!translation.isWord) {
      let hash = 0;
      const source = `${selection.cfiRange}|${selection.quote}`;
      for (let index = 0; index < source.length; index += 1) {
        hash = (hash * 31 + source.charCodeAt(index)) >>> 0;
      }
      return `sentence-${hash.toString(36)}`;
    }
    return translation.lemma;
  }

  private async writeWordAssetNote(asset: import("../domain/index.ts").WordAsset): Promise<void> {
    await this.ensureParentFolder(asset.notePath);
    const existing = this.app.vault.getAbstractFileByPath(asset.notePath);
    if (existing instanceof TFile) {
      const content = await this.app.vault.read(existing);
      await this.app.vault.modify(existing, upsertWordEntryInContent(content, asset));
      return;
    }
    await this.app.vault.create(
      asset.notePath,
      upsertWordEntryInContent(`# ${this.file?.basename || "Words"}\n`, asset),
    );
  }

  private async deleteWordAssetNote(asset: import("../domain/index.ts").WordAsset): Promise<void> {
    const existing = this.app.vault.getAbstractFileByPath(asset.notePath);
    if (!(existing instanceof TFile)) return;
    const content = await this.app.vault.read(existing);
    const next = deleteWordEntryInContent(content, asset);
    if (next !== content) await this.app.vault.modify(existing, next);
  }
}
