import { ItemView, WorkspaceLeaf, Menu } from "obsidian";
import { HIGHLIGHTS_VIEW_TYPE } from "./BookshelfView";
import type JarvisReaderPlugin from "../main";
import { confirmDestructiveAction } from "../utils";

export class JarvisReaderHighlightsView extends ItemView {
  plugin: JarvisReaderPlugin;
  reader: any;
  searchQuery: string;
  typeFilter: string;
  linksOnly: boolean;
  currentChapterOnly: boolean;
  sortMode: string;
  focusSearchOnRender: boolean;
  listScrollTop: number;
  pendingRevealHighlightId: string | null;

  constructor(leaf: WorkspaceLeaf, plugin: JarvisReaderPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.reader = null;
    this.searchQuery = "";
    this.typeFilter = "all";
    this.linksOnly = false;
    this.currentChapterOnly = false;
    this.sortMode = "chapter";
    this.focusSearchOnRender = false;
    this.listScrollTop = 0;
    this.pendingRevealHighlightId = null;
  }
  getViewType() {
    return HIGHLIGHTS_VIEW_TYPE;
  }
  getDisplayText() {
    return "Jarvis Reader 笔记";
  }
  getIcon() {
    return "sticky-note";
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
      if (this.typeFilter === "thought" && !hasComment)
        return false;
      if (this.linksOnly && !this.getWikiLinks(highlight.comment).length)
        return false;
      if (this.currentChapterOnly && (!currentChapter || (highlight.chapterTitle || "").trim() !== currentChapter))
        return false;
      return true;
    });
    if (this.sortMode === "time") {
      result = [...result].sort((a, b) => new Date(b.updated || b.created || 0).getTime() - new Date(a.updated || a.created || 0).getTime());
    }
    return result;
  }
  renderFilterButton(container, mode, label) {
    const button = container.createEl("button", {
      cls: this.typeFilter === mode ? "jarvis-reader-highlights-filter is-active" : "jarvis-reader-highlights-filter",
      text: label
    });
    button.onclick = () => {
      this.typeFilter = mode;
      this.render();
    };
  }
  renderMoreMenu(event) {
    event.preventDefault();
    event.stopPropagation();
    const menu = new Menu();
    menu.addItem((item) => {
      item.setTitle("\u5f53\u524d\u7ae0\u8282").setIcon(this.currentChapterOnly ? "check" : "list").onClick(() => {
        this.currentChapterOnly = !this.currentChapterOnly;
        this.render();
      });
    });
    menu.addItem((item) => {
      item.setTitle("\u6709\u94fe\u63a5").setIcon(this.linksOnly ? "check" : "link").onClick(() => {
        this.linksOnly = !this.linksOnly;
        this.render();
      });
    });
    menu.addSeparator();
    menu.addItem((item) => {
      item.setTitle("\u7ae0\u8282\u987a\u5e8f").setIcon(this.sortMode === "chapter" ? "check" : "list-ordered").onClick(() => {
        this.sortMode = "chapter";
        this.render();
      });
    });
    menu.addItem((item) => {
      item.setTitle("\u65f6\u95f4\u987a\u5e8f").setIcon(this.sortMode === "time" ? "check" : "clock").onClick(() => {
        this.sortMode = "time";
        this.render();
      });
    });
    if (this.linksOnly || this.currentChapterOnly) {
      menu.addSeparator();
      menu.addItem((item) => {
        item.setTitle("\u6e05\u9664\u8f85\u52a9\u7b5b\u9009").setIcon("x").onClick(() => {
          this.linksOnly = false;
          this.currentChapterOnly = false;
          this.render();
        });
      });
    }
    menu.showAtMouseEvent(event);
  }
  renderControls(container) {
    const controls = container.createDiv({ cls: "jarvis-reader-highlights-controls" });
    const search = controls.createEl("input", {
      cls: "jarvis-reader-highlights-search",
      attr: {
        type: "search",
        placeholder: "\u641c\u7d22\u9ad8\u4eae\u3001\u60f3\u6cd5\u3001\u94fe\u63a5"
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
    const filters = controls.createDiv({ cls: "jarvis-reader-highlights-filters" });
    this.renderFilterButton(filters, "all", "\u5168\u90e8");
    this.renderFilterButton(filters, "highlight", "\u9ad8\u4eae");
    this.renderFilterButton(filters, "thought", "\u60f3\u6cd5");
    const more = filters.createEl("button", {
      cls: this.linksOnly || this.currentChapterOnly || this.sortMode === "time" ? "jarvis-reader-highlights-filter jarvis-reader-highlights-more is-active" : "jarvis-reader-highlights-filter jarvis-reader-highlights-more",
      text: "..."
    });
    more.setAttr("aria-label", "\u66f4\u591a\u7b5b\u9009\u4e0e\u6392\u5e8f");
    more.onclick = (event) => this.renderMoreMenu(event);
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
  render() {
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
    if (!this.reader) {
      container.createEl("div", { cls: "jarvis-reader-highlights-empty", text: "打开一本 EPUB 后显示笔记" });
      return;
    }
    const header = container.createDiv({ cls: "jarvis-reader-highlights-header" });
    header.createEl("div", { cls: "jarvis-reader-highlights-title", text: "笔记" });
    header.createEl("div", { cls: "jarvis-reader-highlights-book", text: this.reader.file ? this.reader.file.basename : "" });
    const list = this.reader.getBookHighlights();
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
          item.setTitle("删除笔记").setIcon("trash").onClick(async () => {
            const confirmed = await confirmDestructiveAction(
              this.app,
              "删除划线与笔记",
              "确定要删除这条划线及其所有笔记吗？这会清除阅读器中的原文标记和书籍笔记中的对应内容，此操作不可恢复。"
            );
            if (!confirmed)
              return;
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
      card.createEl("div", { cls: "jarvis-reader-highlights-chapter", text: highlight.chapterTitle || "\u672a\u547d\u540d\u7ae0\u8282" });
      const bubble = card.createDiv({ cls: "jarvis-reader-highlights-bubble" });
      if (highlight.comment) {
        const commentEl = bubble.createEl("div", { cls: "jarvis-reader-highlights-comment" });
        this.renderLinkedPreview(commentEl, highlight.comment, 96);
      } else {
        bubble.createEl("div", { cls: "jarvis-reader-highlights-comment is-empty", text: "\u672a\u5199\u611f\u60f3" });
      }
      this.renderWikiLinks(card, this.getWikiLinks(highlight.comment));
      card.createEl("div", { cls: "jarvis-reader-highlights-quote", text: this.previewText(highlight.quote, 72) });
      const time = this.formatTime(highlight.updated || highlight.created);
      if (time) {
        card.createEl("div", { cls: "jarvis-reader-highlights-time", text: time });
      }
    }
    if (revealCard) {
      window.requestAnimationFrame(() => {
        revealCard.scrollIntoView({ block: "nearest" });
        this.listScrollTop = body.scrollTop;
      });
    }
  }
};
