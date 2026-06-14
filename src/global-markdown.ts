import React from "react";
import ReactDOM from "react-dom";
import { Notice, setIcon } from "obsidian";
import { getJarvisReaderCodeMirrorModules } from "./wiki-editor";
import { lookupLocalDictionary } from "./word-assets";
import { translateSelectionWithApi } from "./translation";
import { getTranslationAssetKey, buildWordAssetFromSelection } from "./word-assets";

export function truncateWordDisplay(value: string): string {
  const raw = String(value || "");
  if (raw.length <= 8000) return raw;
  return raw.slice(0, 8000) + "\n... (truncated)";
}

export function renderWordCardDisplayText(text: string): React.ReactNode[] | string {
  const value = String(text || "");
  const parts: React.ReactNode[] = [];
  const pattern = /(\*\*|__)([\s\S]+?)\1/g;
  let lastIndex = 0;
  let match = null;
  while ((match = pattern.exec(value))) {
    if (match.index > lastIndex) {
      parts.push(value.slice(lastIndex, match.index));
    }
    parts.push(React.createElement("strong", { key: `bold-${parts.length}` }, match[2]));
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < value.length) {
    parts.push(value.slice(lastIndex));
  }
  return parts.length ? parts : value;
}

export function getWordCardDisplayLineMeta(line: string) {
  const raw = String(line || "");
  const trimmed = raw.trim();
  if (/^#{1,6}\s+/.test(trimmed)) {
    return {
      className: "jarvis-reader-word-card-display-heading",
      text: trimmed.replace(/^#{1,6}\s+/, "")
    };
  }
  if (/^>\s*/.test(trimmed)) {
    return {
      className: "jarvis-reader-word-card-display-quote",
      text: trimmed.replace(/^>\s*/, "")
    };
  }
  if (/^(?:[-*]|\d+[.)])\s+/.test(trimmed)) {
    return {
      className: "jarvis-reader-word-card-display-list",
      text: trimmed.replace(/^(?:[-*]|\d+[.)])\s+/, "")
    };
  }
  return {
    className: "jarvis-reader-word-card-display-line",
    text: raw
  };
}

export interface GlobalTranslationCardProps {
  word: string;
  sentence?: string;
  rect: { left: number; top: number; right: number; bottom: number };
  plugin: any;
  onClose: () => void;
  hoverMode?: boolean;
}

export const GlobalTranslationCard: React.FC<GlobalTranslationCardProps> = ({
  word,
  sentence = "",
  rect,
  plugin,
  onClose,
  hoverMode = false
}) => {
  const [status, setStatus] = React.useState<"loading" | "ready" | "error">("loading");
  const [result, setResult] = React.useState<any>(null);
  const [error, setError] = React.useState<string>("");
  const [isSaved, setIsSaved] = React.useState<boolean>(false);
  const [isMastered, setIsMastered] = React.useState<boolean>(false);
  
  const cardRef = React.useRef<HTMLDivElement | null>(null);

  const renderObsidianIcon = (name: string) => {
    return React.createElement("span", {
      "aria-hidden": "true",
      className: "jarvis-reader-word-card-action-icon",
      ref: (element) => {
        if (!element) return;
        while (element.firstChild) {
          element.removeChild(element.firstChild);
        }
        if (typeof setIcon === "function") {
          setIcon(element, name);
        }
      }
    });
  };

  // Check if already in dictionary
  const getSavedAsset = () => {
    const assets = plugin.settings.wordAssets || {};
    return assets[word.toLowerCase()];
  };

  const loadTranslation = async () => {
    try {
      const saved = getSavedAsset();
      if (saved) {
        setResult(saved);
        setIsSaved(true);
        setIsMastered(!!saved.mastered);
        setStatus("ready");
        return;
      }

      setStatus("loading");
      // Use offline ECDICT lookup
      const localResult = await lookupLocalDictionary(plugin.settings, word, plugin.app);
      if (localResult) {
        setResult(localResult);
        setStatus("ready");
      } else {
        if (hoverMode) {
          setError("No offline translation found.");
          setStatus("error");
          return;
        }
        // Selection mode -> prompt for AI or offline query
        setError("未找到离线释义。");
        setStatus("error");
      }
    } catch (err: any) {
      setError(err?.message || "Translation failed.");
      setStatus("error");
    }
  };

  React.useEffect(() => {
    loadTranslation();
  }, [word]);

  // Handle Save
  const handleSave = async () => {
    if (!result) return;
    try {
      const assetKey = getTranslationAssetKey({ quote: word, sentence }, result);
      if (!assetKey) {
        new Notice("Failed to save word.");
        return;
      }
      const existing = (plugin.settings.wordAssets || {})[assetKey];
      // Build dummy file reference for source
      const activeFile = plugin.app.workspace.getActiveFile();
      const dummyFile = activeFile || { path: "markdown_selection", basename: "Markdown File" };
      const asset = buildWordAssetFromSelection(
        dummyFile as any,
        { quote: word, sentence },
        result,
        existing,
        plugin.settings
      );
      if (!asset) {
        new Notice("Failed to build word asset.");
        return;
      }
      plugin.settings.wordAssets = plugin.settings.wordAssets || {};
      plugin.settings.wordAssets[asset.lemma] = asset;
      await plugin.persistWordAssetSidecar("save");
      await plugin.saveSettings();
      setIsSaved(true);
      new Notice("已保存到全局词库");
      
      // Force refresh current CodeMirror views to reflect new highlights
      plugin.app.workspace.iterateAllLeaves((leaf: any) => {
        if (leaf.view && leaf.view.editor && leaf.view.editor.cm) {
          leaf.view.editor.cm.dispatch({});
        }
      });
    } catch (err) {
      new Notice("Save failed.");
    }
  };

  // Handle AI Translation
  const handleAiTranslate = async () => {
    try {
      setStatus("loading");
      const onlineResult = await translateSelectionWithApi(plugin.settings, word, sentence, plugin.app, { forceAi: true });
      if (onlineResult) {
        setResult(onlineResult);
        setStatus("ready");
      } else {
        setError("AI 翻译失败。");
        setStatus("error");
      }
    } catch (err: any) {
      setError(err?.message || "AI 翻译失败。");
      setStatus("error");
    }
  };

  // Toggle Mastered (Hover Mode)
  const handleToggleMastered = async () => {
    if (!result) return;
    try {
      const nextMastered = !isMastered;
      const updated = {
        ...result,
        mastered: nextMastered,
        updated: new Date().toISOString()
      };
      plugin.settings.wordAssets[word.toLowerCase()] = updated;
      await plugin.persistWordAssetSidecar("save");
      await plugin.saveSettings();
      setIsMastered(nextMastered);
      new Notice(nextMastered ? "已标记掌握" : "已重新加入词库");
      
      // Force refresh highlights
      plugin.app.workspace.iterateAllLeaves((leaf: any) => {
        if (leaf.view && leaf.view.editor && leaf.view.editor.cm) {
          leaf.view.editor.cm.dispatch({});
        }
      });
    } catch (err) {
      new Notice("操作失败。");
    }
  };

  // Delete Word (Hover Mode)
  const handleDeleteWord = async () => {
    try {
      delete plugin.settings.wordAssets[word.toLowerCase()];
      await plugin.persistWordAssetSidecar("delete");
      await plugin.saveSettingsData();
      new Notice("词条已彻底删除。");
      onClose();
      
      // Force refresh highlights
      plugin.app.workspace.iterateAllLeaves((leaf: any) => {
        if (leaf.view && leaf.view.editor && leaf.view.editor.cm) {
          leaf.view.editor.cm.dispatch({});
        }
      });
    } catch (err) {
      new Notice("删除失败。");
    }
  };

  // Play pronunciation
  const handlePlayAudio = () => {
    if (!result) return;
    const accent = plugin.settings.wordAudioAccent || "us";
    const audioUrl = `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(word)}&type=${accent === "uk" ? 1 : 2}`;
    const audio = new Audio(audioUrl);
    audio.play().catch(() => {});
  };

  // Position Card
  React.useEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const width = 360;
    const height = hoverMode ? 180 : 240;
    
    let x = rect.left;
    let topPos = rect.bottom + 8;
    
    if (x + width > window.innerWidth) {
      x = window.innerWidth - width - 16;
    }
    if (x < 16) x = 16;

    if (topPos + height > window.innerHeight) {
      topPos = rect.top - height - 8;
    }
    if (topPos < 16) topPos = 16;

    card.style.left = `${x}px`;
    card.style.top = `${topPos}px`;
    card.style.width = `${width}px`;
  }, [rect, hoverMode]);

  const renderWordDisplayContent = (display: string) => {
    return React.createElement("div", {
      className: "jarvis-reader-word-card-display"
    }, truncateWordDisplay(display || "").split(/\r?\n/).filter(line => line.trim()).map((line, index) => {
      const meta = getWordCardDisplayLineMeta(line);
      return React.createElement("div", {
        className: meta.className,
        key: index
      }, renderWordCardDisplayText(meta.text));
    }));
  };

  if (hoverMode) {
    // FIGURE 3 (Hover Card for Saved Words)
    return React.createElement("div", {
      className: "jarvis-reader-word-card",
      ref: cardRef,
      style: { position: "fixed" },
      onClick: (e) => e.stopPropagation()
    },
      React.createElement("div", { className: "jarvis-reader-word-card-head" },
        React.createElement("div", { className: "jarvis-reader-word-card-head-row" },
          React.createElement("button", {
            className: "jarvis-reader-word-card-lemma",
            onClick: handlePlayAudio,
            title: "点击发音",
            style: { color: "#c62828", background: "none", border: "none", cursor: "pointer", fontWeight: "bold", padding: 0 }
          }, word),
          React.createElement("div", { className: "jarvis-reader-word-card-actions" },
            React.createElement("button", {
              className: "jarvis-reader-word-card-action jarvis-reader-word-card-mastered",
              title: isMastered ? "标记未掌握" : "标记已掌握",
              onClick: handleToggleMastered,
              style: { color: isMastered ? "var(--interactive-accent)" : "" }
            }, renderObsidianIcon("check")),
            React.createElement("button", {
              className: "jarvis-reader-word-card-action jarvis-reader-word-card-delete",
              title: "删除词条",
              onClick: handleDeleteWord
            }, renderObsidianIcon("trash"))
          )
        ),
        result && React.createElement("div", { className: "jarvis-reader-word-phonetic" }, result.phonetic ? `/${result.phonetic}/` : "")
      ),
      React.createElement("div", {
        className: plugin.settings.blurWordCardBody ? "jarvis-reader-word-card-body is-blurred" : "jarvis-reader-word-card-body",
        style: { marginTop: "4px" }
      },
        React.createElement("div", {
          style: {
            background: "var(--background-primary)",
            border: "1px solid color-mix(in srgb, var(--background-modifier-border) 70%, transparent)",
            borderRadius: "10px",
            padding: "10px 12px",
            display: "flex",
            flexDirection: "column",
            gap: "6px"
          }
        },
          result?.display ? renderWordDisplayContent(result.display) : React.createElement("div", { className: "jarvis-reader-word-translation" }, result?.translation || "")
        )
      ),
      result?.sources && result.sources.length > 0 && React.createElement("div", {
        className: "jarvis-reader-word-card-sources",
        style: { fontSize: "11px", color: "var(--text-faint)", marginTop: "6px" }
      },
        React.createElement("div", { className: "jarvis-reader-word-card-source" },
          "来源: ", 
          result.sources[0].bookTitle || result.sources[0].bookPath.split("/").pop().replace(/\.epub$/i, "").replace(/\.md$/i, ""),
          result.sources[0].chapterTitle ? ` · ${result.sources[0].chapterTitle}` : ""
        )
      )
    );
  }

  // FIGURE 2 (Selection Translation Card)
  return React.createElement("div", {
    className: "jarvis-reader-highlight-popover is-floating jarvis-reader-word-translate",
    ref: cardRef,
    style: { position: "fixed" },
    onClick: (e) => e.stopPropagation()
  }, 
    React.createElement("div", {
      className: "jarvis-reader-highlight-title",
      style: { display: "flex", justifyContent: "space-between", alignItems: "center" }
    }, 
      React.createElement("span", null, "翻译"),
      React.createElement("button", {
        className: "jarvis-reader-word-card-action",
        onClick: onClose,
        style: { border: "none", background: "transparent", cursor: "pointer" }
      }, "✕")
    ),
    sentence && React.createElement("div", {
      className: "jarvis-reader-highlight-quote",
      style: { fontSize: "0.9em", color: "var(--text-muted)", background: "var(--background-secondary)", borderRadius: "8px", padding: "6px 8px", maxHeight: "60px", overflowY: "auto" }
    }, sentence),
    React.createElement("div", {
      className: "jarvis-reader-word-panel",
      style: { marginTop: "8px" }
    },
      status === "loading" && React.createElement("div", { className: "jarvis-reader-word-muted" }, "正在翻译..."),
      status === "error" && React.createElement("div", { 
        className: "jarvis-reader-word-error", 
        style: { display: "flex", flexDirection: "column", gap: "8px" } 
      }, 
        React.createElement("span", null, error),
        React.createElement("button", { 
          className: "jarvis-reader-highlight-button jarvis-reader-highlight-button-primary", 
          onClick: handleAiTranslate, 
          style: { alignSelf: "flex-start" } 
        }, "AI翻译")
      ),
      status === "ready" && result && React.createElement(React.Fragment, null,
        React.createElement("div", { className: "jarvis-reader-word-head" },
          React.createElement("button", {
            className: "jarvis-reader-word-lemma jarvis-reader-word-lemma-button",
            onClick: handlePlayAudio,
            style: { color: "var(--text-error)", fontWeight: "bold" }
          }, word),
          result.phonetic && React.createElement("div", { className: "jarvis-reader-word-phonetic" }, `[${result.phonetic}]`)
        ),
        result.display ? renderWordDisplayContent(result.display) : React.createElement("div", { className: "jarvis-reader-word-translation" }, result.translation)
      )
    ),
    React.createElement("div", { className: "jarvis-reader-highlight-actions", style: { marginTop: "10px" } },
      React.createElement("button", { className: "jarvis-reader-highlight-button", onClick: onClose }, "取消"),
      status === "ready" && React.createElement("button", { className: "jarvis-reader-highlight-button", onClick: handleAiTranslate }, "AI翻译"),
      isSaved ? React.createElement("div", { className: "jarvis-reader-word-saved", style: { display: "flex", alignItems: "center" } }, "✓ 已加入词库") :
        React.createElement("button", { 
          className: "jarvis-reader-highlight-button jarvis-reader-highlight-button-primary", 
          onClick: handleSave,
          disabled: status !== "ready"
        }, "保存单词")
    )
  );
};

export class GlobalTranslationManager {
  containerEl: HTMLDivElement | null = null;
  plugin: any;
  hideTimeout: any = null;

  constructor(plugin: any) {
    this.plugin = plugin;
  }

  ensureContainer() {
    if (!this.containerEl) {
      this.containerEl = document.createElement("div");
      this.containerEl.className = "jarvis-reader-global-translator-container";
      document.body.appendChild(this.containerEl);
    }
  }

  showSelectionCard(rect: { left: number; top: number; right: number; bottom: number }, word: string, sentence: string = "") {
    this.clearHideTimeout();
    this.ensureContainer();
    
    ReactDOM.unmountComponentAtNode(this.containerEl!);
    ReactDOM.render(
      React.createElement(GlobalTranslationCard, {
        word,
        sentence,
        rect,
        plugin: this.plugin,
        onClose: () => this.closeCard(),
        hoverMode: false
      }),
      this.containerEl!
    );
  }

  showHoverCard(targetEl: HTMLElement, word: string) {
    this.clearHideTimeout();
    this.ensureContainer();

    const rect = targetEl.getBoundingClientRect();
    
    ReactDOM.unmountComponentAtNode(this.containerEl!);
    ReactDOM.render(
      React.createElement(GlobalTranslationCard, {
        word,
        rect,
        plugin: this.plugin,
        onClose: () => this.closeCard(),
        hoverMode: true
      }),
      this.containerEl!
    );
  }

  hideHoverCardDelay() {
    this.clearHideTimeout();
    this.hideTimeout = setTimeout(() => {
      this.closeCard();
    }, 600);
  }

  clearHideTimeout() {
    if (this.hideTimeout) {
      clearTimeout(this.hideTimeout);
      this.hideTimeout = null;
    }
  }

  closeCard() {
    if (this.containerEl) {
      ReactDOM.unmountComponentAtNode(this.containerEl);
      this.containerEl.remove();
      this.containerEl = null;
    }
  }
}

// CodeMirror 6 Editor Extension
export function createWordHighlighterExtension(plugin: any): any {
  const cm = getJarvisReaderCodeMirrorModules();
  if (!cm) return [];

  const { ViewPlugin, Decoration } = cm.view;
  const { RangeSetBuilder } = cm.state;

  const buildDecorations = (view: any) => {
    const builder = new RangeSetBuilder();
    const assets = plugin.settings.wordAssets || {};
    
    // Filter to get unique set of saved single words
    const savedWords = new Set<string>();
    for (const key of Object.keys(assets)) {
      const asset = assets[key];
      if (asset && asset.kind === "word" && !asset.mastered) {
        savedWords.add(key.toLowerCase());
      }
    }

    if (savedWords.size === 0) {
      return builder.finish();
    }

    // Process only visible viewports
    for (const { from, to } of view.visibleRanges) {
      const text = view.state.doc.sliceString(from, to);
      const wordPattern = /[a-zA-Z]+(?:'[a-zA-Z]+)?/g;
      let match;
      
      while ((match = wordPattern.exec(text)) !== null) {
        const word = match[0];
        if (savedWords.has(word.toLowerCase())) {
          const start = from + match.index;
          const end = start + word.length;
          
          builder.add(
            start,
            end,
            Decoration.mark({
              class: "jarvis-reader-md-word-highlight",
              attributes: { "data-word": word }
            })
          );
        }
      }
    }
    return builder.finish();
  };

  return ViewPlugin.fromClass(
    class {
      decorations: any;
      constructor(view: any) {
        this.decorations = buildDecorations(view);
      }
      update(update: any) {
        if (update.docChanged || update.viewportChanged || update.selectionSet) {
          this.decorations = buildDecorations(update.view);
        }
      }
    },
    {
      decorations: (pluginInst: any) => pluginInst.decorations,
      eventHandlers: {
        mouseover(event: MouseEvent, view: any) {
          const target = event.target as HTMLElement;
          if (target && target.classList.contains("jarvis-reader-md-word-highlight")) {
            const word = target.getAttribute("data-word");
            if (word) {
              plugin.globalTranslationManager.showHoverCard(target, word);
            }
          }
        },
        mouseout(event: MouseEvent, view: any) {
          const target = event.target as HTMLElement;
          if (target && (target.classList.contains("jarvis-reader-md-word-highlight") || target.closest(".jarvis-reader-word-card"))) {
            plugin.globalTranslationManager.hideHoverCardDelay();
          }
        },
        mouseup(event: MouseEvent, view: any) {
          // Trigger selection translation popup on single words
          setTimeout(() => {
            const selection = view.state.selection.main;
            if (!selection || selection.empty) return;
            const selectedText = view.state.sliceDoc(selection.from, selection.to).trim();
            // Validate: single word, only letters, length >= 2
            if (/^[a-zA-Z]+(?:'[a-zA-Z]+)?$/.test(selectedText) && selectedText.length >= 2 && selectedText.length <= 30) {
              const docStr = view.state.doc.toString();
              const head = selection.head;
              
              // Look backward for sentence start (e.g. '.', '?', '!', '\n')
              let startOfSentence = 0;
              for (let i = head; i >= 0; i--) {
                const char = docStr[i];
                if (char === '.' || char === '?' || char === '!' || char === '\n') {
                  startOfSentence = i + 1;
                  break;
                }
              }
              
              // Look forward for sentence end
              let endOfSentence = docStr.length;
              for (let i = head; i < docStr.length; i++) {
                const char = docStr[i];
                if (char === '.' || char === '?' || char === '!') {
                  endOfSentence = i + 1;
                  break;
                } else if (char === '\n') {
                  endOfSentence = i;
                  break;
                }
              }
              
              const sentence = docStr.slice(startOfSentence, endOfSentence).trim();
              const rect = view.coordsAtPos(selection.head);
              if (rect) {
                plugin.globalTranslationManager.showSelectionCard(rect, selectedText, sentence);
              }
            }
          }, 20);
        }
      }
    }
  );
}

export function registerGlobalMarkdownFeatures(plugin: any) {
  plugin.globalTranslationManager = new GlobalTranslationManager(plugin);
  
  // Register the highlighter extension globally
  plugin.registerEditorExtension(createWordHighlighterExtension(plugin));
  
  // Clean up on unload
  plugin.register(() => {
    if (plugin.globalTranslationManager) {
      plugin.globalTranslationManager.closeCard();
    }
  });
}
