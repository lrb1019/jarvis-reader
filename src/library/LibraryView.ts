import { ItemView, WorkspaceLeaf } from "obsidian";
import * as React from "react";
import * as ReactDOM from "react-dom/client";
import type JarvisReaderPlugin from "../main";
import { LibraryApp } from "./LibraryApp";

export const LIBRARY_VIEW_TYPE = "jarvis-reader-library";

export class LibraryView extends ItemView {
  plugin: JarvisReaderPlugin;
  root: ReactDOM.Root | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: JarvisReaderPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() {
    return LIBRARY_VIEW_TYPE;
  }

  getDisplayText() {
    return "图书库";
  }

  getIcon() {
    return "jarvis-logo";
  }

  async onOpen() {
    const container = this.contentEl;
    container.empty();
    container.addClass("jarvis-reader-library-view");

    this.root = ReactDOM.createRoot(container);
    this.root.render(React.createElement(LibraryApp, { plugin: this.plugin }));
  }

  async onClose() {
    if (this.root) {
      this.root.unmount();
      this.root = null;
    }
    this.contentEl.empty();
  }
}
