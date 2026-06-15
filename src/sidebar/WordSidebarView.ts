import { ItemView, WorkspaceLeaf, Menu, setIcon, MarkdownRenderer } from "obsidian";
import type JarvisReaderPlugin from "../main";
import { buildWordAudioUrl } from "../word-assets";

export const WORD_SIDEBAR_VIEW_TYPE = "jarvis-reader-word-sidebar";

export class WordSidebarView extends ItemView {
  plugin: JarvisReaderPlugin;
  reader: any;
  searchQuery: string;
  expandedAssets: Set<string>;
  filterKind: string = "all";
  filterStatus: string = "all";
  sortOption: string = "created_desc";

  constructor(leaf: WorkspaceLeaf, plugin: JarvisReaderPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.reader = null;
    this.searchQuery = "";
    this.expandedAssets = new Set();
  }

  getViewType() {
    return WORD_SIDEBAR_VIEW_TYPE;
  }

  getDisplayText() {
    return "单词侧边栏";
  }

  getIcon() {
    return "book-a";
  }

  setReader(reader: any) {
    if (this.reader !== reader) {
      this.expandedAssets.clear();
      this.searchQuery = "";
    }
    this.reader = reader;
    this.render();
  }

  getWordAssets() {
    if (!this.plugin.settings.wordAssets || typeof this.plugin.settings.wordAssets !== "object") {
      return [];
    }
    const currentBookPath = this.reader && this.reader.file ? this.reader.file.path : null;
    
    let assets = Object.values(this.plugin.settings.wordAssets);
    
    // Filter by current book
    if (currentBookPath) {
      assets = assets.filter((asset: any) => {
        return asset.sources && asset.sources.length > 0 && asset.sources[0].bookPath === currentBookPath;
      });
    } else {
      assets = []; // Or show all? Let's show none if no book is active, or empty state.
    }

    // Filter by kind
    if (this.filterKind !== "all") {
      assets = assets.filter((asset: any) => {
        if (this.filterKind === "word") return asset.kind === "word" || !asset.kind;
        if (this.filterKind === "phrase") return asset.kind === "phrase";
        if (this.filterKind === "sentence") return asset.kind === "sentence";
        return true;
      });
    }

    // Filter by status
    if (this.filterStatus !== "all") {
      assets = assets.filter((asset: any) => {
        if (this.filterStatus === "mastered") return !!asset.mastered;
        if (this.filterStatus === "unmastered") return !asset.mastered;
        return true;
      });
    }

    // Filter by search query
    if (this.searchQuery) {
      const q = this.searchQuery.toLowerCase();
      assets = assets.filter((asset: any) => {
        const lemma = (asset.lemma || "").toLowerCase();
        const translation = (asset.translation || "").toLowerCase();
        return lemma.includes(q) || translation.includes(q);
      });
    }

    // Sort
    assets.sort((a: any, b: any) => {
      if (this.sortOption === "alpha_asc") {
        return (a.lemma || "").localeCompare(b.lemma || "");
      }
      if (this.sortOption === "cfi_asc") {
        const cfiA = a.sources && a.sources[0] && a.sources[0].cfiRange ? a.sources[0].cfiRange : "";
        const cfiB = b.sources && b.sources[0] && b.sources[0].cfiRange ? b.sources[0].cfiRange : "";
        return cfiA.localeCompare(cfiB);
      }
      if (this.sortOption === "created_asc") {
        return new Date(a.created || 0).getTime() - new Date(b.created || 0).getTime();
      }
      // default: created_desc
      return new Date(b.created || 0).getTime() - new Date(a.created || 0).getTime();
    });

    return assets;
  }

  async openWordBook() {
    if (typeof (this.plugin as any).openWordBook === "function") {
      await (this.plugin as any).openWordBook(true);
    }
  }

  renderHeader(container: HTMLElement, assetCount: number) {
    const header = container.createDiv({ cls: "jarvis-reader-word-sidebar-header" });
    const titleRow = header.createDiv({ cls: "jarvis-reader-word-sidebar-title-row" });
    
    const currentBookName = this.reader && this.reader.file ? this.reader.file.basename : "全局";
    let displayTitle = currentBookName;
    const m = displayTitle.match(/^(.*?)(?:[?(](.*?)[?)])?(?:\s*[-_]\s*.*)?$/);
    if (m && m[1]) displayTitle = m[1].trim();

    titleRow.createDiv({ cls: "jarvis-reader-word-sidebar-title", text: displayTitle });
    
    const wordBookBtn = titleRow.createEl("button", {
      cls: "jarvis-reader-word-sidebar-action",
      attr: {
        "aria-label": "打开英语词句本",
        "title": "打开英语词句本"
      }
    });
    setIcon(wordBookBtn, "library");
    wordBookBtn.onclick = () => this.openWordBook();

    header.createDiv({ cls: "jarvis-reader-word-sidebar-subtitle", text: `共 ${assetCount} 个词条` });
  }

  renderSearch(container: HTMLElement) {
    const searchWrap = container.createDiv({ cls: "jarvis-reader-highlights-search" });
    searchWrap.style.display = "flex";
    searchWrap.style.gap = "4px";
    
    const searchInput = searchWrap.createEl("input", {
      type: "text",
      placeholder: "搜索词条或释义...",
      value: this.searchQuery
    });
    searchInput.style.flex = "1";
    
    searchInput.oninput = (e) => {
      this.searchQuery = (e.target as HTMLInputElement).value;
      const listContainer = container.querySelector(".jarvis-reader-word-list");
      if (listContainer instanceof HTMLElement) {
        this.renderList(listContainer);
      }
    };

    const filterTabsWrap = container.createDiv({ cls: "jarvis-reader-word-sidebar-tabs" });
    filterTabsWrap.style.display = "flex";
    filterTabsWrap.style.background = "var(--background-modifier-form-field)";
    filterTabsWrap.style.borderRadius = "var(--radius-s)";
    filterTabsWrap.style.padding = "2px";
    filterTabsWrap.style.margin = "8px 0";
    
    const tabs = [
      { id: "all", label: "全部" },
      { id: "word", label: "单词" },
      { id: "phrase", label: "短语" },
      { id: "sentence", label: "长句" }
    ];
    
    tabs.forEach(tab => {
      const tabEl = filterTabsWrap.createDiv({ text: tab.label });
      tabEl.style.flex = "1";
      tabEl.style.textAlign = "center";
      tabEl.style.padding = "4px 0";
      tabEl.style.fontSize = "0.85em";
      tabEl.style.cursor = "pointer";
      tabEl.style.borderRadius = "var(--radius-s)";
      tabEl.style.transition = "all 0.2s ease";
      
      if (this.filterKind === tab.id) {
        tabEl.style.background = "var(--background-modifier-active-hover)";
        tabEl.style.color = "var(--text-normal)";
        tabEl.style.fontWeight = "bold";
      } else {
        tabEl.style.color = "var(--text-muted)";
      }
      
      tabEl.onclick = () => {
        this.filterKind = tab.id as any;
        this.render();
      };
    });
    const filterBtn = searchWrap.createEl("button", {
      cls: "clickable-icon jarvis-reader-filter-btn",
      attr: { "aria-label": "筛选与排序" }
    });
    setIcon(filterBtn, "filter");
    
    filterBtn.onclick = (e) => {
      const menu = new Menu();
      
      menu.addItem(item => item.setTitle("显示所有状态").setChecked(this.filterStatus === "all").onClick(() => { this.filterStatus = "all"; this.render(); }));
      menu.addItem(item => item.setTitle("已掌握").setChecked(this.filterStatus === "mastered").onClick(() => { this.filterStatus = "mastered"; this.render(); }));
      menu.addItem(item => item.setTitle("未掌握").setChecked(this.filterStatus === "unmastered").onClick(() => { this.filterStatus = "unmastered"; this.render(); }));
      
      menu.addSeparator();
      menu.addItem(item => item.setTitle("按添加时间排序 (最新)").setChecked(this.sortOption === "created_desc").onClick(() => { this.sortOption = "created_desc"; this.render(); }));
      menu.addItem(item => item.setTitle("按添加时间排序 (最早)").setChecked(this.sortOption === "created_asc").onClick(() => { this.sortOption = "created_asc"; this.render(); }));
      menu.addItem(item => item.setTitle("按字母顺序排列").setChecked(this.sortOption === "alpha_asc").onClick(() => { this.sortOption = "alpha_asc"; this.render(); }));
      menu.addItem(item => item.setTitle("按文章先后位置排序").setChecked(this.sortOption === "cfi_asc").onClick(() => { this.sortOption = "cfi_asc"; this.render(); }));

      menu.showAtMouseEvent(e);
    };
  }

  renderList(listContainer: HTMLElement) {
    listContainer.empty();
    
    if (!this.reader) {
      listContainer.createDiv({ cls: "jarvis-reader-bookshelf-empty", text: "请先打开一本 EPUB 书籍" });
      return;
    }

    const assets = this.getWordAssets();
    
    if (assets.length === 0) {
      listContainer.createDiv({ cls: "jarvis-reader-bookshelf-empty", text: "暂无词条" });
      return;
    }

    for (const asset of assets as any[]) {
      const isExpanded = this.expandedAssets.has(asset.lemma);
      
      const itemEl = listContainer.createDiv({ 
        cls: `jarvis-reader-word-item ${asset.mastered ? "is-mastered" : ""} ${isExpanded ? "is-expanded" : ""}`
      });

      const headerEl = itemEl.createDiv({ cls: "jarvis-reader-word-item-header" });
      
      const lemmaWrap = headerEl.createDiv({ cls: "jarvis-reader-word-lemma-wrap" });
      let displayLemma = asset.lemma;
      const quote = asset.sources && asset.sources[0] ? asset.sources[0].quote : "";
      
      if (asset.kind === "sentence") {
        displayLemma = quote || "长句";
      }
      
      const lemmaEl = lemmaWrap.createSpan({ cls: "jarvis-reader-word-lemma", text: displayLemma });
      
      if (this.plugin.settings.enableWordAudio !== false) {
          lemmaEl.addClass("has-audio");
          lemmaEl.onclick = (e) => {
              e.stopPropagation(); // prevent expand
              try {
                  const accent = this.plugin.settings.wordAudioAccent || "us";
                  const template = this.plugin.settings.wordAudioTemplate || "https://dict.youdao.com/dictvoice?audio={{word}}&type={{type}}";
                  const url = buildWordAudioUrl(template, displayLemma, accent);
                  new Audio(url).play().catch(() => {});
              } catch(err) {
                  console.warn("Jarvis Reader audio failed", err);
              }
          };
      }
      if (asset.mastered) {
         lemmaWrap.createSpan({ cls: "jarvis-reader-word-mastered-badge", text: "✓" });
      }

      // Click to toggle expand
      headerEl.onclick = (e) => {
        e.preventDefault();
        
        if (isExpanded) {
          this.expandedAssets.delete(asset.lemma);
        } else {
          this.expandedAssets.add(asset.lemma);
        }
        this.renderList(listContainer);
      };

      // Dblclick to jump
      headerEl.ondblclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (this.reader && this.reader.currentRendition && asset.sources && asset.sources[0]) {
          try {
             this.reader.currentRendition.display(asset.sources[0].cfiRange);
          } catch(err) {
             console.warn("Word jump failed", err);
          }
        }
      };
      
      // Context menu
      headerEl.oncontextmenu = (e) => {
        e.preventDefault();
        const menu = new Menu();
        menu.addItem((item) => {
           item.setTitle(asset.mastered ? "取消掌握" : "标记为掌握");
           item.setIcon("check-circle");
           item.onClick(async () => {
              if (this.reader && typeof this.reader.setWordMastered === "function") {
                 await this.reader.setWordMastered(asset, !asset.mastered);
              }
           });
        });
        menu.addItem((item) => {
           item.setTitle("彻底删除");
           item.setIcon("trash");
           item.onClick(async () => {
              if (this.reader && typeof this.reader.deleteWordAsset === "function") {
                 await this.reader.deleteWordAsset(asset);
              }
           });
        });
        menu.showAtMouseEvent(e);
      };

      if (isExpanded) {
        const bodyEl = itemEl.createDiv({ cls: "jarvis-reader-word-item-display" });
        
        if (asset.display) {
           MarkdownRenderer.render(this.app, asset.display, bodyEl, this.reader ? this.reader.file.path : "", this);
        } else {
           bodyEl.createEl("em", { text: "没有详细解释。" });
        }
      }
    }
  }

  render() {
    const container = this.contentEl;
    if (!container) return;

    container.empty();
    container.className = "view-content jarvis-reader-sidebar-view jarvis-reader-word-sidebar";

    const allAssets = this.getWordAssets();
    
    this.renderHeader(container, allAssets.length);
    this.renderSearch(container);
    
    const listContainer = container.createDiv({ cls: "jarvis-reader-word-list" });
    this.renderList(listContainer);
  }
}
