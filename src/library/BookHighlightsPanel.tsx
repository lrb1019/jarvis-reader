import React from "react";
import { MarkdownRenderer, Notice, TFile, setIcon } from "obsidian";
import type JarvisReaderPlugin from "../main";
import type { BookHighlight } from "../types";
import { getLibraryHighlightLinks, getLibraryHighlightNoteEntries, type LibraryHighlight } from "./library-highlight-core";

interface BookHighlightsPanelProps {
  plugin: JarvisReaderPlugin;
  book: TFile;
  title: string;
  highlights: LibraryHighlight[];
  onJump: (book: TFile, highlight: BookHighlight) => void;
}

function formatDate(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
}

function formatDateTime(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const parts = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")];
  return `${parts.join("-")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function ObsidianIcon({ name }: { name: string }) {
  const ref = React.useRef<HTMLSpanElement>(null);
  React.useEffect(() => {
    if (ref.current) setIcon(ref.current, name);
  }, [name]);
  return <span ref={ref} style={{ width: "13px", height: "13px", display: "inline-flex" }} />;
}

function MarkdownText({ content, plugin }: { content: string; plugin: JarvisReaderPlugin }) {
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.empty();
    void MarkdownRenderer.render(plugin.app, content, element, "", plugin).catch(console.error);
  }, [content, plugin]);
  return <div ref={ref} className="jarvis-library-markdown" />;
}

export function BookHighlightsPanel({ plugin, book, title, highlights, onJump }: BookHighlightsPanelProps) {
  if (!highlights.length) {
    return <div className="jarvis-library-tab-empty"><p>本书暂无划线或笔记。在阅读器中选中文本即可添加。</p></div>;
  }
  const normalColor = plugin.settings.highlightColors?.normal || "#ffeb3b";

  const openLink = async (linkPath: string) => {
    const file = plugin.app.metadataCache.getFirstLinkpathDest(linkPath, "");
    if (file instanceof TFile) await plugin.app.workspace.getLeaf(false).openFile(file);
    else new Notice(`未找到文件: ${linkPath}`);
  };

  return (
    <div className="jarvis-library-highlights-list">
      {highlights.map((highlight) => {
        const notes = getLibraryHighlightNoteEntries(highlight);
        const links = getLibraryHighlightLinks(highlight);
        const hasDetails = notes.length > 0 || links.length > 0;
        const quoteStyle: React.CSSProperties = hasDetails ? {
          borderLeftColor: "var(--interactive-accent)", background: "none", padding: "0 0 0 12px", borderLeftWidth: "3px", borderLeftStyle: "solid",
        } : {
          borderLeftColor: normalColor, background: `color-mix(in srgb, ${normalColor} 12%, transparent)`, padding: "6px 10px 6px 12px", borderRadius: "0 6px 6px 0", borderLeftWidth: "3px", borderLeftStyle: "solid",
        };
        return (
          <div key={highlight.id || highlight.blockId} className="jarvis-library-highlight-card">
            <div className="hl-card-header">
              <span className="hl-card-chapter">{highlight.chapterTitle || "正文章节"}</span>
              <span className="hl-card-date">{formatDate(highlight.updated || highlight.created)}</span>
            </div>
            <div className="hl-card-body">
              <blockquote className="hl-card-quote" style={quoteStyle}><p>{highlight.quote || "原文内容暂时不可用"}</p></blockquote>
              {!!notes.length && <div className="hl-card-notes-container" style={{ marginTop: "10px", display: "flex", flexDirection: "column", gap: "8px" }}>
                {notes.map((entry, index) => <div key={`${entry.created}-${index}`} className="jarvis-reader-highlight-note-card" style={{ padding: "8px 10px", marginTop: "4px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", fontWeight: 600, color: "var(--text-normal)", marginBottom: "4px" }}>
                    <ObsidianIcon name="sticky-note" /><span>{entry.label}</span>
                    <span style={{ marginLeft: "auto", fontWeight: "normal", fontSize: "11px", color: "var(--text-muted)" }}>{formatDateTime(entry.created)}</span>
                  </div>
                  <div style={{ fontSize: "13px", color: "var(--text-normal)" }}><MarkdownText content={entry.text} plugin={plugin} /></div>
                </div>)}
              </div>}
              {!!links.length && <div className="hl-card-assoc-container" style={{ marginTop: "12px", display: "flex", flexDirection: "column", gap: "4px", borderTop: "1px solid var(--background-modifier-border)", paddingTop: "8px" }}>
                {links.map((link, index) => {
                  const [linkPath = "", linkTime] = link.split("|");
                  const displayText = linkPath.includes("#^") ? linkPath.replace("#^", " > ^") : linkPath.replace("#", " > ");
                  return <div key={`${link}-${index}`} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "2px 0", minHeight: "28px" }}>
                    <span style={{ color: "var(--text-muted)" }}>•</span><ObsidianIcon name="link" />
                    <a className="internal-link" style={{ cursor: "pointer", textDecoration: "underline", color: "var(--link-color)", fontSize: "13px", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} onClick={() => void openLink(linkPath)}>{displayText}</a>
                    {linkTime && <span style={{ marginLeft: "auto", fontSize: "11px", color: "var(--text-muted)", opacity: 0.8 }}>{formatDateTime(linkTime)}</span>}
                  </div>;
                })}
              </div>}
            </div>
            <div className="hl-card-actions">
              <button className="hl-card-action-btn" onClick={() => {
                const note = highlight.comment ? `（感想：${highlight.comment}）` : "";
                void navigator.clipboard.writeText(`《${title}》：「${highlight.quote || ""}」${note}`).then(() => new Notice("高亮已复制到剪贴板"));
              }}>复制内容</button>
              <button className="hl-card-action-btn action-jump" onClick={() => onJump(book, highlight as BookHighlight)}>跳转原文 →</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
