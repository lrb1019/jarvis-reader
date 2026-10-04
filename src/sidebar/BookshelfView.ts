import { ItemView, WorkspaceLeaf, TFile, Notice, setIcon, Menu } from "obsidian";
import { EpubView } from "../EpubView";
import { HighlightsPanelController } from "./HighlightsView";
import type { BookBookmark } from "../types";
import type JarvisReaderPlugin from "../main";

declare global {
  interface Window {
    _arCoverQueue: any;
    JarvisReader_ePub: any;
  }
}

export const BOOKSHELF_VIEW_TYPE = "jarvis-reader-bookshelf";
export function isReadableBook(file: any) {
  return file instanceof TFile && ["epub", "pdf"].includes(file.extension.toLowerCase());
}

export class JarvisReaderBookshelfView extends ItemView {
  plugin: JarvisReaderPlugin;
  activePanel: string;
  panelScroll: Record<string, number>;
  pendingRevealHighlightId: string | null;
  highlightsPanel: HighlightsPanelController | null;
  sidebarResizeObserver: any;
  sidebarResizeTargets: HTMLElement[];
  sidebarWidthGuardOriginal: Map<HTMLElement, any>;
  bookmarkUpdateHandler: (event: Event) => void;

  constructor(leaf: WorkspaceLeaf, plugin: JarvisReaderPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.activePanel = "toc";
    this.panelScroll = { toc: 0, bookmarks: 0, highlights: 0 };
    this.pendingRevealHighlightId = null;
    this.highlightsPanel = null;
    this.sidebarResizeObserver = null;
    this.sidebarResizeTargets = [];
    this.sidebarWidthGuardOriginal = new Map();
    this.bookmarkUpdateHandler = (event) => {
      const activeEpub = this.getActiveEpubView();
      const updatedPath = (event as CustomEvent<string | undefined>).detail;
      if (updatedPath && updatedPath !== activeEpub?.file?.path) return;
      this.render();
    };
  }
  getViewType() {
    return BOOKSHELF_VIEW_TYPE;
  }
  getDisplayText() {
    return "阅读辅助边栏";
  }
  getIcon() {
    return "library-big";
  }
  async onOpen() {
    window.addEventListener("jarvis-reader-bookmarks-updated", this.bookmarkUpdateHandler);
    this.render();
  }
  async onClose() {
    window.removeEventListener("jarvis-reader-bookmarks-updated", this.bookmarkUpdateHandler);
    this.clearSidebarWidthGuard();
  }

  getActiveEpubView() {
    const activeView = this.app.workspace.activeLeaf?.view;
    if (activeView instanceof EpubView) return activeView;
    if (this.plugin.activeReaderView instanceof EpubView) return this.plugin.activeReaderView;
    let epubView = null;
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (!epubView && leaf.view instanceof EpubView) {
        epubView = leaf.view;
      }
    });
    return epubView;
  }
  setActiveReader(reader: any, preferredPanel = "toc") {
    if (reader) {
      this.plugin.activeReaderView = reader;
    }
    if (preferredPanel) {
      this.activePanel = preferredPanel;
    }
    this.render();
  }
  clearActiveReader(reader: any) {
    if (reader && this.plugin.activeReaderView !== reader) return;
    this.plugin.activeReaderView = null;
    this.activePanel = "toc";
    if (this.highlightsPanel) {
      this.highlightsPanel.reader = null;
      this.highlightsPanel.pendingRevealHighlightId = null;
    }
    this.render();
  }
  revealHighlight(highlightId: string) {
    this.pendingRevealHighlightId = highlightId || null;
    this.activePanel = "highlights";
    this.render();
  }

  makePanelButton(container: HTMLElement, label: string, icon: string, active: boolean, disabled: boolean, onClick: () => void) {
    const button = container.createEl("button", {
      cls: active ? "jarvis-reader-sidebar-tab is-active" : "jarvis-reader-sidebar-tab",
      attr: {
        "aria-label": label,
        title: label,
        "aria-pressed": String(active)
      }
    });
    setIcon(button, icon);
    button.disabled = !!disabled;
    button.onclick = (event) => {
      event.preventDefault();
      if (disabled) {
        new Notice("请先打开 EPUB");
        return;
      }
      onClick();
    };
    return button;
  }
  renderToolbar(container: HTMLElement, activeEpub: EpubView | null) {
    const toolbar = container.createDiv({ cls: "jarvis-reader-sidebar-toolbar" });
    const panelActions = toolbar.createDiv({ cls: "jarvis-reader-sidebar-panel-actions" });
    const panels = [
      { id: "toc", label: "目录导航", icon: "list" },
      { id: "bookmarks", label: "已保存的书签", icon: "book-marked" },
      { id: "highlights", label: "笔记高亮", icon: "file-text" },
    ] as const;
    for (const panel of panels) {
      this.makePanelButton(panelActions, panel.label, panel.icon, this.activePanel === panel.id, !activeEpub, () => {
        this.activePanel = panel.id;
        this.render();
      });
    }
  }

  restorePanelScroll(key: string, listEl: HTMLElement) {
    const scrollTop = this.panelScroll[key] || 0;
    if (!listEl || !scrollTop) return;
    window.requestAnimationFrame(() => {
      listEl.scrollTop = scrollTop;
    });
  }
  bindPanelScroll(key: string, listEl: HTMLElement) {
    if (!listEl) return;
    listEl.addEventListener("scroll", () => {
      this.panelScroll[key] = listEl.scrollTop;
    });
  }

  async removeBookmark(activeEpub: any, bookmark: BookBookmark) {
    try {
      const removed = await this.plugin.bookStateService.removeBookmark(activeEpub.file.path, bookmark);
      if (!removed) return;
      window.dispatchEvent(new CustomEvent("jarvis-reader-bookmarks-updated", { detail: activeEpub.file.path }));
    } catch (error) {
      console.error("Failed to remove bookmark", error);
      new Notice("书签删除失败，原书签已保留。");
    }
  }

  renderBookmarksList(container: HTMLElement, activeEpub: any, bookmarks: BookBookmark[]) {
    if (!bookmarks.length) {
      container.createEl("div", {
        cls: "jarvis-reader-bookshelf-empty",
        text: "本书暂无书签。点击阅读页右上角的添加书签按钮即可保存当前位置。",
      });
      return;
    }
    const list = container.createDiv({ cls: "jarvis-reader-bookshelf-list jarvis-reader-bookmark-list" });
    this.restorePanelScroll("bookmarks", list);
    this.bindPanelScroll("bookmarks", list);
    for (const bookmark of [...bookmarks].sort((a, b) => b.created - a.created)) {
      const item = list.createDiv({ cls: "jarvis-reader-bookmark-item" });
      item.setAttribute("role", "button");
      item.setAttribute("tabindex", "0");
      const content = item.createDiv({ cls: "jarvis-reader-bookmark-content" });
      content.createDiv({ cls: "jarvis-reader-bookmark-title", text: bookmark.title || "未知章节" });
      content.createDiv({ cls: "jarvis-reader-bookmark-meta", text: new Date(bookmark.created).toLocaleString() });
      item.oncontextmenu = (event) => {
        event.preventDefault();
        event.stopPropagation();
        const menu = new Menu();
        menu.addItem(entry => entry.setTitle("删除").setIcon("trash").onClick(() => this.removeBookmark(activeEpub, bookmark)));
        menu.showAtMouseEvent(event);
      };
      item.onclick = () => activeEpub.jumpToCfi(bookmark.cfi);
      item.onkeydown = (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          activeEpub.jumpToCfi(bookmark.cfi);
        }
      };
    }
  }

  renderNavigationPanel(container: HTMLElement, activeEpub: any) {
    container.className = "jarvis-reader-sidebar-pane jarvis-reader-sidebar-toc-pane";
    container.empty();
    const bookmarks = activeEpub?.file
      ? this.plugin.settings.bookBookmarks?.[activeEpub.file.path] || []
      : [];
    if (this.activePanel === "bookmarks") {
      this.renderBookmarksList(container, activeEpub, bookmarks);
      return;
    }
    if (!activeEpub || !activeEpub.fileToc || !activeEpub.fileToc.length) {
      container.createEl("div", { cls: "jarvis-reader-bookshelf-empty", text: "当前书籍没有目录" });
      return;
    }
    const tocList = container.createDiv({ cls: "jarvis-reader-bookshelf-list jarvis-reader-toc-list" });
    this.restorePanelScroll("toc", tocList);
    this.bindPanelScroll("toc", tocList);
    let inferredTocDepth = 0;
    const inferFlatTocDepth = (label: string) => {
      const text = (label || "").trim();
      if (!text) return 0;
      if (/^(版权|封面|目录|序|序言|前言|代序|导言|引言|后记|附录|第.+[章节篇部卷]|[0-9]+[.?])/u.test(text)) {
        inferredTocDepth = 0;
        return 0;
      }
      if (/^([0-9]+|[一二三四五六七八九十百]+)[.?\s]/u.test(text) || /^[0-9]+\s+\S/u.test(text)) {
        inferredTocDepth = 1;
        return 1;
      }
      return inferredTocDepth > 0 ? Math.min(inferredTocDepth, 2) : 1;
    };
    const renderTocItems = (items: any[], depth: number) => {
      for (const item of items) {
        const label = item.label || item.href || "";
        const hasNestedItems = !!(item.subitems && item.subitems.length);
        const displayDepth = Math.min(depth > 0 || hasNestedItems ? depth : inferFlatTocDepth(label), 3);
        const tocItem = tocList.createEl("div", { cls: `jarvis-reader-toc-item is-depth-${displayDepth}` });
        tocItem.style.setProperty("--toc-depth", `${displayDepth}`);
        tocItem.setAttribute("role", "button");
        tocItem.setAttribute("tabindex", "0");
        tocItem.createEl("span", { cls: "jarvis-reader-toc-label", text: label });
        tocItem.onclick = () => {
          if (activeEpub && activeEpub.currentRendition && item.href) {
            try {
              activeEpub.currentRendition.display(item.href);
            } catch (error) {}
          }
        };
        tocItem.onkeydown = (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            tocItem.onclick(new MouseEvent('click') as any);
          }
        };
        if (item.subitems && item.subitems.length) {
          renderTocItems(item.subitems, depth + 1);
        }
      }
    };
    renderTocItems(activeEpub.fileToc, 0);
  }

  getHighlightsPanel() {
    if (!this.highlightsPanel) {
      this.highlightsPanel = new HighlightsPanelController(this.plugin);
    }
    return this.highlightsPanel;
  }
  renderHighlightsPanel(container: HTMLElement, activeEpub: any) {
    container.className = "jarvis-reader-sidebar-pane jarvis-reader-sidebar-highlights-pane";
    const panel = this.getHighlightsPanel();
    panel.app = this.app;
    panel.plugin = this.plugin;
    panel.contentEl = container;
    panel.reader = activeEpub || null;
    if (this.pendingRevealHighlightId) {
      panel.pendingRevealHighlightId = this.pendingRevealHighlightId;
      this.pendingRevealHighlightId = null;
    }
    panel.render();
  }

  clearSidebarWidthGuard() {
    if (this.sidebarResizeObserver) {
      this.sidebarResizeObserver.disconnect();
      this.sidebarResizeObserver = null;
    }
    for (const target of this.sidebarResizeTargets || []) {
      const original = this.sidebarWidthGuardOriginal.get(target);
      if (original) {
        target.style.minWidth = original.minWidth;
        target.style.width = original.width;
        target.style.flexBasis = original.flexBasis;
        target.style.flexShrink = original.flexShrink;
      } else {
        target.style.removeProperty("min-width");
        target.style.removeProperty("width");
        target.style.removeProperty("flex-basis");
        target.style.removeProperty("flex-shrink");
      }
    }
    this.sidebarResizeTargets = [];
    this.sidebarWidthGuardOriginal.clear();
    let el = this.containerEl;
    while (el) {
      if (el.classList && (el.classList.contains("workspace-leaf-content") || el.classList.contains("workspace-leaf") || el.classList.contains("workspace-tab-container") || el.classList.contains("workspace-tabs") || el.classList.contains("workspace-split") && el.classList.contains("mod-left-split"))) {
        el.style.removeProperty("min-width");
        el.style.removeProperty("flex-shrink");
      }
      el = el.parentElement;
    }
  }
  getSidebarWidthGuardTargets() {
    const targets = [];
    let el = this.containerEl;
    while (el) {
      if (el.classList && (el.classList.contains("workspace-leaf-content") || el.classList.contains("workspace-leaf") || el.classList.contains("workspace-tab-container") || el.classList.contains("workspace-tabs") || el.classList.contains("workspace-split") && el.classList.contains("mod-left-split"))) {
        targets.push(el);
      }
      el = el.parentElement;
    }
    return targets;
  }
  updateSidebarWidthGuard(activeEpub: any, body: HTMLElement) {
    this.clearSidebarWidthGuard();
  }

  render() {
    const container = this.contentEl;
    if (!container) return;
    const activeEpub = this.getActiveEpubView();
    if (!activeEpub) {
      this.activePanel = "toc";
    }
    container.empty();
    container.className = "view-content jarvis-reader-bookshelf-view jarvis-reader-sidebar-view";
    this.renderToolbar(container, activeEpub);
    const body = container.createDiv({ cls: "jarvis-reader-sidebar-body is-single" });
    
    if (!activeEpub) {
      const pane = body.createDiv({ cls: "jarvis-reader-sidebar-pane" });
      pane.createEl("div", { cls: "jarvis-reader-bookshelf-empty", text: "请打开一本图书以查看目录和笔记" });
      return;
    }

    this.clearSidebarWidthGuard();
    const pane = body.createDiv({ cls: "jarvis-reader-sidebar-pane" });
    if (this.activePanel === "highlights") {
      this.renderHighlightsPanel(pane, activeEpub);
    } else {
      this.renderNavigationPanel(pane, activeEpub);
    }
  }
}
