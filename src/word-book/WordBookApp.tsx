import * as React from "react";
import type JarvisReaderPlugin from "../main";
import { buildWordAudioUrl, getTranslationAssetStorageKey } from "../word-assets";
import { Notice, MarkdownRenderer, Menu } from "obsidian";
import type { WordAsset } from "../types";
import { confirmDestructiveAction } from "../utils";

export interface WordBookAppProps {
  plugin: JarvisReaderPlugin;
}

import { WordCard, MarkdownPreview } from "./WordCard";

export function WordBookApp({ plugin }: WordBookAppProps) {
  const [assets, setAssets] = React.useState<WordAsset[]>([]);
  const [search, setSearch] = React.useState("");
  const [filterKind, setFilterKind] = React.useState("all");
  const [filterStatus, setFilterStatus] = React.useState("all");
  const [filterBook, setFilterBook] = React.useState("all");
  const [sortBy, setSortBy] = React.useState("created_desc");
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [isSelectionMode, setIsSelectionMode] = React.useState(false);
  const [viewMode, setViewMode] = React.useState<"grid" | "table" | "single">("grid");
  const [exportState, setExportState] = React.useState<"none" | "select_template">("none");
  const [blurMode, setBlurMode] = React.useState<"none" | "word" | "translation">("none");
  const [singleCardIndex, setSingleCardIndex] = React.useState(0);
  const [singleCardFlipped, setSingleCardFlipped] = React.useState(false);
  const [expandedItems, setExpandedItems] = React.useState<Set<string>>(new Set());

  // Load assets
  const loadAssets = React.useCallback(() => {
    if (plugin.settings.wordAssets && typeof plugin.settings.wordAssets === "object") {
      setAssets(Object.values(plugin.settings.wordAssets) as WordAsset[]);
    } else {
      setAssets([]);
    }
  }, [plugin.settings.wordAssets]);

  React.useEffect(() => {
    loadAssets();

    // Use custom event for refreshing
    const handleRefresh = () => loadAssets();
    window.addEventListener("jarvis-reader-word-assets-changed", handleRefresh);
    return () => window.removeEventListener("jarvis-reader-word-assets-changed", handleRefresh);
  }, [loadAssets]);

  const toggleSelectAll = () => {
    if (selected.size === filteredAssets.length && filteredAssets.length > 0) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filteredAssets.map(a => a.lemma)));
    }
  };

  const invertSelection = () => {
    const newSet = new Set<string>();
    filteredAssets.forEach(a => {
      if (!selected.has(a.lemma)) {
        newSet.add(a.lemma);
      }
    });
    setSelected(newSet);
  };

  const toggleSelect = (lemma: string) => {
    const newSet = new Set(selected);
    if (newSet.has(lemma)) {
      newSet.delete(lemma);
    } else {
      newSet.add(lemma);
    }
    setSelected(newSet);
  };

  const handleDeleteSelected = async () => {
    if (selected.size === 0) return;
    const confirmed = await confirmDestructiveAction(plugin.app, "删除词卡", `确定要彻底删除选中的 ${selected.size} 个词卡吗？此操作不可恢复。`);
    if (!confirmed)
      return;

    let count = 0;
    for (const lemma of selected) {
      const asset = plugin.settings.wordAssets[lemma];
      if (asset) {
        if (plugin.activeReaderView && typeof plugin.activeReaderView.deleteWordAsset === "function") {
          await plugin.activeReaderView.deleteWordAsset(asset);
        } else {
          delete plugin.settings.wordAssets[lemma];
        }
        count++;
      }
    }
    await plugin.persistWordAssetSidecar("delete");
    await plugin.saveSettings();
    window.dispatchEvent(new CustomEvent("jarvis-reader-word-assets-changed"));
    new Notice(`已彻底删除 ${count} 个词条`);
    setSelected(new Set());
    loadAssets();
  };

  const handleDeleteFilteredBookWords = async () => {
    if (filterBook === "all" || filteredAssets.length === 0) return;

    const confirmed = await confirmDestructiveAction(plugin.app, "删除本书词卡", `确定要彻底删除正在显示的这本书的 ${filteredAssets.length} 个词卡吗？此操作不可恢复。`);
    if (!confirmed)
      return;

    let count = 0;
    for (const asset of filteredAssets) {
      const assetKey = getTranslationAssetStorageKey(asset) || asset.lemma;
      if (plugin.activeReaderView && typeof plugin.activeReaderView.deleteWordAsset === "function") {
        await plugin.activeReaderView.deleteWordAsset(asset);
      } else {
        delete plugin.settings.wordAssets[assetKey];
      }
      count++;
    }
    await plugin.persistWordAssetSidecar("delete");
    await plugin.saveSettings();
    window.dispatchEvent(new CustomEvent("jarvis-reader-word-assets-changed"));
    new Notice(`已彻底删除此书的 ${count} 个词条`);
    const leaves = plugin.app.workspace.getLeavesOfType("jarvis-reader-word-sidebar");
    leaves.forEach((leaf: any) => {
        if (leaf.view && typeof leaf.view.render === "function") {
            leaf.view.render();
        }
    });
    loadAssets();
  };

  const handleMarkMastered = async (mastered: boolean) => {
    if (selected.size === 0) return;
    let count = 0;
    for (const lemma of selected) {
      if (plugin.settings.wordAssets[lemma]) {
        plugin.settings.wordAssets[lemma].mastered = mastered;
        count++;
      }
    }
    await plugin.saveSettings();
    new Notice(`已将 ${count} 个词条标记为${mastered ? "已掌握" : "未掌握"}`);
    loadAssets();
  };

  const handleToggleSingleMastery = async (e: React.MouseEvent, lemma: string) => {
    e.stopPropagation();
    if (plugin.settings.wordAssets[lemma]) {
      const current = plugin.settings.wordAssets[lemma].mastered;
      plugin.settings.wordAssets[lemma].mastered = !current;
      await plugin.saveSettings();
      loadAssets();
    }
  };

  const handleContextMenu = (e: React.MouseEvent, lemma: string) => {
    e.preventDefault();
    const menu = new Menu();
    const isMastered = plugin.settings.wordAssets[lemma]?.mastered;

    menu.addItem((item) => {
        item.setTitle(isMastered ? "标记为未掌握" : "标记为已掌握")
            .setIcon(isMastered ? "cross" : "checkmark")
            .onClick(async () => {
                if (plugin.settings.wordAssets[lemma]) {
                    plugin.settings.wordAssets[lemma].mastered = !isMastered;
                    await plugin.saveSettings();
                    loadAssets();
                }
            });
    });

    menu.addSeparator();

    menu.addItem((item) => {
        item.setTitle("彻底删除")
            .setIcon("trash")
            .onClick(async () => {
                const asset = plugin.settings.wordAssets[lemma];
                if (asset) {
                    if (plugin.activeReaderView && typeof plugin.activeReaderView.deleteWordAsset === "function") {
                        await plugin.activeReaderView.deleteWordAsset(asset);
                    } else {
                        delete plugin.settings.wordAssets[lemma];
                    }
                    await plugin.saveSettings();
                    window.dispatchEvent(new CustomEvent("jarvis-reader-word-assets-changed"));
                    loadAssets();
                    new Notice(`已彻底删除词条：${lemma}`);
                    if (selected.has(lemma)) {
                        const next = new Set(selected);
                        next.delete(lemma);
                        setSelected(next);
                    }
                }
            });
    });
    menu.showAtMouseEvent(e.nativeEvent);
  };

  const handleExportPrint = () => {
    if (selected.size === 0) {
        new Notice("请先选择要导出的词条");
        return;
    }
    setExportState("select_template");
  };

  const executeExport = async (templateType: "full" | "hide_zh" | "hide_en") => {
    setExportState("none");
    const selectedList = filteredAssets.filter(a => selected.has(a.lemma));
    
    // Group by kind
    const words = selectedList.filter(a => !a.kind || a.kind === "word");
    const phrases = selectedList.filter(a => a.kind === "phrase");
    const sentences = selectedList.filter(a => a.kind === "sentence");

    const dateStrDisp = new Date().toLocaleDateString();
    let markdown = `\n\n`; // Hide standard headers to avoid theme conflicts
    
    // Inject minimalist, high-density print layout using INLINE styles
    const baseStyle = `-webkit-print-color-adjust: exact !important; print-color-adjust: exact !important;`;
    
    markdown += `
<div style="${baseStyle} font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #333; line-height: 1.5; padding: 0;">
  <div style="${baseStyle} padding-bottom: 12px; margin-bottom: 16px; border-bottom: 2px solid #cbd5e1; display: flex; justify-content: space-between; align-items: baseline;">
    <h1 style="${baseStyle} margin: 0 !important; font-size: 1.5em !important; font-weight: 700 !important; color: #0f172a !important; padding: 0 !important;">英语词句本</h1>
    <div style="${baseStyle} text-align: right; font-size: 0.85em; color: #64748b;">
      ${dateStrDisp} · 总计 ${selectedList.length} 个词条
    </div>
  </div>
`;

    const renderItem = (asset: any) => {
        const titleText = asset.title || asset.lemma;
        const phonetic = asset.phonetic ? `<span style="${baseStyle} font-family: monospace; font-size: 0.8em; color: #64748b; margin-left: 8px; font-style: italic;">${asset.phonetic}</span>` : "";
        const translation = asset.translation ? asset.translation.replace(/\n/g, " ") : "";
        
        let wordContent = `<span style="${baseStyle} font-family: 'Georgia', 'Times New Roman', serif; font-size: 1.05em; font-weight: 600; color: #991b1b;">${titleText}</span>${phonetic}`;
        if (templateType === "hide_en") {
            wordContent = `<span style="${baseStyle} color:transparent; border-bottom: 1px solid #999; display: inline-block; width: 60%; height: 1.2em;"></span>${phonetic}`;
        }

        let transContent = `<span style="${baseStyle} font-size: 0.95em; color: #334155; margin-left: 0;">${translation}</span>`;
        if (templateType === "hide_zh") {
            transContent = `<span style="${baseStyle} color:transparent; border-bottom: 1px solid #999; display: inline-block; width: 80%; height: 1.2em; margin-left: 0;"></span>`;
        }

        if (asset.kind === "sentence") {
            return `<div style="${baseStyle} break-inside: avoid; page-break-inside: avoid; padding: 8px 0; border-bottom: 1px dashed #e2e8f0; display: flex; flex-direction: column; gap: 4px;"><div style="${baseStyle} width: 100%;">${wordContent}</div><div style="${baseStyle} width: 100%;">${transContent}</div></div>`;
        }

        return `<div style="${baseStyle} break-inside: avoid; page-break-inside: avoid; padding: 6px 0; border-bottom: 1px dashed #e2e8f0; display: grid; grid-template-columns: minmax(35%, max-content) 1fr; gap: 12px; align-items: baseline;"><div style="${baseStyle} white-space: nowrap;">${wordContent}</div><div style="${baseStyle}">${transContent}</div></div>`;
    };

    const sectionTitleStyle = `${baseStyle} font-size: 1.1em; font-weight: 600; color: #1e293b; margin: 24px 0 8px 0; border-bottom: 1px solid #94a3b8; padding-bottom: 4px;`;
    const gridStyle = `${baseStyle} display: block; column-count: 2; column-gap: 32px;`;

    if (words.length > 0) {
        markdown += `<div style="${sectionTitleStyle}">单词 (Words)</div><div style="${gridStyle}">`;
        words.forEach(w => markdown += renderItem(w));
        markdown += `</div>`;
    }

    if (phrases.length > 0) {
        markdown += `<div style="${sectionTitleStyle}">短语 (Phrases)</div><div style="${gridStyle}">`;
        phrases.forEach(p => markdown += renderItem(p));
        markdown += `</div>`;
    }

    if (sentences.length > 0) {
        markdown += `<div style="${sectionTitleStyle}">长句 (Sentences)</div><div style="${baseStyle} display: flex; flex-direction: column;">`;
        sentences.forEach(s => markdown += renderItem(s));
        markdown += `</div>`;
    }

    markdown += `</div>\n`;



    try {
        let folderPath = plugin.settings.wordBookExportFolder || "";
        folderPath = folderPath.replace(/^[/]+|[/]+$/g, ""); // trim slashes
        
        if (folderPath && !plugin.app.vault.getAbstractFileByPath(folderPath)) {
            const folders = folderPath.split("/");
            let currentPath = "";
            for (const f of folders) {
                currentPath = currentPath ? `${currentPath}/${f}` : f;
                if (!plugin.app.vault.getAbstractFileByPath(currentPath)) {
                    await plugin.app.vault.createFolder(currentPath);
                }
            }
        }

        const dateStr = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
        const suffix = templateType === "full" ? "完整对照" : templateType === "hide_zh" ? "默写中文" : "默写英文";
        const fileName = `${folderPath ? folderPath + "/" : ""}英语词句本_${suffix}_${dateStr}.md`;
        
        const file = await plugin.app.vault.create(fileName, markdown);
        const leaf = plugin.app.workspace.getLeaf("split", "vertical");
        await leaf.openFile(file);
        new Notice(`导出成功：${fileName}。正在打开 PDF 导出...`);
        
        // Give Obsidian a tiny bit of time to render the markdown, then trigger PDF export
        setTimeout(() => {
            try {
                if ((plugin.app as any).commands && typeof (plugin.app as any).commands.executeCommandById === "function") {
                    (plugin.app as any).commands.executeCommandById('workspace:export-pdf');
                } else {
                    new Notice("不支持自动打开导出弹窗，请手动从笔记右上角菜单导出 PDF");
                }
            } catch (err) {
                new Notice("自动打开 PDF 导出界面失败，请手动操作");
                console.warn("Jarvis Reader export PDF failed", err);
            }
        }, 500);

    } catch (e) {
        console.error(e);
        new Notice("导出失败：" + e.message);
    }
  };

  const playAudio = (lemma: string) => {
    if (plugin.settings.enableWordAudio !== false) {
      try {
        const accent = plugin.settings.wordAudioAccent || "us";
        const template = plugin.settings.wordAudioTemplate || "https://dict.youdao.com/dictvoice?audio={{word}}&type={{type}}";
        const url = buildWordAudioUrl(template, lemma, accent);
        new Audio(url).play().catch(() => {});
      } catch(err) {
        console.warn("Jarvis Reader audio failed", err);
      }
    }
  };

  // Extract unique books
  const booksMap = React.useMemo(() => {
    const map = new Map<string, string>(); // path -> title
    assets.forEach(a => {
      if (a.sources && a.sources[0] && a.sources[0].bookPath) {
        map.set(a.sources[0].bookPath, a.sources[0].bookTitle || a.sources[0].bookPath);
      }
    });
    return map;
  }, [assets]);

  // Derived filtered & sorted
  const filteredAssets = React.useMemo(() => {
    let list = [...assets];
    
    // Kind
    if (filterKind !== "all") {
      list = list.filter(a => filterKind === "word" ? (!a.kind || a.kind === "word") : a.kind === filterKind);
    }
    // Status
    if (filterStatus !== "all") {
      list = list.filter(a => filterStatus === "mastered" ? a.mastered : !a.mastered);
    }
    // Book
    if (filterBook !== "all") {
      list = list.filter(a => a.sources && a.sources[0] && a.sources[0].bookPath === filterBook);
    }
    // Search
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(a => 
        (a.lemma || "").toLowerCase().includes(q) || 
        (a.translation || "").toLowerCase().includes(q)
      );
    }

    // Sort
    list.sort((a, b) => {
      if (sortBy === "alpha_asc") {
        if (a.kind === "sentence" && b.kind !== "sentence") return 1;
        if (a.kind !== "sentence" && b.kind === "sentence") return -1;
        return (a.lemma || "").localeCompare(b.lemma || "");
      }
      if (sortBy === "cfi_asc") {
        const cfiA = a.sources && a.sources[0] && a.sources[0].cfiRange ? a.sources[0].cfiRange : "";
        const cfiB = b.sources && b.sources[0] && b.sources[0].cfiRange ? b.sources[0].cfiRange : "";
        return cfiA.localeCompare(cfiB);
      }
      if (sortBy === "created_asc") return new Date(a.created || 0).getTime() - new Date(b.created || 0).getTime();
      return new Date(b.created || 0).getTime() - new Date(a.created || 0).getTime();
    });

    return list;
  }, [assets, filterKind, filterStatus, filterBook, search, sortBy]);

  const wordsAndPhrases = React.useMemo(() => filteredAssets.filter(a => a.kind !== "sentence"), [filteredAssets]);
  const sentences = React.useMemo(() => filteredAssets.filter(a => a.kind === "sentence"), [filteredAssets]);

  const renderCard = (asset: any) => {
    const isSentence = asset.kind === "sentence";
    const quote = asset.sources && asset.sources[0] ? asset.sources[0].quote : "";
    const displayWord = isSentence && quote ? quote : asset.lemma;
    const assetKey = getTranslationAssetStorageKey(asset) || asset.lemma;
    const bookTitle = asset.sources && asset.sources[0] ? asset.sources[0].bookTitle : "未知";
    const isSelected = isSelectionMode && selected.has(assetKey);
    const isExpanded = expandedItems.has(assetKey);

    const handleCardClick = (e: React.MouseEvent) => {
        if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).closest('svg')) {
            return;
        }
        if (isSelectionMode) {
            toggleSelect(assetKey);
        } else {
            const newExpanded = new Set<string>();
            if (!expandedItems.has(assetKey)) {
                newExpanded.add(assetKey);
            }
            setExpandedItems(newExpanded);
        }
    };

    return (
        <WordCard 
            plugin={plugin}
            asset={asset}
            bookTitle={bookTitle}
            isExpanded={isExpanded}
            isSelected={isSelected}
            isSelectionMode={isSelectionMode}
            blurMode={blurMode}
            onToggleExpand={(lemma) => {
                const newExpanded = new Set(expandedItems);
                if (newExpanded.has(lemma)) {
                    newExpanded.delete(lemma);
                } else {
                    newExpanded.add(lemma);
                }
                setExpandedItems(newExpanded);
            }}
            onToggleSelect={toggleSelect}
            onToggleMastery={(lemma, mastered) => {
                if (plugin.settings.wordAssets[lemma]) {
                    plugin.settings.wordAssets[lemma].mastered = mastered;
                    plugin.saveSettings().then(() => loadAssets());
                }
            }}
            onDoubleClick={() => {}}
            contextMenuAdditionalItems={(menu) => {
                // Not strictly needed here as the base WordCard context menu handles mastery and deletion natively if we passed onDelete.
                // Wait, WordBookApp has its own handleDeleteSelected logic. We can just skip passing onDelete and pass contextMenuAdditionalItems if we want.
                // Actually WordBookApp deletes via handleDeleteSelected for bulk, but we can just let it have the default WordCard context menu.
            }}
        />
    );
  };

  const renderTableRow = (asset: any) => {
    const assetKey = getTranslationAssetStorageKey(asset) || asset.lemma;
    const isSentence = asset.kind === "sentence";
    const quote = asset.sources && asset.sources[0] ? asset.sources[0].quote : "";
    const displayWord = isSentence && quote ? quote : asset.lemma;
    const isSelected = isSelectionMode && selected.has(assetKey);
    const bookTitle = asset.sources && asset.sources[0] ? asset.sources[0].bookTitle : "未知";
    const isExpanded = expandedItems.has(assetKey);
    
    const handleRowClick = (e: React.MouseEvent) => {
        // Prevent toggle if clicking on an input or specific action button
        if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).closest('svg')) {
            return;
        }
        
        if (isSelectionMode) {
            toggleSelect(assetKey);
        } else {
            const newExpanded = new Set<string>();
            if (!expandedItems.has(assetKey)) {
                newExpanded.add(assetKey);
            }
            setExpandedItems(newExpanded);
        }
    };

    return (
      <tr 
        key={assetKey} 
        style={{ borderBottom: "1px solid var(--background-modifier-border)", background: isSelected ? "var(--background-modifier-hover)" : "transparent", cursor: "pointer" }}
        onContextMenu={(e) => handleContextMenu(e, assetKey)}
        onClick={handleRowClick}
      >
        {isSelectionMode && (
          <td style={{ padding: "8px" }}>
            <input type="checkbox" checked={isSelected} onChange={() => {}} />
          </td>
        )}
        <td style={{ padding: "8px", fontWeight: "bold" }}>
          <div className={blurMode === "word" ? "jarvis-blur-test" : ""} style={{ display: "inline-block" }}>
            <span 
              style={{ 
                cursor: "pointer", 
                color: asset.mastered ? "var(--color-green)" : "var(--color-red)",
                ...(isSentence ? { fontWeight: "normal", fontSize: "0.9em" } : {})
              }}
              onMouseEnter={(e) => (e.target as HTMLElement).style.textDecoration = "underline"}
              onMouseLeave={(e) => (e.target as HTMLElement).style.textDecoration = "none"}
              onClick={(e) => { e.stopPropagation(); playAudio(displayWord); }}
            >
              {displayWord}
            </span>
            {!isSentence && asset.phonetic && <div style={{ fontSize: "0.8em", color: "var(--text-muted)", fontWeight: "normal" }}>{asset.phonetic}</div>}
          </div>
        </td>
        <td style={{ padding: "8px", fontSize: "0.9em", color: "var(--text-muted)" }}>
          {asset.translation && (
            <div 
              className={blurMode === "translation" ? "jarvis-blur-test" : ""}
              style={{ 
                color: "var(--text-normal)", 
                marginBottom: "4px", 
                whiteSpace: isExpanded ? "normal" : "pre-wrap"
              }}
            >
              {isExpanded && asset.display ? (
                  <div>
                      <MarkdownPreview content={asset.display} plugin={plugin} />
                  </div>
              ) : (
                  asset.translation
              )}
            </div>
          )}
        </td>
        <td style={{ padding: "8px", fontSize: "0.9em", cursor: isSelectionMode ? "pointer" : "default" }} onClick={() => isSelectionMode && toggleSelect(assetKey)}>{bookTitle}</td>
        <td style={{ padding: "8px", cursor: isSelectionMode ? "pointer" : "default" }}>
          <span 
              style={{ 
                color: asset.mastered ? "var(--color-green)" : "var(--text-faint)", 
                display: "flex", 
                alignItems: "center",
                cursor: "pointer",
                width: "fit-content"
              }}
              className="clickable-icon" 
              onClick={(e) => { e.stopPropagation(); handleToggleSingleMastery(e, assetKey); }}
              title={asset.mastered ? "已掌握 (点击标记为未掌握)" : "未掌握 (点击标记为已掌握)"}
          >
            {asset.mastered ? (
              <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
            ) : (
              <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle></svg>
            )}
          </span>
        </td>
      </tr>
    );
  };

  const showFilterMenu = React.useCallback((e: React.MouseEvent) => {
    const menu = new Menu();

    menu.addItem(item => item.setTitle("显示所有状态").setChecked(filterStatus === "all").onClick(() => setFilterStatus("all")));
    menu.addItem(item => item.setTitle("已掌握").setChecked(filterStatus === "mastered").onClick(() => setFilterStatus("mastered")));
    menu.addItem(item => item.setTitle("未掌握").setChecked(filterStatus === "unmastered").onClick(() => setFilterStatus("unmastered")));
    
    menu.addSeparator();

    menu.addItem(item => item.setTitle("时间降序 (最新)").setChecked(sortBy === "created_desc").onClick(() => setSortBy("created_desc")));
    menu.addItem(item => item.setTitle("时间升序 (最早)").setChecked(sortBy === "created_asc").onClick(() => setSortBy("created_asc")));
    menu.addItem(item => item.setTitle("字母顺序").setChecked(sortBy === "alpha_asc").onClick(() => setSortBy("alpha_asc")));
    menu.addItem(item => item.setTitle("文章位置").setChecked(sortBy === "cfi_asc").onClick(() => setSortBy("cfi_asc")));

    menu.addSeparator();

    if (booksMap.size > 0) {
      menu.addSeparator();
      menu.addItem(item => item.setTitle("书籍：所有书籍").setChecked(filterBook === "all").onClick(() => setFilterBook("all")));
      Array.from(booksMap.entries()).forEach(([path, title]) => {
        menu.addItem(item => item.setTitle(`书籍：${title}`).setChecked(filterBook === path).onClick(() => setFilterBook(path)));
      });
    }

    menu.showAtMouseEvent(e.nativeEvent);
  }, [filterStatus, sortBy, viewMode, blurMode, filterBook, booksMap]);

  return (
    <div className="jarvis-word-book-app" style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <style>{`
        .jarvis-blur-test {
          filter: blur(5px);
          opacity: 0.6;
          transition: all 0.2s ease;
        }
        .jarvis-blur-test:hover {
          filter: blur(0);
          opacity: 1;
        }
      `}</style>

      {/* Modal for PDF Export */}
      {exportState === "select_template" && (
        <div className="jarvis-modal-overlay" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.6)", zIndex: 999, display: "flex", justifyContent: "center", alignItems: "center" }}>
          <div className="jarvis-modal-content" style={{ background: "var(--background-primary)", padding: "24px", borderRadius: "var(--radius-l)", width: "400px", boxShadow: "0 4px 16px rgba(0,0,0,0.2)", border: "1px solid var(--background-modifier-border)" }}>
            <h3 style={{ marginTop: 0 }}>选择导出模板</h3>
            <p style={{ color: "var(--text-muted)", fontSize: "0.9em" }}>为你挑选的 {selected.size} 个词条选择用于 PDF 打印的模板格式：</p>
            <div style={{ display: "flex", flexDirection: "column", gap: "12px", margin: "24px 0" }}>
              <button className="mod-cta" onClick={() => executeExport("full")} style={{ padding: "12px" }}>完整对照版 (英文 + 译文 + 例句)</button>
              <button className="mod-cta" onClick={() => executeExport("hide_zh")} style={{ padding: "12px", background: "var(--interactive-normal)", color: "var(--text-normal)" }}>默写中文版 (缺释义，留白手写)</button>
              <button className="mod-cta" onClick={() => executeExport("hide_en")} style={{ padding: "12px", background: "var(--interactive-normal)", color: "var(--text-normal)" }}>默写英文版 (缺单词，留白手写)</button>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button onClick={() => setExportState("none")}>取消</button>
            </div>
          </div>
        </div>
      )}

      {/* Header & Controls */}
      <div className="jarvis-word-book-header" style={{ padding: "16px", borderBottom: "1px solid var(--background-modifier-border)", flexShrink: 0 }}>
        <h2>英语词句本</h2>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "12px", alignItems: "center" }}>
          <input 
            type="text" 
            placeholder="搜索..." 
            value={search} 
            onChange={e => setSearch(e.target.value)} 
            style={{ width: "200px" }}
          />
          <div style={{ display: "flex", background: "var(--background-modifier-form-field)", borderRadius: "var(--radius-s)", padding: "2px" }}>
            {[ { id: "all", label: "全部" }, { id: "word", label: "单词" }, { id: "phrase", label: "短语" }, { id: "sentence", label: "长句" } ].map(item => (
              <div 
                key={item.id}
                onClick={() => setFilterKind(item.id as any)}
                style={{
                  padding: "4px 12px",
                  fontSize: "0.9em",
                  cursor: "pointer",
                  borderRadius: "var(--radius-s)",
                  background: filterKind === item.id ? "var(--background-modifier-active-hover)" : "transparent",
                  color: filterKind === item.id ? "var(--text-normal)" : "var(--text-muted)",
                  fontWeight: filterKind === item.id ? "bold" : "normal",
                  transition: "all 0.2s ease"
                }}
              >
                {item.label}
              </div>
            ))}
          </div>
          
          <button 
            className="clickable-icon jarvis-reader-filter-btn" 
            onClick={showFilterMenu}
            aria-label="筛选与排序"
            style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "4px 8px", background: "var(--background-modifier-form-field)" }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="svg-icon lucide-filter"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
            <span style={{ marginLeft: "6px", fontSize: "0.9em" }}>筛选排序</span>
          </button>
          
          <div style={{ width: "1px", height: "24px", background: "var(--background-modifier-border)", margin: "0 4px" }}></div>
          <span style={{ fontSize: "0.9em", color: "var(--text-muted)" }}>视图：</span>
          <select value={viewMode} onChange={e => setViewMode(e.target.value as any)}>
            <option value="grid">卡片网格</option>
            <option value="table">紧凑表格</option>
            <option value="single">单卡模式</option>
          </select>
          <span style={{ fontSize: "0.9em", color: "var(--text-muted)", marginLeft: "4px" }}>模糊：</span>
          <select value={blurMode} onChange={e => setBlurMode(e.target.value as any)}>
            <option value="none">关闭</option>
            <option value="word">模糊原文</option>
            <option value="translation">模糊译文</option>
          </select>
        </div>
        
        {/* Bulk Actions */}
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          {!isSelectionMode ? (
            <React.Fragment>
              <button onClick={() => setIsSelectionMode(true)} className="mod-cta">批量管理 / 导出</button>
              {filterBook !== "all" && filteredAssets.length > 0 && (
                <button 
                  onClick={handleDeleteFilteredBookWords} 
                  style={{ backgroundColor: 'var(--color-red)', color: 'white', border: 'none' }}
                >
                  🗑️ 一键删除此书词条
                </button>
              )}
            </React.Fragment>
          ) : (
            <>
              <span style={{ fontSize: "0.9em", color: "var(--text-muted)", marginRight: "8px" }}>
                已选 {selected.size} / {filteredAssets.length}
              </span>
              <button onClick={toggleSelectAll}>全选</button>
              <button onClick={invertSelection}>反选</button>
              <button onClick={() => handleMarkMastered(true)} disabled={selected.size === 0}>标记为已掌握</button>
              <button onClick={() => handleMarkMastered(false)} disabled={selected.size === 0}>标记为未掌握</button>
              <button onClick={handleDeleteSelected} disabled={selected.size === 0} style={{ color: "var(--text-error)" }}>彻底删除</button>
              <div style={{ flex: 1 }}></div>
              <button onClick={() => { setIsSelectionMode(false); setSelected(new Set()); }}>取消</button>
              <button onClick={handleExportPrint} disabled={selected.size === 0} className="mod-cta">导出打印笔记</button>
            </>
          )}
        </div>
      </div>

      {/* Main Content Area */}
      <div className={`jarvis-word-book-${viewMode}-wrap`} style={{ flex: 1, overflow: "auto", padding: viewMode === "grid" ? "16px" : "0" }}>
        {filteredAssets.length === 0 ? (
          <div style={{ padding: "32px", textAlign: "center", color: "var(--text-muted)" }}>没有匹配的词条。</div>
        ) : viewMode === "grid" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
            {wordsAndPhrases.length > 0 && (
              <div>
                <h3 style={{ marginTop: 0, marginBottom: "16px", paddingBottom: "8px", borderBottom: "1px solid var(--background-modifier-border)" }}>单词 & 短语</h3>
                <div className="jarvis-word-book-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "16px" }}>
                  {wordsAndPhrases.map(renderCard)}
                </div>
              </div>
            )}
            {sentences.length > 0 && (
              <div>
                <h3 style={{ marginTop: wordsAndPhrases.length > 0 ? "16px" : 0, marginBottom: "16px", paddingBottom: "8px", borderBottom: "1px solid var(--background-modifier-border)" }}>长句</h3>
                <div className="jarvis-word-book-grid" style={{ display: "grid", gridTemplateColumns: "1fr", gap: "16px" }}>
                  {sentences.map(renderCard)}
                </div>
              </div>
            )}
          </div>
        ) : viewMode === "table" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "32px", padding: "16px" }}>
            {wordsAndPhrases.length > 0 && (
              <div>
                <h3 style={{ marginTop: 0, marginBottom: "16px", paddingBottom: "8px" }}>单词 & 短语</h3>
                <table className="jarvis-word-book-table" style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
                  <thead style={{ position: "sticky", top: 0, background: "var(--background-secondary)", zIndex: 1 }}>
                    <tr>
                      {isSelectionMode && <th style={{ padding: "8px", width: "40px", borderBottom: "1px solid var(--background-modifier-border)" }}></th>}
                      <th style={{ padding: "8px", borderBottom: "1px solid var(--background-modifier-border)" }}>词条</th>
                      <th style={{ padding: "8px", borderBottom: "1px solid var(--background-modifier-border)", width: "40%" }}>释义</th>
                      <th style={{ padding: "8px", borderBottom: "1px solid var(--background-modifier-border)", width: "20%" }}>书籍</th>
                      <th style={{ padding: "8px", borderBottom: "1px solid var(--background-modifier-border)", width: "80px" }}>状态</th>
                    </tr>
                  </thead>
                  <tbody>{wordsAndPhrases.map(renderTableRow)}</tbody>
                </table>
              </div>
            )}
            {sentences.length > 0 && (
              <div>
                <h3 style={{ marginTop: 0, marginBottom: "16px", paddingBottom: "8px" }}>长句</h3>
                <table className="jarvis-word-book-table" style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
                  <thead style={{ position: "sticky", top: 0, background: "var(--background-secondary)", zIndex: 1 }}>
                    <tr>
                      {isSelectionMode && <th style={{ padding: "8px", width: "40px", borderBottom: "1px solid var(--background-modifier-border)" }}></th>}
                      <th style={{ padding: "8px", borderBottom: "1px solid var(--background-modifier-border)" }}>词条</th>
                      <th style={{ padding: "8px", borderBottom: "1px solid var(--background-modifier-border)", width: "40%" }}>释义</th>
                      <th style={{ padding: "8px", borderBottom: "1px solid var(--background-modifier-border)", width: "20%" }}>书籍</th>
                      <th style={{ padding: "8px", borderBottom: "1px solid var(--background-modifier-border)", width: "80px" }}>状态</th>
                    </tr>
                  </thead>
                  <tbody>{sentences.map(renderTableRow)}</tbody>
                </table>
              </div>
            )}
          </div>
        ) : viewMode === "single" ? (
          <div 
            className="jarvis-word-book-single-mode" 
            style={{ display: "flex", justifyContent: "center", alignItems: "center", padding: "40px", height: "100%", overflow: "hidden" }}
            onWheel={(e) => {
              if (singleCardFlipped) return; // Allow scrolling inside the back side without switching
              e.preventDefault();
              if (e.deltaY > 0) {
                setSingleCardIndex(i => (i + 1) % filteredAssets.length);
                setSingleCardFlipped(false);
              } else if (e.deltaY < 0) {
                setSingleCardIndex(i => (i - 1 + filteredAssets.length) % filteredAssets.length);
                setSingleCardFlipped(false);
              }
            }}
          >
            {(() => {
              const activeIndex = singleCardIndex % filteredAssets.length;
              const activeAsset = filteredAssets[activeIndex];
              if (!activeAsset) return null;
              
              const activeAssetKey = getTranslationAssetStorageKey(activeAsset) || activeAsset.lemma;
              const typeLabel = activeAsset.kind === "sentence" ? "长句" : (activeAsset.kind === "phrase" ? "短语" : "单词");
              const titleText = activeAsset.title || activeAsset.lemma;
              const posText = activeAsset.pos ? `${activeAsset.pos} · ` : "";
              
              let titleFontSize = "4em";
              if (activeAsset.kind === "sentence") {
                if (titleText.length > 200) titleFontSize = "1.5em";
                else if (titleText.length > 100) titleFontSize = "1.8em";
                else if (titleText.length > 50) titleFontSize = "2.2em";
                else titleFontSize = "2.5em";
              } else if (titleText.length > 20) {
                titleFontSize = "2.5em";
              }

              return (
                <div 
                  className="jarvis-single-card"
                  style={{
                    width: "800px",
                    maxWidth: "100%",
                    height: "500px",
                    background: "var(--background-primary)",
                    borderRadius: "16px",
                    boxShadow: "0 10px 30px rgba(0,0,0,0.1)",
                    border: "1px solid var(--background-modifier-border)",
                    display: "flex",
                    flexDirection: "column",
                    position: "relative"
                  }}
                  onClick={() => !singleCardFlipped && setSingleCardFlipped(true)}
                >
                  {!singleCardFlipped ? (
                    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "80px 40px 40px", cursor: "pointer", position: "relative" }}>
                      {/* Top Left: Type Label */}
                      <div style={{ position: "absolute", top: "24px", left: "24px", fontSize: "1.1em", color: "var(--text-muted)", background: "var(--background-secondary)", padding: "4px 12px", borderRadius: "8px" }}>
                        {posText}{typeLabel}
                      </div>

                      {/* Top Right: Mastery Status */}
                      <div style={{ position: "absolute", top: "24px", right: "24px" }}>
                        <button 
                          className="clickable-icon" 
                          onClick={(e) => handleToggleSingleMastery(e, activeAssetKey)} 
                          aria-label={activeAsset.mastered ? "标记为未掌握" : "标记为已掌握"} 
                          style={{ 
                            color: activeAsset.mastered ? "var(--color-green)" : "var(--text-faint)", 
                            width: "28px",
                            height: "28px",
                            padding: "0", 
                            border: activeAsset.mastered ? "1px solid var(--color-green)" : "1px solid var(--text-faint)", 
                            borderRadius: "50%", 
                            display: "flex", 
                            alignItems: "center", 
                            justifyContent: "center" 
                          }}
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
                        </button>
                      </div>

                      {/* Center: Word + Audio Icon */}
                      <div style={{ position: "relative", display: "inline-flex", alignItems: activeAsset.kind === "sentence" ? "flex-start" : "center", justifyContent: "center", width: activeAsset.kind === "sentence" ? "100%" : "auto" }}>
                        <div style={{ fontSize: titleFontSize, fontFamily: "serif", textAlign: activeAsset.kind === "sentence" ? "left" : "center", lineHeight: 1.4, padding: "0 20px", width: "100%", wordBreak: "break-word", whiteSpace: "pre-wrap" }}>{titleText}</div>
                        {activeAsset.kind !== "sentence" && (
                          <div style={{ position: "absolute", left: "100%" }}>
                            <button className="clickable-icon" onClick={(e) => { e.stopPropagation(); playAudio(activeAsset.lemma); }} aria-label="发音" title="发音" style={{ opacity: 0.7 }}>
                              <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path><path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path></svg>
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Bottom: "查看释义" button */}
                      <div style={{ marginTop: "auto", paddingTop: "40px" }}>
                        <button className="mod-cta" onClick={(e) => { e.stopPropagation(); setSingleCardFlipped(true); }}>查看释义</button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "40px", overflowY: "auto" }} onWheel={e => e.stopPropagation()}>
                      <div style={{ display: "flex", flexDirection: "column", marginBottom: "24px", flexShrink: 0, borderLeft: "4px solid var(--interactive-accent)", borderRadius: "8px", paddingLeft: "16px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <div style={{ fontSize: activeAsset.kind === "sentence" ? "1.4em" : "2.5em", fontFamily: "serif", lineHeight: 1.3 }}>{titleText}</div>
                          {activeAsset.kind !== "sentence" && (
                            <button className="clickable-icon" onClick={(e) => { playAudio(activeAsset.lemma); }} aria-label="发音" title="发音" style={{ opacity: 0.7 }}>
                              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path><path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path></svg>
                            </button>
                          )}
                        </div>
                        {activeAsset.phonetic && (
                          <div style={{ fontSize: "1.1em", color: "var(--text-muted)", fontStyle: "italic", marginTop: "8px" }}>
                            {activeAsset.phonetic}
                          </div>
                        )}
                      </div>
                      {activeAsset.kind !== "sentence" && activeAsset.sources && activeAsset.sources[0]?.quote && activeAsset.sources[0].quote.trim() !== activeAsset.lemma.trim() && activeAsset.sources[0].quote.trim() !== titleText.trim() && (
                        <div style={{ marginBottom: "20px", padding: "16px", background: "var(--background-secondary)", borderRadius: "8px", borderLeft: "4px solid var(--interactive-accent)", flexShrink: 0 }}>
                           <div style={{ fontStyle: "italic", color: "var(--text-normal)", lineHeight: 1.5 }}>
                             {activeAsset.sources[0].quote}
                           </div>
                        </div>
                      )}
                      <div style={{ fontSize: "1.2em", lineHeight: 1.6, flex: "1 1 auto", color: "var(--text-normal)", minHeight: "min-content" }}>
                         <MarkdownPreview content={activeAsset.display || activeAsset.translation || ""} plugin={plugin} />
                      </div>
                      {activeAsset.sources && activeAsset.sources[0] && (
                        <div style={{ marginTop: "24px", paddingTop: "16px", borderTop: "1px dashed var(--background-modifier-border)", color: "var(--text-muted)", fontSize: "0.9em", display: "flex", justifyContent: "space-between", flexShrink: 0 }}>
                           <span>来源</span>
                           <span>{activeAsset.sources[0].bookTitle || activeAsset.sources[0].bookPath} {activeAsset.sources[0].chapterTitle ? ` · ${activeAsset.sources[0].chapterTitle}` : ""}</span>
                        </div>
                      )}
                      <div style={{ marginTop: "32px", display: "flex", justifyContent: "center", flexShrink: 0 }}>
                        <button onClick={() => setSingleCardFlipped(false)}>回到正面</button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        ) : null}
      </div>
    </div>
  );
}
