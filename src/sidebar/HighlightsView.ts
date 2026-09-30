import { Menu, setIcon, type App } from "obsidian";
import { EpubCFI } from "epubjs";
import type JarvisReaderPlugin from "../main";

export class HighlightsPanelController {
  app: App;
  contentEl: HTMLElement | null;
  plugin: JarvisReaderPlugin;
  reader: any;
  searchQuery: string;
  typeFilter: string;
  currentChapterOnly: boolean;
  sortMode: string;
  focusSearchOnRender: boolean;
  filtersExpanded: boolean;
  listScrollTop: number;
  pendingRevealHighlightId: string | null;

  constructor(plugin: JarvisReaderPlugin) {
    this.app = plugin.app;
    this.contentEl = null;
    this.plugin = plugin;
    this.reader = null;
    this.searchQuery = "";
    this.typeFilter = "all";
    this.currentChapterOnly = false;
    this.sortMode = "chapter";
    this.filtersExpanded = false;
    this.focusSearchOnRender = false;
    this.listScrollTop = 0;
    this.pendingRevealHighlightId = null;
  }
  setReader(reader) {
    this.reader = reader;
    this.render();
  }
  revealHighlight(highlightId) {
    this.pendingRevealHighlightId = highlightId || null;
    this.render();
  }
  formatTime(value) {
    if (!value)
      return "";
    try {
      return new Date(value).toLocaleString();
    } catch (error) {
      return value;
    }
  }
  previewText(value, maxLength = 72) {
    const text = (value || "").replace(/\s+/g, " ").trim();
    if (text.length <= maxLength)
      return text;
    return `${text.slice(0, maxLength).trim()}...`;
  }
  openWikiLink(linkText, event) {
    event.preventDefault();
    event.stopPropagation();
    if (event.detail >= 2)
      return;
    const target = (linkText || "").trim();
    if (!target)
      return;
    this.app.workspace.openLinkText(target, this.reader && this.reader.file ? this.reader.file.path : "", true);
  }
  renderLinkedPreview(container, value, maxLength = 96) {
    const text = this.previewText(value, maxLength);
    const pattern = /\[\[([^\]]+)\]\]/g;
    let lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      if (match.index > lastIndex) {
        container.createSpan({ text: text.slice(lastIndex, match.index) });
      }
      const raw = match[1] || "";
      const parts = raw.split("|");
      const target = (parts[0] || "").trim();
      const label = (parts[1] || parts[0] || "").trim();
      const link = container.createEl("a", {
        cls: "jarvis-reader-highlights-wikilink",
        text: label || target
      });
      link.onclick = (event) => this.openWikiLink(target, event);
      link.ondblclick = (event) => {
        event.preventDefault();
        event.stopPropagation();
      };
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < text.length) {
      container.createSpan({ text: text.slice(lastIndex) });
    }
  }
  getWikiLinks(value) {
    const text = value || "";
    const pattern = /\[\[([^\]]+)\]\]/g;
    const links = [];
    const seen = /* @__PURE__ */ new Set();
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const raw = match[1] || "";
      const parts = raw.split("|");
      const target = (parts[0] || "").trim();
      const label = (parts[1] || parts[0] || "").trim();
      if (!target || seen.has(target))
        continue;
      seen.add(target);
      links.push({ target, label: label || target });
    }
    return links;
  }
  getSearchText(highlight) {
    return [
      highlight.chapterTitle || "",
      highlight.quote || "",
      highlight.comment || "",
      ...this.getWikiLinks(highlight.comment).map((link) => `${link.target} ${link.label}`)
    ].join(" ").toLowerCase();
  }
  getCommentEntries(highlight) {
    const entries = Array.isArray(highlight.commentEntries)
      ? highlight.commentEntries.filter((entry) => (entry?.text || "").trim())
      : [];
    if (entries.length) return entries;
    return String(highlight.comment || "").trim().split(/\n{2,}/).map((text, index) => ({
      label: index === 0 ? "笔记" : `笔记 ${index + 1}`,
      text: text.trim(),
    })).filter((entry) => entry.text);
  }
  getCurrentChapterTitle() {
    var _a, _b;
    if (!this.reader || !this.reader.file)
      return "";
    return (((_b = (_a = this.plugin.settings.bookProgress) == null ? void 0 : _a[this.reader.file.path]) == null ? void 0 : _b.chapterTitle) || "").trim();
  }
  getFilteredHighlights(list) {
    const query = (this.searchQuery || "").trim().toLowerCase();
    const currentChapter = this.getCurrentChapterTitle();
    let result = list.filter((highlight) => {
      const hasComment = !!(highlight.comment || "").trim();
      if (query && !this.getSearchText(highlight).includes(query))
        return false;
      if (this.typeFilter === "highlight" && hasComment)
        return false;
      if (this.typeFilter === "note" && !hasComment)
        return false;
      if (this.currentChapterOnly && (!currentChapter || (highlight.chapterTitle || "").trim() !== currentChapter))
        return false;
      return true;
    });
    if (this.sortMode === "time") {
      result = [...result].sort((a, b) => new Date(b.updated || b.created || 0).getTime() - new Date(a.updated || a.created || 0).getTime());
    } else {
      const cfi = new EpubCFI();
      result = [...result].sort((a, b) => {
        if (!a.cfiRange || !b.cfiRange) return 0;
        try { return cfi.compare(a.cfiRange, b.cfiRange); }
        catch { return 0; }
      });
    }
    return result;
  }
  renderChoiceGroup(container: HTMLElement, label: string, choices: { label: string; selected: boolean; choose: () => void }[]) {
    const group = container.createDiv({ cls: "jarvis-reader-highlights-option-group", attr: { role: "group", "aria-label": label } });
    group.createDiv({ cls: "jarvis-reader-highlights-option-label", text: label });
    const buttons = group.createDiv({ cls: "jarvis-reader-highlights-filters" });
    for (const choice of choices) {
      const button = buttons.createEl("button", {
        cls: `jarvis-reader-highlights-filter${choice.selected ? " is-active" : ""}`,
        text: choice.label,
        attr: { "aria-pressed": String(choice.selected) }
      });
      button.onclick = () => { choice.choose(); this.render(); };
    }
  }
  renderControls(container) {
    const controls = container.createDiv({ cls: "jarvis-reader-highlights-controls" });
    const searchRow = controls.createDiv({ cls: "jarvis-reader-highlights-search-row" });
    const search = searchRow.createEl("input", {
      cls: "jarvis-reader-highlights-search",
      attr: {
        type: "search",
        placeholder: "搜索高亮、笔记、链接"
      }
    });
    search.value = this.searchQuery || "";
    if (this.focusSearchOnRender) {
      this.focusSearchOnRender = false;
      window.requestAnimationFrame(() => {
        search.focus();
        const length = search.value.length;
        search.setSelectionRange(length, length);
      });
    }
    let composing = false;
    search.addEventListener("compositionstart", () => {
      composing = true;
    });
    search.addEventListener("compositionend", (event) => {
      composing = false;
      this.searchQuery = event.currentTarget.value || "";
      this.focusSearchOnRender = true;
      this.render();
    });
    search.oninput = (event) => {
      if (composing) return;
      this.searchQuery = event.currentTarget.value || "";
      this.focusSearchOnRender = true;
      this.render();
    };
    search.onclick = (event) => event.stopPropagation();
    const hasFilters = this.typeFilter !== "all" || this.currentChapterOnly || this.sortMode !== "chapter";
    const toggle = searchRow.createEl("button", {
      cls: `jarvis-reader-highlights-filter-toggle clickable-icon${hasFilters ? " is-active" : ""}`,
      attr: { "aria-label": "筛选与排序", "aria-expanded": String(this.filtersExpanded), title: "筛选与排序" }
    });
    setIcon(toggle, "sliders-horizontal");
    const options = controls.createDiv({ cls: "jarvis-reader-highlights-filter-options" });
    options.hidden = !this.filtersExpanded;
    toggle.onclick = () => {
      this.filtersExpanded = !this.filtersExpanded;
      options.hidden = !this.filtersExpanded;
      toggle.setAttr("aria-expanded", String(this.filtersExpanded));
    };
    this.renderChoiceGroup(options, "内容", [
      { label: "全部", selected: this.typeFilter === "all", choose: () => { this.typeFilter = "all"; } },
      { label: "仅高亮", selected: this.typeFilter === "highlight", choose: () => { this.typeFilter = "highlight"; } },
      { label: "含笔记", selected: this.typeFilter === "note", choose: () => { this.typeFilter = "note"; } }
    ]);
    this.renderChoiceGroup(options, "范围", [
      { label: "全书", selected: !this.currentChapterOnly, choose: () => { this.currentChapterOnly = false; } },
      { label: "当前章节", selected: this.currentChapterOnly, choose: () => { this.currentChapterOnly = true; } }
    ]);
    this.renderChoiceGroup(options, "排序", [
      { label: "原文顺序", selected: this.sortMode === "chapter", choose: () => { this.sortMode = "chapter"; } },
      { label: "最近修改", selected: this.sortMode === "time", choose: () => { this.sortMode = "time"; } }
    ]);
    if (hasFilters) {
      const reset = options.createEl("button", { cls: "jarvis-reader-highlights-reset", text: "重置" });
      reset.onclick = () => {
        this.typeFilter = "all";
        this.currentChapterOnly = false;
        this.sortMode = "chapter";
        this.render();
      };
    }
  }

  renderWikiLinks(container, links) {
    if (!links.length)
      return;
    const wrap = container.createDiv({ cls: "jarvis-reader-highlights-links" });
    wrap.createSpan({ cls: "jarvis-reader-highlights-links-label", text: "\u76f8\u5173\u94fe\u63a5" });
    for (const linkInfo of links) {
      const link = wrap.createEl("a", {
        cls: "jarvis-reader-highlights-link-chip",
        text: linkInfo.label
      });
      link.onclick = (event) => this.openWikiLink(linkInfo.target, event);
      link.ondblclick = (event) => {
        event.preventDefault();
        event.stopPropagation();
      };
    }
  }
  async render() {
    const container = this.contentEl;
    if (!container)
      return;
    const previousList = container.querySelector(".jarvis-reader-highlights-list");
    const previousScrollTop = previousList ? previousList.scrollTop : this.listScrollTop || 0;
    this.listScrollTop = previousScrollTop;
    const revealHighlightId = this.pendingRevealHighlightId;
    this.pendingRevealHighlightId = null;
    const restoreScroll = (listEl) => {
      if (!listEl || !previousScrollTop)
        return;
      window.requestAnimationFrame(() => {
        listEl.scrollTop = previousScrollTop;
        this.listScrollTop = previousScrollTop;
      });
    };
    container.empty();
    container.addClass("jarvis-reader-highlights-view");
    const reader = this.reader;
    if (!reader) {
      container.createEl("div", { cls: "jarvis-reader-highlights-empty", text: "打开一本 EPUB 后显示笔记" });
      return;
    }
    const header = container.createDiv({ cls: "jarvis-reader-highlights-header" });
    header.createEl("div", { cls: "jarvis-reader-highlights-title", text: "笔记" });
    const list = await reader.getBookHighlightsForReader();
    if (this.reader !== reader || this.contentEl !== container) return;
    if (!list.length) {
      container.createEl("div", { cls: "jarvis-reader-highlights-empty", text: "暂无笔记。选中正文后高亮或写笔记即可生成。" });
      return;
    }
    this.renderControls(container);
    const visibleList = this.getFilteredHighlights(list);
    if (!visibleList.length) {
      container.createEl("div", { cls: "jarvis-reader-highlights-empty", text: "没有匹配的笔记" });
      return;
    }
    const body = container.createDiv({ cls: "jarvis-reader-highlights-list" });
    body.addEventListener("scroll", () => {
      this.listScrollTop = body.scrollTop;
    });
    let revealCard = null;
    restoreScroll(body);
    for (const highlight of visibleList) {
      const isActive = highlight.id && highlight.id === this.reader.selectedHighlightId;
      const card = body.createDiv({
        cls: isActive ? "jarvis-reader-highlights-card is-active" : "jarvis-reader-highlights-card"
      });
      if (revealHighlightId && highlight.id === revealHighlightId) {
        revealCard = card;
      }
      card.setAttr("role", "button");
      card.setAttr("tabindex", "0");
      card.onclick = (event) => {
        event.preventDefault();
        const activeCards = body.querySelectorAll(".jarvis-reader-highlights-card.is-active");
        activeCards.forEach(c => c.classList.remove("is-active"));
        card.classList.add("is-active");
        this.reader.jumpToHighlight(highlight, true);
      };
      card.oncontextmenu = (event) => {
        event.preventDefault();
        const menu = new Menu();
        menu.addItem((item) => {
          item.setTitle("删除").setIcon("trash").onClick(async () => {
            await this.reader.deleteHighlight(highlight);
          });
        });
        menu.showAtMouseEvent(event);
      };
      card.onkeydown = (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          const activeCards = body.querySelectorAll(".jarvis-reader-highlights-card.is-active");
          activeCards.forEach(c => c.classList.remove("is-active"));
          card.classList.add("is-active");
          this.reader.jumpToHighlight(highlight, true);
        }
      };
      card.createEl("div", { cls: "jarvis-reader-highlights-quote", text: this.previewText(highlight.quote, 160) });
      const noteEntries = this.getCommentEntries(highlight);
      if (noteEntries.length) {
        const latestNote = noteEntries[noteEntries.length - 1];
        const bubble = card.createDiv({ cls: "jarvis-reader-highlights-bubble" });
        bubble.createEl("div", {
          cls: "jarvis-reader-highlights-note-meta",
          text: noteEntries.length > 1 ? `${noteEntries.length} 条笔记` : "笔记",
        });
        const commentEl = bubble.createEl("div", { cls: "jarvis-reader-highlights-comment" });
        this.renderLinkedPreview(commentEl, latestNote.text, 96);
      }
      this.renderWikiLinks(card, this.getWikiLinks(highlight.comment));
    }
    if (revealCard) {
      window.requestAnimationFrame(() => {
        revealCard.scrollIntoView({ block: "nearest" });
        this.listScrollTop = body.scrollTop;
      });
    }
  }
};
