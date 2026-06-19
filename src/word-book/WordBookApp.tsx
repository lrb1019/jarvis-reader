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
import { ReviewSession } from "./ReviewSession";
import { WordBookStats } from "./WordBookStats";
import { getDueCards } from "./SpacedRepetition";

export function WordBookApp({ plugin }: WordBookAppProps) {
  const [assets, setAssets] = React.useState<WordAsset[]>([]);
  const [search, setSearch] = React.useState("");
  const [filterKind, setFilterKind] = React.useState("all");
  const [filterStatus, setFilterStatus] = React.useState("all");
  const [filterBook, setFilterBook] = React.useState("all");
  const [sortBy, setSortBy] = React.useState("created_desc");
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [isSelectionMode, setIsSelectionMode] = React.useState(false);
  const [exportState, setExportState] = React.useState<"none" | "select_template">("none");
  const [blurMode, setBlurMode] = React.useState<"none" | "word" | "translation">("none");
  const [expandedItems, setExpandedItems] = React.useState<Set<string>>(new Set());
  const [isReviewMode, setIsReviewMode] = React.useState(false);
  const [isStatsMode, setIsStatsMode] = React.useState(false);
  const [showFilterMenuPopup, setShowFilterMenuPopup] = React.useState(false);
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
    const confirmed = await confirmDestructiveAction(plugin.app, "删除词条", `确定要彻底删除选中的 ${selected.size} 个词条吗？此操作不可恢复。`);
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

    const confirmed = await confirmDestructiveAction(plugin.app, "删除本书词条", `确定要彻底删除正在显示的这本书的 ${filteredAssets.length} 个词条吗？此操作不可恢复。`);
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
    await plugin.persistWordAssetSidecar("save");
    await plugin.saveSettings();
    new Notice(`已将 ${count} 个词条标记为${mastered ? "已掌握" : "未掌握"}`);
    loadAssets();
  };

  const handleToggleSingleMastery = async (e: React.MouseEvent, lemma: string) => {
    e.stopPropagation();
    if (plugin.settings.wordAssets[lemma]) {
      const current = plugin.settings.wordAssets[lemma].mastered;
      plugin.settings.wordAssets[lemma].mastered = !current;
      await plugin.persistWordAssetSidecar("save");
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
                    await plugin.persistWordAssetSidecar("save");
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
                        await plugin.persistWordAssetSidecar("delete");
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
    <h1 style="${baseStyle} margin: 0 !important; font-size: 1.5em !important; font-weight: 700 !important; color: #0f172a !important; padding: 0 !important;">英语词条</h1>
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
        const fileName = `${folderPath ? folderPath + "/" : ""}英语词条_${suffix}_${dateStr}.md`;
        
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

  const words = React.useMemo(() => filteredAssets.filter(a => a.kind === "word"), [filteredAssets]);
  const phrases = React.useMemo(() => filteredAssets.filter(a => a.kind === "phrase"), [filteredAssets]);
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
                    plugin.persistWordAssetSidecar("save").then(() => plugin.saveSettings()).then(() => loadAssets());
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

  const formatDays = (dateStr: string | undefined) => {
    if (!dateStr) return "新词";
    const diff = new Date(dateStr).getTime() - new Date().getTime();
    const days = Math.ceil(diff / (1000 * 3600 * 24));
    if (days < 0) return "已超期";
    if (days === 0) return "今日";
    return `${days}天后`;
  };

  const renderTableRow = (asset: any, showTagsColumn: boolean = false) => {
    const isSentence = asset.kind === "sentence";
    const quote = asset.sources && asset.sources[0] ? asset.sources[0].quote : "";
    const displayWord = isSentence ? quote || asset.lemma : asset.title || asset.lemma;
    const assetKey = isSentence ? getTranslationAssetStorageKey(asset) : asset.lemma;
    const bookTitle = asset.sources && asset.sources[0] ? asset.sources[0].bookTitle || "未知书籍" : "手动添加";
    const isExpanded = expandedItems.has(assetKey);
    const isSelected = selected.has(assetKey);

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
        style={{ borderBottom: "1px solid var(--background-modifier-border)", background: isSelected ? "color-mix(in srgb, var(--interactive-accent) 8%, transparent)" : "transparent", cursor: "pointer" }}
        onContextMenu={(e) => handleContextMenu(e, assetKey)}
        onClick={handleRowClick}
      >
        {isSelectionMode && (
          <td style={{ padding: "12px 8px" }}>
            <input type="checkbox" checked={isSelected} onChange={() => {}} />
          </td>
        )}
        <td style={{ padding: "12px 8px", fontWeight: "bold" }}>
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
        {showTagsColumn && (
          <td style={{ padding: "12px 8px" }}>
            {asset.isWord && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginTop: "4px" }}>
                {asset.oxford === 1 && (
                  <span className="jarvis-tag" style={{ background: "color-mix(in srgb, var(--color-blue) 20%, transparent)", color: "var(--color-blue)", border: "1px solid color-mix(in srgb, var(--color-blue) 40%, transparent)", fontSize: "0.75em", padding: "1px 6px", borderRadius: "12px", fontWeight: "normal" }}>牛津核心</span>
                )}
                {asset.collins && asset.collins > 0 && (
                  <span className="jarvis-tag" style={{ background: "color-mix(in srgb, var(--color-yellow) 20%, transparent)", color: "var(--color-yellow)", border: "1px solid color-mix(in srgb, var(--color-yellow) 40%, transparent)", fontSize: "0.75em", padding: "1px 6px", borderRadius: "12px", fontWeight: "normal" }}>{'★'.repeat(asset.collins)}</span>
                )}
                {asset.tags?.map((tag: string) => (
                  <span key={tag} className="jarvis-tag" style={{ background: "color-mix(in srgb, var(--color-green) 15%, transparent)", color: "var(--color-green)", fontSize: "0.75em", padding: "1px 6px", borderRadius: "12px", border: "1px solid color-mix(in srgb, var(--color-green) 40%, transparent)", fontWeight: "normal" }}>{tag.toUpperCase()}</span>
                ))}
              </div>
            )}
          </td>
        )}
        <td style={{ padding: "12px 8px", fontSize: "0.9em", color: "var(--text-muted)" }}>
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
        <td style={{ padding: "12px 8px", fontSize: "0.9em", color: "var(--text-muted)", cursor: isSelectionMode ? "pointer" : "default" }} onClick={() => isSelectionMode && toggleSelect(assetKey)}>{bookTitle}</td>
        <td style={{ padding: "12px 8px", fontSize: "0.9em", color: "var(--color-orange)", textAlign: "center" }}>{asset.reviews || 0}</td>
        <td style={{ padding: "12px 8px", fontSize: "0.9em", textAlign: "center" }}>{asset.ease?.toFixed(2) || "2.50"}</td>
        <td style={{ padding: "12px 8px", fontSize: "0.9em", color: "var(--text-muted)", textAlign: "center" }}>{formatDays(asset.nextReviewDate)}</td>
        <td style={{ padding: "12px 8px", cursor: isSelectionMode ? "pointer" : "default" }}>
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



  const dueCards = React.useMemo(() => getDueCards(assets, filterBook), [assets, filterBook]);
  const stats = React.useMemo(() => {
    let total = 0;
    let mastered = 0;
    assets.forEach(a => {
      if (filterBook !== "all") {
        if (!a.sources?.some(s => s.bookPath === filterBook)) return;
      }
      total++;
      if (a.mastered) mastered++;
    });
    return { total, mastered, due: dueCards.length, learning: total - mastered - dueCards.length };
  }, [assets, filterBook, dueCards]);

  if (isReviewMode) {
    return <ReviewSession plugin={plugin} dueAssets={dueCards} onComplete={() => setIsReviewMode(false)} onAssetUpdate={loadAssets} />;
  }

  if (isStatsMode) {
    return <WordBookStats plugin={plugin} assets={assets} onClose={() => setIsStatsMode(false)} />;
  }

  return (
    <div className="jarvis-library-app jarvis-word-book-app" style={{ height: "100%", overflow: "hidden", display: "flex", flexDirection: "column" }}>
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

      <div className="jarvis-library-home" style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
        {/* Header toolbar (Modelled after LibraryApp) */}
        <div className="jarvis-library-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexShrink: 0 }}>
          <div style={{ flex: 1 }}>
            <h2 style={{ margin: 0, fontSize: '24px', fontWeight: 700 }}>英语词条</h2>
          </div>

          {/* Center Search Input */}
          <div className="jarvis-library-search-wrap" style={{ flex: 1.5, display: 'flex', justifyContent: 'center' }}>
            <svg className="jarvis-search-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
            <input
              type="text"
              placeholder="搜索词条、释义..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="jarvis-library-search-input"
            />
            {search && (
              <button className="jarvis-library-search-clear" onClick={() => setSearch("")}>
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              </button>
            )}
          </div>

          {/* Right side controls */}
          <div className="jarvis-library-header-right" style={{ flex: 1, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '12px' }}>
            <div style={{ position: 'relative', display: 'flex', gap: '8px' }}>
              <button 
                className={`jarvis-library-filter-btn ${showFilterMenuPopup ? 'is-active' : ''}`} 
                onClick={() => setShowFilterMenuPopup(!showFilterMenuPopup)} 
                title="筛选与排序"
              >
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>
              </button>

              {showFilterMenuPopup && (
                <div className="jarvis-library-filter-popup" style={{ right: 0, minWidth: "200px" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    <div style={{ fontSize: "0.85em", color: "var(--text-muted)", fontWeight: "bold", borderBottom: "1px solid var(--background-modifier-border)", paddingBottom: "4px" }}>筛选与排序</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      <span style={{ fontSize: "0.8em", color: "var(--text-muted)" }}>类型</span>
                      <select value={filterKind} onChange={(e) => setFilterKind(e.target.value as any)} className="jarvis-library-select" style={{ width: "100%" }}>
                        <option value="all">所有类型</option>
                        <option value="word">单词</option>
                        <option value="phrase">短语</option>
                        <option value="sentence">长句</option>
                      </select>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      <span style={{ fontSize: "0.8em", color: "var(--text-muted)" }}>状态</span>
                      <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="jarvis-library-select" style={{ width: "100%" }}>
                        <option value="all">所有状态</option>
                        <option value="mastered">已掌握</option>
                        <option value="unmastered">未掌握</option>
                      </select>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      <span style={{ fontSize: "0.8em", color: "var(--text-muted)" }}>排序</span>
                      <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="jarvis-library-select" style={{ width: "100%" }}>
                        <option value="created_desc">时间降序</option>
                        <option value="created_asc">时间升序</option>
                        <option value="alpha_asc">字母顺序</option>
                        <option value="cfi_asc">文章位置</option>
                      </select>
                    </div>
                    {booksMap.size > 0 && (
                      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                        <span style={{ fontSize: "0.8em", color: "var(--text-muted)" }}>来源书籍</span>
                        <select value={filterBook} onChange={(e) => setFilterBook(e.target.value)} className="jarvis-library-select" style={{ width: "100%", textOverflow: "ellipsis" }}>
                          <option value="all">所有书籍</option>
                          {Array.from(booksMap.entries()).map(([path, title]) => (
                            <option key={path} value={path}>{title}</option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="jarvis-library-header-actions">
              <button className="jarvis-library-action-icon-btn" title="插件设置" onClick={() => {
                const setting = (plugin as any).app.setting;
                setting.open();
                setting.openTabById(plugin.manifest.id);
              }}>
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
              </button>
            </div>
          </div>
        </div>

        {/* Stats Panel & Action Buttons above the list (Modelled after Library detail tabs and back button Capsule styles) */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px", background: "var(--background-secondary)", padding: "14px 20px", borderRadius: "12px", border: "1px solid var(--background-modifier-border)", flexShrink: 0 }}>
          {/* Metadata Display */}
          <div style={{ display: "flex", gap: "24px" }}>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <span style={{ fontSize: "0.85em", color: "var(--text-muted)" }}>总词汇</span>
              <span style={{ fontSize: "1.15em", fontWeight: "600", color: "var(--text-normal)" }}>{stats.total}</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <span style={{ fontSize: "0.85em", color: "var(--color-green)" }}>已掌握</span>
              <span style={{ fontSize: "1.15em", fontWeight: "600", color: "var(--color-green)" }}>{stats.mastered}</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <span style={{ fontSize: "0.85em", color: "var(--interactive-accent)" }}>学习中</span>
              <span style={{ fontSize: "1.15em", fontWeight: "600", color: "var(--interactive-accent)" }}>{stats.learning}</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <span style={{ fontSize: "0.85em", color: "var(--color-red)" }}>待复习</span>
              <span style={{ fontSize: "1.15em", fontWeight: "600", color: "var(--color-red)" }}>{stats.due}</span>
            </div>
          </div>

          {/* Buttons and Blur filter */}
          <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginRight: "8px" }}>
              <span style={{ fontSize: "0.85em", color: "var(--text-muted)" }}>模糊：</span>
              <select value={blurMode} onChange={e => setBlurMode(e.target.value as any)} className="jarvis-library-select" style={{ padding: "4px 8px" }}>
                <option value="none">无</option>
                <option value="word">模糊单词</option>
                <option value="translation">模糊译文</option>
              </select>
            </div>

            <button 
              className="jarvis-library-back-btn" 
              onClick={() => setIsStatsMode(true)}
              style={{ padding: "6px 16px !important" }}
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '4px' }}><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>
              详细统计
            </button>
            <button 
              className="jarvis-library-back-btn" 
              onClick={() => setIsReviewMode(true)}
              disabled={stats.due === 0}
              style={{
                padding: "6px 16px !important",
                background: stats.due > 0 ? "var(--interactive-accent) !important" : "var(--background-secondary) !important",
                color: stats.due > 0 ? "var(--text-on-accent) !important" : "var(--text-muted) !important",
                borderColor: stats.due > 0 ? "var(--interactive-accent) !important" : "var(--background-modifier-border) !important"
              }}
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '4px' }}><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
              开始记忆
            </button>
          </div>
        </div>

        {/* Bulk Actions */}
        <div style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "16px", flexShrink: 0 }}>
          {!isSelectionMode ? (
            <React.Fragment>
              <button onClick={() => setIsSelectionMode(true)} className="jarvis-library-back-btn" style={{ padding: "6px 14px !important" }}>批量管理 / 导出</button>
              {filterBook !== "all" && filteredAssets.length > 0 && (
                <button 
                  onClick={handleDeleteFilteredBookWords} 
                  className="jarvis-library-back-btn"
                  style={{ backgroundColor: 'var(--color-red) !important', color: 'white !important', borderColor: 'var(--color-red) !important', padding: "6px 14px !important" }}
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '4px' }}><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                  一键删除此书词条
                </button>
              )}
            </React.Fragment>
          ) : (
            <>
              <span style={{ fontSize: "0.9em", color: "var(--text-muted)", marginRight: "8px" }}>
                已选 {selected.size} / {filteredAssets.length}
              </span>
              <button className="jarvis-library-back-btn" style={{ padding: "6px 12px !important" }} onClick={toggleSelectAll}>全选</button>
              <button className="jarvis-library-back-btn" style={{ padding: "6px 12px !important" }} onClick={invertSelection}>反选</button>
              <button className="jarvis-library-back-btn" style={{ padding: "6px 12px !important" }} onClick={() => handleMarkMastered(true)} disabled={selected.size === 0}>标记为已掌握</button>
              <button className="jarvis-library-back-btn" style={{ padding: "6px 12px !important" }} onClick={() => handleMarkMastered(false)} disabled={selected.size === 0}>标记为未掌握</button>
              <button className="jarvis-library-back-btn" style={{ padding: "6px 12px !important", color: "var(--text-error) !important", borderColor: "var(--text-error) !important" }} onClick={handleDeleteSelected} disabled={selected.size === 0}>彻底删除</button>
              <div style={{ flex: 1 }}></div>
              <button className="jarvis-library-back-btn" style={{ padding: "6px 12px !important" }} onClick={() => { setIsSelectionMode(false); setSelected(new Set()); }}>取消</button>
              <button className="jarvis-library-back-btn" style={{ padding: "6px 12px !important", background: "var(--interactive-accent) !important", color: "var(--text-on-accent) !important", borderColor: "var(--interactive-accent) !important" }} onClick={handleExportPrint} disabled={selected.size === 0}>导出打印笔记</button>
            </>
          )}
        </div>

        {/* Main Content Area */}
        <div className={`jarvis-library-list`} style={{ flex: 1, overflow: "auto", padding: "0 4px 20px 4px", minHeight: 0 }}>
          {filteredAssets.length === 0 ? (
            <div style={{ padding: "32px", textAlign: "center", color: "var(--text-muted)" }}>没有匹配的词条。</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "32px" }}>
              {words.length > 0 && (
                <div>
                  <h3 style={{ marginTop: 0, marginBottom: "16px", paddingBottom: "8px", borderBottom: "1px solid var(--background-modifier-border)" }}>单词</h3>
                  <table className="jarvis-library-table" style={{ width: "100%", tableLayout: "fixed", borderCollapse: "collapse", textAlign: "left", fontSize: "13px" }}>
                    <thead style={{ position: "sticky", top: 0, background: "var(--background-primary)", zIndex: 1 }}>
                      <tr style={{ borderBottom: "1px solid var(--background-modifier-border)", color: "var(--text-muted)" }}>
                        {isSelectionMode && <th style={{ padding: "12px 8px", width: "40px" }}></th>}
                        <th style={{ padding: "12px 8px", fontWeight: "600", fontSize: "var(--font-ui-small)" }}>词条</th>
                        <th style={{ padding: "12px 8px", fontWeight: "600", fontSize: "var(--font-ui-small)", width: "15%" }}>标签</th>
                        <th style={{ padding: "12px 8px", fontWeight: "600", fontSize: "var(--font-ui-small)", width: "30%" }}>释义</th>
                        <th style={{ padding: "12px 8px", fontWeight: "600", fontSize: "var(--font-ui-small)", width: "15%" }}>书籍</th>
                        <th style={{ padding: "12px 8px", fontWeight: "600", fontSize: "var(--font-ui-small)", width: "80px", textAlign: "center" }}>复习次数</th>
                        <th style={{ padding: "12px 8px", fontWeight: "600", fontSize: "var(--font-ui-small)", width: "80px", textAlign: "center" }}>难度(Ease)</th>
                        <th style={{ padding: "12px 8px", fontWeight: "600", fontSize: "var(--font-ui-small)", width: "100px", textAlign: "center" }}>下次复习</th>
                        <th style={{ padding: "12px 8px", fontWeight: "600", fontSize: "var(--font-ui-small)", width: "60px" }}>状态</th>
                      </tr>
                    </thead>
                    <tbody>{words.map(a => renderTableRow(a, true))}</tbody>
                  </table>
                </div>
              )}
              {phrases.length > 0 && (
                <div>
                  <h3 style={{ marginTop: 0, marginBottom: "16px", paddingBottom: "8px", borderBottom: "1px solid var(--background-modifier-border)" }}>短语</h3>
                  <table className="jarvis-library-table" style={{ width: "100%", tableLayout: "fixed", borderCollapse: "collapse", textAlign: "left", fontSize: "13px" }}>
                    <thead style={{ position: "sticky", top: 0, background: "var(--background-primary)", zIndex: 1 }}>
                      <tr style={{ borderBottom: "1px solid var(--background-modifier-border)", color: "var(--text-muted)" }}>
                        {isSelectionMode && <th style={{ padding: "12px 8px", width: "40px" }}></th>}
                        <th style={{ padding: "12px 8px", fontWeight: "600", fontSize: "var(--font-ui-small)" }}>词条</th>
                        <th style={{ padding: "12px 8px", fontWeight: "600", fontSize: "var(--font-ui-small)", width: "30%" }}>释义</th>
                        <th style={{ padding: "12px 8px", fontWeight: "600", fontSize: "var(--font-ui-small)", width: "15%" }}>书籍</th>
                        <th style={{ padding: "12px 8px", fontWeight: "600", fontSize: "var(--font-ui-small)", width: "80px", textAlign: "center" }}>复习次数</th>
                        <th style={{ padding: "12px 8px", fontWeight: "600", fontSize: "var(--font-ui-small)", width: "80px", textAlign: "center" }}>难度(Ease)</th>
                        <th style={{ padding: "12px 8px", fontWeight: "600", fontSize: "var(--font-ui-small)", width: "100px", textAlign: "center" }}>下次复习</th>
                        <th style={{ padding: "12px 8px", fontWeight: "600", fontSize: "var(--font-ui-small)", width: "60px" }}>状态</th>
                      </tr>
                    </thead>
                    <tbody>{phrases.map(a => renderTableRow(a, false))}</tbody>
                  </table>
                </div>
              )}
              {sentences.length > 0 && (
                <div>
                  <h3 style={{ marginTop: 0, marginBottom: "16px", paddingBottom: "8px", borderBottom: "1px solid var(--background-modifier-border)" }}>长句</h3>
                  <table className="jarvis-library-table" style={{ width: "100%", tableLayout: "fixed", borderCollapse: "collapse", textAlign: "left", fontSize: "13px" }}>
                    <thead style={{ position: "sticky", top: 0, background: "var(--background-primary)", zIndex: 1 }}>
                      <tr style={{ borderBottom: "1px solid var(--background-modifier-border)", color: "var(--text-muted)" }}>
                        {isSelectionMode && <th style={{ padding: "12px 8px", width: "40px" }}></th>}
                        <th style={{ padding: "12px 8px", fontWeight: "600", fontSize: "var(--font-ui-small)" }}>词条</th>
                        <th style={{ padding: "12px 8px", fontWeight: "600", fontSize: "var(--font-ui-small)", width: "30%" }}>释义</th>
                        <th style={{ padding: "12px 8px", fontWeight: "600", fontSize: "var(--font-ui-small)", width: "15%" }}>书籍</th>
                        <th style={{ padding: "12px 8px", fontWeight: "600", fontSize: "var(--font-ui-small)", width: "80px", textAlign: "center" }}>复习次数</th>
                        <th style={{ padding: "12px 8px", fontWeight: "600", fontSize: "var(--font-ui-small)", width: "80px", textAlign: "center" }}>难度(Ease)</th>
                        <th style={{ padding: "12px 8px", fontWeight: "600", fontSize: "var(--font-ui-small)", width: "100px", textAlign: "center" }}>下次复习</th>
                        <th style={{ padding: "12px 8px", fontWeight: "600", fontSize: "var(--font-ui-small)", width: "60px" }}>状态</th>
                      </tr>
                    </thead>
                    <tbody>{sentences.map(a => renderTableRow(a, false))}</tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
