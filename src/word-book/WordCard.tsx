import * as React from "react";
import type JarvisReaderPlugin from "../main";
import { buildWordAudioUrl, getTranslationAssetStorageKey } from "../word-assets";
import { Notice, MarkdownRenderer, Menu } from "obsidian";
import type { WordAsset } from "../types";
import { confirmDestructiveAction } from "../utils";

export const MarkdownPreview = ({ content, plugin }: { content: string, plugin: JarvisReaderPlugin }) => {
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (ref.current) {
      ref.current.empty();
      MarkdownRenderer.render(plugin.app, content, ref.current, "", plugin as any).catch(console.error);
    }
  }, [content, plugin]);

  return <div ref={ref} className="jarvis-reader-markdown" />;
};

export interface WordCardProps {
  plugin: JarvisReaderPlugin;
  asset: WordAsset;
  bookTitle?: string;
  isExpanded?: boolean;
  isSelected?: boolean;
  isSelectionMode?: boolean;
  blurMode?: "none" | "word" | "translation";
  onToggleExpand?: (lemma: string) => void;
  onToggleSelect?: (lemma: string) => void;
  onToggleMastery?: (lemma: string, mastered: boolean) => void;
  onDelete?: (lemma: string) => void | Promise<void>;
  onDoubleClick?: (asset: WordAsset) => void;
  contextMenuAdditionalItems?: (menu: Menu) => void;
}

export const WordCard: React.FC<WordCardProps> = ({
  plugin,
  asset,
  bookTitle,
  isExpanded: controlledIsExpanded,
  isSelected = false,
  isSelectionMode = false,
  blurMode = "none",
  onToggleExpand,
  onToggleSelect,
  onToggleMastery,
  onDelete,
  onDoubleClick,
  contextMenuAdditionalItems
}) => {
  const [internalExpanded, setInternalExpanded] = React.useState(false);
  
  const isExpanded = controlledIsExpanded !== undefined ? controlledIsExpanded : internalExpanded;
  const assetKey = getTranslationAssetStorageKey(asset) || asset.lemma;
  
  const handleToggleExpand = () => {
    if (onToggleExpand) {
      onToggleExpand(assetKey);
    } else {
      setInternalExpanded(!internalExpanded);
    }
  };

  const handleCardClick = (e: React.MouseEvent) => {
    if (isSelectionMode && onToggleSelect) {
      onToggleSelect(assetKey);
    } else {
      handleToggleExpand();
    }
  };

  const isSentence = asset.kind === "sentence";
  const displayWord = isSentence ? (asset.sources?.[0]?.quote || "长句") : asset.lemma;

  const playAudio = (text: string) => {
    if (plugin.settings.enableWordAudio === false) return;
    try {
      const accent = plugin.settings.wordAudioAccent || "us";
      const template = plugin.settings.wordAudioTemplate || "https://dict.youdao.com/dictvoice?audio={{word}}&type={{type}}";
      const url = buildWordAudioUrl(template, text, accent);
      new Audio(url).play().catch(() => {});
    } catch(err) {
      console.warn("Jarvis Reader audio failed", err);
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    const menu = new Menu();
    let itemCount = 0;
    const isMastered = asset.mastered;

    if (onToggleMastery) {
      itemCount += 1;
      menu.addItem((item) => {
          item.setTitle(isMastered ? "标记为未掌握" : "标记为已掌握")
              .setIcon(isMastered ? "cross" : "checkmark")
              .onClick(() => onToggleMastery(assetKey, !isMastered));
      });
    }

    if (onDelete) {
      itemCount += 1;
      menu.addItem((item) => {
          item.setTitle("彻底删除")
              .setIcon("trash")
              .onClick(async () => {
                const confirmed = await confirmDestructiveAction(
                  plugin.app,
                  "删除词条",
                  `确定要彻底删除词条“${displayWord}”吗？此操作不可恢复。`
                );
                if (confirmed) {
                  await onDelete(assetKey);
                }
              });
      });
    }
    
    if (contextMenuAdditionalItems) {
        contextMenuAdditionalItems(menu);
    }

    if (itemCount > 0 || contextMenuAdditionalItems) {
        menu.showAtMouseEvent(e.nativeEvent);
    }
  };

  return (
    <div 
      key={assetKey} 
      style={{ 
        border: `1px solid ${isSelected ? "var(--interactive-accent)" : "var(--background-modifier-border)"}`,
        borderRadius: "var(--radius-m)",
        background: isSelected ? "color-mix(in srgb, var(--interactive-accent) 10%, transparent)" : "var(--background-secondary)",
        padding: "16px",
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        cursor: "pointer",
        position: "relative",
        transition: "all 0.15s ease",
        marginBottom: "8px"
      }}
      onClick={handleCardClick}
      onDoubleClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (onDoubleClick) onDoubleClick(asset);
      }}
      onContextMenu={handleContextMenu}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div className={blurMode === "word" ? "jarvis-blur-test" : ""} style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: "bold", fontSize: "1.2em", wordBreak: "break-word" }}>
            <span 
              style={{ 
                color: asset.mastered ? "var(--color-green)" : "var(--color-red)",
                ...(isSentence ? { display: "block", fontSize: "0.85em", lineHeight: "1.4", fontWeight: "normal", marginBottom: "8px" } : {})
              }}
              onMouseEnter={(e) => (e.target as HTMLElement).style.textDecoration = "underline"}
              onMouseLeave={(e) => (e.target as HTMLElement).style.textDecoration = "none"}
              onClick={(e) => { e.stopPropagation(); playAudio(displayWord); }}
              title="点击发音"
            >
              {displayWord}
            </span>
          </div>
          {!isSentence && asset.phonetic && <div style={{ fontSize: "0.85em", color: "var(--text-muted)", marginTop: "2px" }}>{asset.phonetic}</div>}
          {asset.isWord && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginTop: "6px" }}>
              {asset.oxford === 1 && (
                <span className="jarvis-tag" style={{ background: "color-mix(in srgb, var(--color-blue) 20%, transparent)", color: "var(--color-blue)", border: "1px solid color-mix(in srgb, var(--color-blue) 40%, transparent)", fontSize: "0.75em", padding: "1px 6px", borderRadius: "12px" }}>
                  牛津核心
                </span>
              )}
              {asset.collins && asset.collins > 0 && (
                <span className="jarvis-tag" style={{ background: "color-mix(in srgb, var(--color-yellow) 20%, transparent)", color: "var(--color-yellow)", border: "1px solid color-mix(in srgb, var(--color-yellow) 40%, transparent)", fontSize: "0.75em", padding: "1px 6px", borderRadius: "12px" }}>
                  {'★'.repeat(asset.collins)}
                </span>
              )}
              {asset.tags?.map((tag: string) => (
                <span key={tag} className="jarvis-tag" style={{ background: "color-mix(in srgb, var(--color-green) 15%, transparent)", color: "var(--color-green)", fontSize: "0.75em", padding: "1px 6px", borderRadius: "12px", border: "1px solid color-mix(in srgb, var(--color-green) 40%, transparent)" }}>
                  {tag.toUpperCase()}
                </span>
              ))}
            </div>
          )}
        </div>
        
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "8px", flexShrink: 0, marginLeft: "12px" }}>
          {isSelectionMode && (
            <input type="checkbox" checked={isSelected} onChange={() => {}} style={{ pointerEvents: "none" }} />
          )}
        </div>
      </div>
      
      {asset.translation && (
        <div 
          className={blurMode === "translation" ? "jarvis-blur-test" : ""}
          style={{ 
              fontSize: "0.95em", 
              color: "var(--text-normal)", 
              whiteSpace: isExpanded ? "normal" : "pre-wrap", 
              marginTop: "4px"
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
      
      {bookTitle && (
        <div style={{ marginTop: "auto", paddingTop: "8px", borderTop: "1px dashed var(--background-modifier-border)", fontSize: "0.8em", color: "var(--text-faint)" }}>
          {bookTitle}
        </div>
      )}
    </div>
  );
};
