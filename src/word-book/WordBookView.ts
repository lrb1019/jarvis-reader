import { ItemView, WorkspaceLeaf } from "obsidian";
import * as React from "react";
import * as ReactDOM from "react-dom/client";
import type JarvisReaderPlugin from "../main";
import { WordBookApp } from "./WordBookApp";

export const WORD_BOOK_VIEW_TYPE = "jarvis-reader-word-book";

export class WordBookView extends ItemView {
  plugin: JarvisReaderPlugin;
  root: ReactDOM.Root | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: JarvisReaderPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() {
    return WORD_BOOK_VIEW_TYPE;
  }

  getDisplayText() {
    return "英语词条";
  }

  getIcon() {
    return "library";
  }

  async onOpen() {
    const container = this.contentEl;
    container.empty();
    container.addClass("jarvis-reader-word-book-view");

    this.root = ReactDOM.createRoot(container);
    this.root.render(React.createElement(WordBookApp, { plugin: this.plugin }));
  }

  async onClose() {
    if (this.root) {
      this.root.unmount();
      this.root = null;
    }
    this.contentEl.empty();
  }
}
