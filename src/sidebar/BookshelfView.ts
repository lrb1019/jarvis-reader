import { ItemView, WorkspaceLeaf, TFile, Notice } from "obsidian";
import { EpubView } from "../EpubView";
import { getBookshelfProgressLabel } from "../progress";
import { JarvisReaderHighlightsView } from "./HighlightsView";
import type JarvisReaderPlugin from "../main";

declare global {
  interface Window {
    _arCoverQueue: any;
    JarvisReader_ePub: any;
  }
}

export const HIGHLIGHTS_VIEW_TYPE = "jarvis-reader-highlights";
export const BOOKSHELF_VIEW_TYPE = "jarvis-reader-bookshelf";
export function isReadableBook(file) {
  return file instanceof TFile && ["epub", "pdf"].includes(file.extension.toLowerCase());
}
export class JarvisReaderBookshelfView extends ItemView {
  plugin: JarvisReaderPlugin;
  activePanel: string;
  dualHighlightsMode: boolean;
  panelScroll: Record<string, number>;
  pendingRevealHighlightId: string | null;
  highlightsPanel: any;
  sidebarResizeObserver: any;
  sidebarResizeTargets: HTMLElement[];
  sidebarWidthGuardOriginal: Map<HTMLElement, any>;

  constructor(leaf: WorkspaceLeaf, plugin: JarvisReaderPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.activePanel = "bookshelf";
    this.dualHighlightsMode = false;
    this.panelScroll = { bookshelf: 0, toc: 0 };
    this.pendingRevealHighlightId = null;
    this.highlightsPanel = null;
    this.sidebarResizeObserver = null;
    this.sidebarResizeTargets = [];
    this.sidebarWidthGuardOriginal = /* @__PURE__ */ new Map();
  }
  getViewType() {
    return BOOKSHELF_VIEW_TYPE;
  }
  getDisplayText() {
    return "Jarvis Reader";
  }
  getIcon() {
    return "library";
  }
  async onOpen() {
    this.render();
  }
  async onClose() {
    this.clearSidebarWidthGuard();
  }
  getBooks() {
    return this.app.vault.getFiles().filter((file) => file instanceof TFile && file.extension.toLowerCase() === "epub").sort((a, b) => a.basename.localeCompare(b.basename));
  }
  getProgress(file) {
    var _a;
    return ((_a = this.plugin.settings.bookProgress) == null ? void 0 : _a[file.path]) || null;
  }
  getLayoutMode() {
    return this.plugin.settings.sidebarLayoutMode === "dual" ? "dual" : "single";
  }
  getSidebarPaneSplit() {
    const parsed = parseFloat(this.plugin.settings.sidebarPaneSplit);
    return Number.isFinite(parsed) ? Math.min(75, Math.max(25, parsed)) : 48;
  }
  applySidebarPaneSplit(first, second, value) {
    const split = Math.min(75, Math.max(25, value));
    first.style.flex = `0 0 ${split}%`;
    second.style.flex = "1 1 0";
  }
  attachSidebarSplitter(splitter, body, first, second) {
    splitter.onpointerdown = (event) => {
      event.preventDefault();
      const pointerId = event.pointerId;
      let latestSplit = this.getSidebarPaneSplit();
      body.classList.add("is-resizing");
      splitter.classList.add("is-dragging");
      if (typeof splitter.setPointerCapture === "function") {
        splitter.setPointerCapture(pointerId);
      }
      const onPointerMove = (moveEvent) => {
        const rect = body.getBoundingClientRect();
        if (!rect.width)
          return;
        latestSplit = (moveEvent.clientX - rect.left) / rect.width * 100;
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
          } catch (error) {
          }
        }
        this.plugin.settings.sidebarPaneSplit = Math.min(75, Math.max(25, latestSplit));
        await this.plugin.saveSettings();
      };
      document.addEventListener("pointermove", onPointerMove);
      document.addEventListener("pointerup", onPointerUp);
    };
  }
  getActiveEpubView() {
    var _a;
    const activeView = (_a = this.app.workspace.activeLeaf) == null ? void 0 : _a.view;
    if (activeView instanceof EpubView)
      return activeView;
    if (this.plugin.activeReaderView instanceof EpubView)
      return this.plugin.activeReaderView;
    let epubView = null;
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (!epubView && leaf.view instanceof EpubView) {
        epubView = leaf.view;
      }
    });
    return epubView;
  }
  setActiveReader(reader, preferredPanel = "toc") {
    if (reader) {
      this.plugin.activeReaderView = reader;
    }
    if (this.getLayoutMode() === "single" && preferredPanel) {
      this.activePanel = preferredPanel;
    }
    if (this.getLayoutMode() === "dual" && preferredPanel === "highlights") {
      this.dualHighlightsMode = true;
    }
    this.render();
  }
  clearActiveReader(reader) {
    if (reader && this.plugin.activeReaderView !== reader)
      return;
    this.plugin.activeReaderView = null;
    this.activePanel = "bookshelf";
    this.dualHighlightsMode = false;
    if (this.highlightsPanel) {
      this.highlightsPanel.reader = null;
      this.highlightsPanel.pendingRevealHighlightId = null;
    }
    this.render();
  }
  revealHighlight(highlightId) {
    this.pendingRevealHighlightId = highlightId || null;
    if (this.getLayoutMode() === "single") {
      this.activePanel = "highlights";
    } else {
      this.dualHighlightsMode = true;
    }
    this.render();
  }
  getCoverCacheKey(file) {
    var _a, _b;
    return `${file.path}|${((_a = file.stat) == null ? void 0 : _a.mtime) || 0}|${((_b = file.stat) == null ? void 0 : _b.size) || 0}`;
  }
  applyCover(cover, dataUrl) {
    if (!cover || !cover.isConnected || !dataUrl)
      return;
    cover.style.background = `url("${dataUrl}") center/cover`;
    const titleEl = cover.querySelector(".jarvis-reader-bookshelf-cover-title");
    if (titleEl) {
      titleEl.style.display = "none";
    }
  }
  createCoverThumbnail(url) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = 108;
          canvas.height = 152;
          const context = canvas.getContext("2d");
          if (!context) {
            reject(new Error("No canvas context."));
            return;
          }
          const ratio = Math.max(canvas.width / image.width, canvas.height / image.height);
          const width = image.width * ratio;
          const height = image.height * ratio;
          const x = (canvas.width - width) / 2;
          const y = (canvas.height - height) / 2;
          context.drawImage(image, x, y, width, height);
          resolve(canvas.toDataURL("image/jpeg", 0.72));
        } catch (error) {
          reject(error);
        }
      };
      image.onerror = reject;
      image.src = url;
    });
  }
  async loadCachedCover(file, cover) {
    if (file.extension.toLowerCase() !== "epub")
      return;
    if (!this.plugin.settings.bookCoverCache) {
      this.plugin.settings.bookCoverCache = {};
    }
    const key = this.getCoverCacheKey(file);
    const cached = this.plugin.settings.bookCoverCache[key];
    if (cached && cached.dataUrl) {
      this.applyCover(cover, cached.dataUrl);
      return;
    }
    if (!window._arCoverQueue) {
      window._arCoverQueue = Promise.resolve();
    }
    window._arCoverQueue = window._arCoverQueue.then(async () => {
      if (!cover.isConnected)
        return;
      try {
        const buffer = await this.app.vault.readBinary(file);
        const epubFn = window.JarvisReader_ePub;
        if (!epubFn)
          return;
        const book = epubFn(buffer.slice(0));
        await book.opened;
        const coverUrl = await book.coverUrl();
        if (!coverUrl)
          return;
        const dataUrl = await this.createCoverThumbnail(coverUrl);
        this.plugin.settings.bookCoverCache[key] = {
          dataUrl,
          updated: new Date().toISOString()
        };
        const keys = Object.keys(this.plugin.settings.bookCoverCache);
        if (keys.length > 200) {
          for (const oldKey of keys.slice(0, keys.length - 200)) {
            delete this.plugin.settings.bookCoverCache[oldKey];
          }
        }
        await this.plugin.saveSettings();
        this.applyCover(cover, dataUrl);
      } catch (error) {
      }
    });
  }
  async openBook(file) {
    const leaf = this.app.workspace.getLeaf(true);
    this.activePanel = "toc";
    await leaf.openFile(file, { active: true });
    this.render();
  }
  makePanelButton(container, label, icon, active, disabled, onClick) {
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
        new Notice("\u8bf7\u5148\u6253\u5f00 EPUB");
        return;
      }
      onClick();
    };
    return button;
  }
  async toggleLayoutMode() {
    this.plugin.settings.sidebarLayoutMode = this.getLayoutMode() === "single" ? "dual" : "single";
    await this.plugin.saveSettings();
    if (this.getLayoutMode() === "single" && this.activePanel === "bookshelf" && this.getActiveEpubView()) {
      this.activePanel = "toc";
    }
    this.render();
  }
  renderToolbar(container, activeEpub) {
    const mode = this.getLayoutMode();
    const hasReader = !!activeEpub;
    const toolbar = container.createDiv({ cls: "jarvis-reader-sidebar-toolbar" });
    const layoutButton = toolbar.createEl("button", {
      cls: "jarvis-reader-sidebar-tab jarvis-reader-sidebar-layout-toggle",
      attr: {
        "aria-label": mode === "single" ? "\u5207\u6362\u5230\u53cc\u680f" : "\u5207\u6362\u5230\u5355\u680f"
      }
    });
    layoutButton.innerHTML = mode === "single" ? '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2"></rect><path d="M12 4v16"></path></svg>' : '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2"></rect><path d="M9 4v16"></path><path d="m14 9-3 3 3 3"></path></svg>';
    layoutButton.onclick = () => this.toggleLayoutMode();
    const panelActions = toolbar.createDiv({ cls: "jarvis-reader-sidebar-panel-actions" });
    this.makePanelButton(panelActions, "\u4e66\u67b6", '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5z"></path></svg>', mode === "single" && this.activePanel === "bookshelf" || mode === "dual" && !this.dualHighlightsMode, false, () => {
      this.activePanel = "bookshelf";
      this.dualHighlightsMode = false;
      this.render();
    });
    if (mode === "single") {
    this.makePanelButton(panelActions, "\u76ee\u5f55", '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4v16"></path><path d="M7 7h4"></path><path d="M11 7h8"></path><path d="M7 12h4"></path><path d="M11 12h8"></path><path d="M7 17h4"></path><path d="M11 17h8"></path></svg>', this.activePanel === "toc", !hasReader, () => {
        this.activePanel = "toc";
        this.render();
      });
    }
    this.makePanelButton(panelActions, "\u6807\u6ce8", '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4"></path><path d="m14.5 4.5 5 5"></path><path d="M13 6 5 14l-1 5 5-1 8-8"></path></svg>', mode === "single" && this.activePanel === "highlights" || mode === "dual" && this.dualHighlightsMode, !hasReader, () => {
      if (mode === "single") {
        this.activePanel = "highlights";
      } else {
        this.dualHighlightsMode = true;
      }
      this.render();
    });
  }
  getDisplayBookTitle(activeEpub) {
    const bookTitle = activeEpub && activeEpub.file ? activeEpub.file.basename : "";
    let displayTitle = bookTitle;
    const m = displayTitle.match(/^(.*?)(?:[?(](.*?)[?)])?(?:\s*[-_]\s*.*)?$/);
    if (m && m[1])
      displayTitle = m[1].trim();
    return displayTitle;
  }
  renderPaneHeader(container, title, subtitle = "", action = null) {
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
  restorePanelScroll(key, listEl) {
    const scrollTop = this.panelScroll[key] || 0;
    if (!listEl || !scrollTop)
      return;
    window.requestAnimationFrame(() => {
      listEl.scrollTop = scrollTop;
    });
  }
  bindPanelScroll(key, listEl) {
    if (!listEl)
      return;
    listEl.addEventListener("scroll", () => {
      this.panelScroll[key] = listEl.scrollTop;
    });
  }
  async toggleBookshelfCoverOnly() {
    this.plugin.settings.bookshelfCoverOnly = !this.plugin.settings.bookshelfCoverOnly;
    await this.plugin.saveSettings();
    this.render();
  }
  renderBookshelfPanel(container) {
    container.empty();
    const books = this.getBooks();
    const coverOnly = !!this.plugin.settings.bookshelfCoverOnly;
    container.className = coverOnly ? "jarvis-reader-sidebar-pane jarvis-reader-sidebar-bookshelf-pane is-cover-only" : "jarvis-reader-sidebar-pane jarvis-reader-sidebar-bookshelf-pane";
    this.renderPaneHeader(container, "\u4e66\u67b6", `${books.length} \u672c\u53ef\u8bfb\u4e66\u7c4d`, {
      label: coverOnly ? "\u5207\u6362\u5217\u8868\u6a21\u5f0f" : "\u5207\u6362\u5c01\u9762\u6a21\u5f0f",
      icon: coverOnly ? '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="3.5" rx="1"></rect><rect x="4" y="10.25" width="16" height="3.5" rx="1"></rect><rect x="4" y="15.5" width="16" height="3.5" rx="1"></rect></svg>' : '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"></rect><rect x="14" y="3" width="7" height="7" rx="1"></rect><rect x="3" y="14" width="7" height="7" rx="1"></rect><rect x="14" y="14" width="7" height="7" rx="1"></rect></svg>',
      onClick: () => this.toggleBookshelfCoverOnly()
    });
    if (!books.length) {
      container.createEl("div", { cls: "jarvis-reader-bookshelf-empty", text: "\u6682\u65e0 EPUB \u4e66\u7c4d" });
      return;
    }
    const list = container.createDiv({ cls: coverOnly ? "jarvis-reader-bookshelf-list is-cover-only" : "jarvis-reader-bookshelf-list" });
    this.restorePanelScroll("bookshelf", list);
    this.bindPanelScroll("bookshelf", list);
    for (const file of books) {
      const progress = this.getProgress(file);
      const percentage = progress ? Math.round((progress.percentage || 0) * 100) : 0;
      let titleStr = file.basename;
      let authorStr = "\u672a\u77e5\u4f5c\u8005";
      const m = titleStr.match(/^(.*?)(?:[?(](.*?)[?)])?(?:\s*[-_]\s*.*)?$/);
      if (m) {
        titleStr = m[1].trim();
        if (m[2])
          authorStr = m[2].trim();
        else {
          const dashMatch = titleStr.match(/^(.*?)\s*-\s*(.*)$/);
          if (dashMatch) {
            titleStr = dashMatch[1].trim();
            authorStr = dashMatch[2].trim();
          }
        }
      }
      const card = list.createEl("button", {
        cls: coverOnly ? "jarvis-reader-bookshelf-card is-cover-only" : "jarvis-reader-bookshelf-card",
        attr: {
          title: `${titleStr} - ${authorStr}`
        }
      });
      card.onclick = () => {
        this.openBook(file);
      };
      const cover = card.createDiv({ cls: "jarvis-reader-bookshelf-cover" });
      let hash = 0;
      for (let i = 0; i < titleStr.length; i++) {
        hash = titleStr.charCodeAt(i) + ((hash << 5) - hash);
      }
      const hue = Math.abs(hash) % 360;
      cover.style.background = `linear-gradient(135deg, hsl(${hue}, 35%, 65%), hsl(${(hue + 30) % 360}, 45%, 50%))`;
      const coverTitleStr = titleStr.length > 20 ? titleStr.substring(0, 19) + "..." : titleStr;
      cover.createEl("div", { cls: "jarvis-reader-bookshelf-cover-title", text: coverTitleStr });
      cover.createEl("div", { cls: "jarvis-reader-bookshelf-cover-format", text: file.extension.toUpperCase() });
      this.loadCachedCover(file, cover);
      if (coverOnly)
        continue;
      const info = card.createDiv({ cls: "jarvis-reader-bookshelf-info" });
      const top = info.createDiv({ cls: "jarvis-reader-bookshelf-card-top" });
      top.createEl("div", { cls: "jarvis-reader-bookshelf-name", text: titleStr });
      top.createEl("div", { cls: "jarvis-reader-bookshelf-author", text: authorStr });
      const bottom = info.createDiv({ cls: "jarvis-reader-bookshelf-card-bottom" });
      const progressRow = bottom.createDiv({ cls: "jarvis-reader-bookshelf-progress-row" });
      progressRow.createEl("span", { text: getBookshelfProgressLabel(progress) });
      const bar = bottom.createDiv({ cls: "jarvis-reader-bookshelf-progress" });
      const fill = bar.createDiv({ cls: "jarvis-reader-bookshelf-progress-fill" });
      fill.style.width = `${percentage}%`;
    }
  }
  renderTocPanel(container, activeEpub) {
    container.className = "jarvis-reader-sidebar-pane jarvis-reader-sidebar-toc-pane";
    container.empty();
    if (!activeEpub || !activeEpub.fileToc || !activeEpub.fileToc.length) {
      this.renderPaneHeader(container, "\u76ee\u5f55", activeEpub && activeEpub.file ? activeEpub.file.basename : "");
      container.createEl("div", { cls: "jarvis-reader-bookshelf-empty", text: "\u5f53\u524d\u4e66\u7c4d\u6ca1\u6709\u76ee\u5f55" });
      return;
    }
    this.renderPaneHeader(container, "\u76ee\u5f55", this.getDisplayBookTitle(activeEpub));
    const tocList = container.createDiv({ cls: "jarvis-reader-bookshelf-list jarvis-reader-toc-list" });
    this.restorePanelScroll("toc", tocList);
    this.bindPanelScroll("toc", tocList);
    let inferredTocDepth = 0;
    const inferFlatTocDepth = (label) => {
      const text = (label || "").trim();
      if (!text) {
        return 0;
      }
      if (/^(\u7248\u6743|\u5c01\u9762|\u76ee\u5f55|\u5e8f|\u5e8f\u8a00|\u524d\u8a00|\u4ee3\u5e8f|\u5bfc\u8a00|\u5f15\u8a00|\u540e\u8bb0|\u9644\u5f55|\u7b2c.+[\u7ae0\u8282\u7bc7\u90e8\u5377]|[0-9]+[.?])/u.test(text)) {
        inferredTocDepth = 0;
        return 0;
      }
      if (/^([0-9]+|[\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\u767e]+)[.?\s]/u.test(text) || /^[0-9]+\s+\S/u.test(text)) {
        inferredTocDepth = 1;
        return 1;
      }
      return inferredTocDepth > 0 ? Math.min(inferredTocDepth, 2) : 1;
    };
    const renderTocItems = (items, depth) => {
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
            } catch (error) {
            }
          }
        };
        tocItem.onkeydown = (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            tocItem.onclick();
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
      const panel = Object.create(JarvisReaderHighlightsView.prototype);
      Object.assign(panel, {
        app: this.app,
        plugin: this.plugin,
        reader: null,
        searchQuery: "",
        typeFilter: "all",
        linksOnly: false,
        currentChapterOnly: false,
        sortMode: "chapter",
        focusSearchOnRender: false,
        listScrollTop: 0,
        pendingRevealHighlightId: null
      });
      this.highlightsPanel = panel;
    }
    return this.highlightsPanel;
  }
  renderHighlightsPanel(container, activeEpub) {
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
  updateSidebarWidthGuard(activeEpub, body) {
    this.clearSidebarWidthGuard();
  }
  render() {
    const container = this.contentEl;
    if (!container)
      return;
    const activeEpub = this.getActiveEpubView();
    const mode = this.getLayoutMode();
    if (!activeEpub) {
      this.activePanel = "bookshelf";
      this.dualHighlightsMode = false;
    }
    container.empty();
    container.className = "view-content jarvis-reader-bookshelf-view jarvis-reader-sidebar-view";
    this.renderToolbar(container, activeEpub);
    const body = container.createDiv({ cls: mode === "dual" && activeEpub ? "jarvis-reader-sidebar-body is-dual" : "jarvis-reader-sidebar-body is-single" });
    if (mode === "dual" && activeEpub) {
      this.updateSidebarWidthGuard(activeEpub, body);
      const first = body.createDiv({ cls: "jarvis-reader-sidebar-pane" });
      const splitter = body.createDiv({
        cls: "jarvis-reader-sidebar-splitter",
        attr: {
          role: "separator",
          "aria-orientation": "vertical",
          title: "\u62d6\u52a8\u8c03\u6574\u5bbd\u5ea6"
        }
      });
      const second = body.createDiv({ cls: "jarvis-reader-sidebar-pane" });
      this.applySidebarPaneSplit(first, second, this.getSidebarPaneSplit());
      this.attachSidebarSplitter(splitter, body, first, second);
      if (this.dualHighlightsMode) {
        this.renderTocPanel(first, activeEpub);
        this.renderHighlightsPanel(second, activeEpub);
      } else {
        this.renderBookshelfPanel(first);
        this.renderTocPanel(second, activeEpub);
      }
      return;
    }
    this.clearSidebarWidthGuard();
    const pane = body.createDiv({ cls: "jarvis-reader-sidebar-pane" });
    if (this.activePanel === "toc" && activeEpub) {
      this.renderTocPanel(pane, activeEpub);
    } else if (this.activePanel === "highlights" && activeEpub) {
      this.renderHighlightsPanel(pane, activeEpub);
    } else {
      this.renderBookshelfPanel(pane);
    }
  }
};