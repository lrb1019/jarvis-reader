import React from "react";
import { Notice, type TFile } from "obsidian";
import type JarvisReaderPlugin from "../main";
import type { BookBookmark } from "../types";
import { confirmDestructiveAction } from "../utils";

interface BookBookmarksPanelProps {
  plugin: JarvisReaderPlugin;
  book: TFile;
  bookmarks: BookBookmark[];
}

interface BookmarkReaderView {
  file?: TFile;
  jumpToCfi?: (cfi: string) => void;
}

export function BookBookmarksPanel({ plugin, book, bookmarks }: BookBookmarksPanelProps) {
  if (!bookmarks.length) {
    return <div className="jarvis-library-tab-empty"><p>本书暂无保存的书签。在阅读器中点击右侧悬浮栏的书签按钮即可添加。</p></div>;
  }

  const removeBookmark = async (bookmark: BookBookmark) => {
    const confirmed = await confirmDestructiveAction(plugin.app, "删除书签", `确认删除书签“${bookmark.title}”吗？`);
    if (!confirmed) return;
    try {
      await plugin.bookStateService.removeBookmark(book.path, bookmark);
      window.dispatchEvent(new CustomEvent("jarvis-reader-bookmarks-updated"));
    } catch (error) {
      console.error("Failed to remove bookmark", error);
      new Notice("书签删除失败，原书签已保留。");
    }
  };

  const jumpToBookmark = async (bookmark: BookBookmark) => {
    let found = false;
    plugin.app.workspace.iterateAllLeaves((leaf) => {
      if (leaf.view.getViewType() !== "epub") return;
      const reader = leaf.view as unknown as BookmarkReaderView;
      if (reader.file?.path !== book.path) return;
      reader.jumpToCfi?.(bookmark.cfi);
      plugin.app.workspace.setActiveLeaf(leaf, { focus: true });
      found = true;
    });
    if (found) return;
    const leaf = plugin.app.workspace.getLeaf(true);
    await leaf.openFile(book, { eState: { epubcifi: bookmark.cfi } });
    await plugin.openBookshelfPane(true);
  };

  return (
    <div className="jarvis-library-bookmarks-list" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      {[...bookmarks].sort((a, b) => b.created - a.created).map((bookmark) => (
        <div key={`${bookmark.cfi}-${bookmark.created}`} className="jarvis-library-bookmark-card hl-card">
          <div className="hl-card-content" style={{ paddingBottom: "12px" }}>
            <div style={{ fontWeight: "bold", fontSize: "1.1em", marginBottom: "4px", color: "var(--text-normal)" }}>{bookmark.title}</div>
            <div style={{ fontSize: "0.85em", color: "var(--text-muted)" }}>{new Date(bookmark.created).toLocaleString()}</div>
          </div>
          <div className="hl-card-actions">
            <button className="hl-card-action-btn" onClick={(event) => { event.stopPropagation(); void removeBookmark(bookmark); }}>删除</button>
            <button className="hl-card-action-btn action-jump" onClick={() => void jumpToBookmark(bookmark)}>跳转位置 →</button>
          </div>
        </div>
      ))}
    </div>
  );
}
