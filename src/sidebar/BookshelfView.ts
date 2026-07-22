import { ItemView, WorkspaceLeaf, TFile, Notice } from "obsidian";
import { EpubView } from "../EpubView";
import { HighlightsPanelController } from "./HighlightsView";
import type { BookBookmark } from "../types";
import { confirmDestructiveAction } from "../utils";
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
  activeNavigationPanel: "toc" | "bookmarks";
  dualHighlightsMode: boolean;
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
    this.activeNavigationPanel = "toc";
    this.dualHighlightsMode = false;
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
    return "jarvis-library-big";
  }
  async onOpen() {
    window.addEventListener("jarvis-reader-bookmarks-updated", this.bookmarkUpdateHandler);
    this.render();
  }
  async onClose() {
    window.removeEventListener("jarvis-reader-bookmarks-updated", this.bookmarkUpdateHandler);
    this.clearSidebarWidthGuard();
  }

  getLayoutMode() {
    return this.plugin.settings.sidebarLayoutMode === "dual" ? "dual" : "single";
  }
  getSidebarPaneSplit() {
    const parsed = parseFloat(this.plugin.settings.sidebarPaneSplit);
    return Number.isFinite(parsed) ? Math.min(75, Math.max(25, parsed)) : 48;
  }
  applySidebarPaneSplit(first: HTMLElement, second: HTMLElement, value: number) {
    const split = Math.min(75, Math.max(25, value));
    first.style.flex = `0 0 ${split}%`;
    second.style.flex = "1 1 0";
  }
  attachSidebarSplitter(splitter: HTMLElement, body: HTMLElement, first: HTMLElement, second: HTMLElement) {
    splitter.onpointerdown = (event) => {
      event.preventDefault();
      const pointerId = event.pointerId;
      let latestSplit = this.getSidebarPaneSplit();
      body.classList.add("is-resizing");
      splitter.classList.add("is-dragging");
      if (typeof splitter.setPointerCapture === "function") {
        splitter.setPointerCapture(pointerId);
      }
      const onPointerMove = (moveEvent: PointerEvent) => {
        const rect = body.getBoundingClientRect();
        if (!rect.width) return;
        latestSplit = ((moveEvent.clientX - rect.left) / rect.width) * 100;
        this.applySidebarPaneSplit(first, second, latestSplit);
      };
      const onPointerUp = async () => {
        document.removeEventListener("pointermove", onPointerMove);
        document.removeEventListener("pointerup", onPointerUp);
        body.classList.remove("is-resizing");
        splitter.classList.remove("is-dragging");
        if (typeof splitter.releasePointerCapture === "function") {
          try {
            splitter.releasePointerCapture(pointerId);
          } catch (error) {}
        }
        this.plugin.settings.sidebarPaneSplit = Math.min(75, Math.max(25, latestSplit));
        await this.plugin.saveSettings();
      };
      document.addEventListener("pointermove", onPointerMove);
      document.addEventListener("pointerup", onPointerUp);
    };
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
    if (this.getLayoutMode() === "single" && preferredPanel) {
      this.activePanel = preferredPanel;
    }
    this.render();
  }
  clearActiveReader(reader: any) {
    if (reader && this.plugin.activeReaderView !== reader) return;
    this.plugin.activeReaderView = null;
    this.activePanel = "toc";
    this.dualHighlightsMode = false;
    if (this.highlightsPanel) {
      this.highlightsPanel.reader = null;
      this.highlightsPanel.pendingRevealHighlightId = null;
    }
    this.render();
  }
  revealHighlight(highlightId: string) {
    this.pendingRevealHighlightId = highlightId || null;
    if (this.getLayoutMode() === "single") {
      this.activePanel = "highlights";
    }
    this.render();
  }

  makePanelButton(container: HTMLElement, label: string, icon: string, active: boolean, disabled: boolean, onClick: () => void) {
    const button = container.createEl("button", {
      cls: active ? "jarvis-reader-sidebar-tab is-active" : "jarvis-reader-sidebar-tab",
      attr: {
        "aria-label": label
      }
    });
    button.innerHTML = icon;
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
  async toggleLayoutMode() {
    this.plugin.settings.sidebarLayoutMode = this.getLayoutMode() === "single" ? "dual" : "single";
    await this.plugin.saveSettings();
    this.render();
  }
  renderToolbar(container: HTMLElement, activeEpub: any) {
    const mode = this.getLayoutMode();
    const hasReader = !!activeEpub;
    const toolbar = container.createDiv({ cls: "jarvis-reader-sidebar-toolbar" });
    const layoutButton = toolbar.createEl("button", {
      cls: "jarvis-reader-sidebar-tab jarvis-reader-sidebar-layout-toggle",
      attr: {
        "aria-label": mode === "single" ? "切换到双栏" : "切换到单栏"
      }
    });
    layoutButton.innerHTML = mode === "single" 
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2"></rect><path d="M12 4v16"></path></svg>' 
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2"></rect><path d="M9 4v16"></path><path d="m14 9-3 3 3 3"></path></svg>';
    layoutButton.onclick = () => this.toggleLayoutMode();
    
    const panelActions = toolbar.createDiv({ cls: "jarvis-reader-sidebar-panel-actions" });
    
    if (mode === "single") {
      this.makePanelButton(panelActions, "导航", '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V4h4l1 16H4z"></path><path d="M11 20V4h3v16h-3z"></path><path d="M16 4h4v16h-4l-1-16z"></path></svg>', this.activePanel === "toc", !hasReader, () => {
        this.activePanel = "toc";
        this.render();
      });
      this.makePanelButton(panelActions, "读书笔记", '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15.5 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.5L15.5 3z"></path><polyline points="15 3 15 9 21 9"></polyline></svg>', this.activePanel === "highlights", !hasReader, () => {
        this.activePanel = "highlights";
        this.render();
      });
    } else {
      // In dual mode, both are shown side-by-side, so the tab buttons are less necessary to act as switches.
      // But we can show them as purely visual indicators, or we can just hide them.
      // For simplicity, we just won't show the panel switchers in dual mode.
    }
  }

  getDisplayBookTitle(activeEpub: any) {
    const bookTitle = activeEpub && activeEpub.file ? activeEpub.file.basename : "";
    let displayTitle = bookTitle;
    const m = displayTitle.match(/^(.*?)(?:[?(](.*?)[?)])?(?:\s*[-_]\s*.*)?$/);
    if (m && m[1]) displayTitle = m[1].trim();
    return displayTitle;
  }
  renderPaneHeader(container: HTMLElement, title: string, subtitle = "", action: any = null) {
    const header = container.createDiv({ cls: "jarvis-reader-bookshelf-header" });
    const titleWrap = header.createDiv({ cls: "jarvis-reader-bookshelf-header-row" });
    titleWrap.createEl("div", { cls: "jarvis-reader-bookshelf-title", text: title });
    if (action) {
      const button = titleWrap.createEl("button", {
        cls: "jarvis-reader-bookshelf-header-action",
        attr: {
          "aria-label": action.label,
          title: action.label
        }
      });
      button.innerHTML = action.icon;
      button.onclick = (event) => {
        event.preventDefault();
        action.onClick();
      };
    }
    if (subtitle) {
      header.createEl("div", { cls: "jarvis-reader-bookshelf-count", text: subtitle });
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

  renderNavigationTabs(container: HTMLElement) {
    const tabs = container.createDiv({ cls: "jarvis-reader-navigation-tabs" });
    const items: Array<{ key: "toc" | "bookmarks"; label: string }> = [
      { key: "toc", label: "目录" },
      { key: "bookmarks", label: "书签" },
    ];
    for (const item of items) {
      const button = tabs.createEl("button", {
        cls: this.activeNavigationPanel === item.key
          ? "jarvis-reader-navigation-tab is-active"
          : "jarvis-reader-navigation-tab",
        text: item.label,
        attr: { "aria-pressed": String(this.activeNavigationPanel === item.key) },
      });
      button.onclick = () => {
        this.activeNavigationPanel = item.key;
        this.render();
      };
    }
  }

  async removeBookmark(activeEpub: any, bookmark: BookBookmark) {
    const confirmed = await confirmDestructiveAction(this.app, "删除书签", `确认删除书签“${bookmark.title}”吗？`);
    if (!confirmed) return;
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
        text: "本书暂无书签。点击阅读器侧边的书签按钮即可保存当前位置。",
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
      item.setAttribute("aria-label", `跳转到书签：${bookmark.title}`);
      const content = item.createDiv({ cls: "jarvis-reader-bookmark-content" });
      content.createDiv({ cls: "jarvis-reader-bookmark-title", text: bookmark.title || "未知章节" });
      content.createDiv({ cls: "jarvis-reader-bookmark-meta", text: new Date(bookmark.created).toLocaleString() });
      const deleteButton = item.createEl("button", {
        cls: "jarvis-reader-bookmark-delete",
        attr: { "aria-label": `删除书签：${bookmark.title}`, title: "删除书签" },
      });
      deleteButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"></path><path d="M8 6V4h8v2"></path><path d="M19 6l-1 14H6L5 6"></path><path d="M10 11v5"></path><path d="M14 11v5"></path></svg>';
      deleteButton.onclick = (event) => {
        event.stopPropagation();
        void this.removeBookmark(activeEpub, bookmark);
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
    this.renderPaneHeader(container, "导航", this.getDisplayBookTitle(activeEpub));
    this.renderNavigationTabs(container);
    if (this.activeNavigationPanel === "bookmarks") {
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
    const mode = this.getLayoutMode();
    if (!activeEpub) {
      this.activePanel = "toc";
    }
    container.empty();
    container.className = "view-content jarvis-reader-bookshelf-view jarvis-reader-sidebar-view";
    this.renderToolbar(container, activeEpub);
    const body = container.createDiv({ cls: mode === "dual" && activeEpub ? "jarvis-reader-sidebar-body is-dual" : "jarvis-reader-sidebar-body is-single" });
    
    if (!activeEpub) {
      const pane = body.createDiv({ cls: "jarvis-reader-sidebar-pane" });
      this.renderPaneHeader(pane, "辅助边栏", "");
      pane.createEl("div", { cls: "jarvis-reader-bookshelf-empty", text: "请打开一本图书以查看目录和笔记" });
      return;
    }

    if (mode === "dual") {
      this.updateSidebarWidthGuard(activeEpub, body);
      const first = body.createDiv({ cls: "jarvis-reader-sidebar-pane" });
      const splitter = body.createDiv({
        cls: "jarvis-reader-sidebar-splitter",
        attr: {
          role: "separator",
          "aria-orientation": "vertical",
          title: "拖动调整宽度"
        }
      });
      const second = body.createDiv({ cls: "jarvis-reader-sidebar-pane" });
      this.applySidebarPaneSplit(first, second, this.getSidebarPaneSplit());
      this.attachSidebarSplitter(splitter, body, first, second);
      
      this.renderNavigationPanel(first, activeEpub);
      this.renderHighlightsPanel(second, activeEpub);
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
