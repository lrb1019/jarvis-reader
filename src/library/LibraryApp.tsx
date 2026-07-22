import * as React from "react";
import type JarvisReaderPlugin from "../main";
import { TFile, Notice, MarkdownRenderer, moment, Menu } from "obsidian";
import { openOrCreateNote, getOrCreateBookNote, getBookNotePath, findBookNote } from "../book-notes";
import { getHighlightsForBook } from "../highlights";
import { buildWordAudioUrl, DEFAULT_WORD_AUDIO_TEMPLATE, getTranslationAssetStorageKey } from "../word-assets";
import { confirmDestructiveAction, formatDuration, getBookTotalSeconds } from "../utils";
import type { BookHighlight, WordAsset, BookProgress } from "../types";
import { WordCard } from "../word-book/WordCard";
import { BookBookmarksPanel } from "./BookBookmarksPanel";
import { BookHighlightsPanel } from "./BookHighlightsPanel";
import type { LibraryHighlight } from "./library-highlight-core";

export interface LibraryAppProps {
  plugin: JarvisReaderPlugin;
}

type LibrarySortBy = "recent" | "name" | "rating" | "start" | "end";

interface EpubManifestItem {
  id?: string;
  href?: string;
  type?: string;
}

// 直接读取 Blob 为 Base64，完全避免 canvas 渲染可能带来的像素损失
const createCoverThumbnail = async (url: string): Promise<string> => {
  try {
    const response = await fetch(url);
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    throw error;
  }
};

// Simple helper to format dates nicely
function formatDate(dateStr?: string | number): string {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
  } catch (err) {
    return String(dateStr);
  }
}

function formatDateTime(dateStr?: string | number): string {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr);
    if (!Number.isNaN(d.getTime())) {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      const hours = String(d.getHours()).padStart(2, "0");
      const minutes = String(d.getMinutes()).padStart(2, "0");
      return `${year}-${month}-${day} ${hours}:${minutes}`;
    }
  } catch (err) {}
  return String(dateStr);
}

interface ObsidianIconProps {
  name: string;
  className?: string;
  style?: React.CSSProperties;
}

const ObsidianIcon: React.FC<ObsidianIconProps> = ({ name, className = "", style }) => {
  const ref = React.useRef<HTMLSpanElement>(null);
  
  React.useEffect(() => {
    const element = ref.current;
    if (!element) return;
    while (element.firstChild) {
      element.removeChild(element.firstChild);
    }
    const { setIcon } = require("obsidian");
    if (typeof setIcon === "function") {
      setIcon(element, name);
    }
  }, [name]);
  
  return <span ref={ref} className={className} style={{ display: "inline-flex", alignItems: "center", ...style }} />;
};

// Strip HTML tags
function stripHtml(text: string): string {
  return text.replace(/<[^>]*>/g, "").trim();
}

// Clean title and author names from file name
function parseBookInfo(file: TFile): { title: string; author: string } {
  let title = file.basename;
  let author = "未知作者";
  const m = title.match(/^(.*?)(?:[?(](.*?)[?)])?(?:\s*[-_]\s*.*)?$/);
  if (m) {
    title = m[1].trim();
    if (m[2]) {
      author = m[2].trim();
    } else {
      const dashMatch = title.match(/^(.*?)\s*-\s*(.*)$/);
      if (dashMatch) {
        title = dashMatch[1].trim();
        author = dashMatch[2].trim();
      }
    }
  }
  return { title, author };
}

// Unified Book Status Resolver
function resolveBookStatus(fm: any, percentage: number): "finished" | "reading" | "unread" {
  if (fm?.status === "finished" || percentage === 100) return "finished";
  if (fm?.status === "reading" || percentage > 0 || (fm?.start_date && fm.start_date !== "0" && fm.start_date !== "-")) return "reading";
  return "unread";
}

function formatBookStatus(status: "finished" | "reading" | "unread"): string {
  return status === "finished" ? "已读完" : status === "reading" ? "在读" : "未读";
}

// Simple Markdown previewer
const MarkdownText = ({ content, plugin }: { content: string; plugin: JarvisReaderPlugin }) => {
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (ref.current) {
      ref.current.empty();
      MarkdownRenderer.render(plugin.app, content, ref.current, "", plugin as any).catch(console.error);
    }
  }, [content, plugin]);
  return <div ref={ref} className="jarvis-library-markdown" />;
};

export function LibraryApp({ plugin }: LibraryAppProps) {
  // Navigation & UI States
  const [currentView, setCurrentView] = React.useState<"home" | "detail" | "stats">("home");
  const [activeBook, setActiveBook] = React.useState<TFile | null>(null);
  const [detailHighlights, setDetailHighlights] = React.useState<LibraryHighlight[]>([]);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [filterStatus, setFilterStatus] = React.useState<"all" | "unread" | "reading" | "finished">("all");
  const [sortBy, setSortBy] = React.useState<LibrarySortBy>("recent");
  const [viewLayout, setViewLayout] = React.useState<"grid" | "list">("grid");
  const [activeTab, setActiveTab] = React.useState<"highlights" | "words" | "bookmarks">("highlights");
  const [descExpanded, setDescExpanded] = React.useState(false);
  const [showFilters, setShowFilters] = React.useState(false);
  const [showLayoutMenu, setShowLayoutMenu] = React.useState(false);

  // Metadata States
  const [bookMetadata, setBookMetadata] = React.useState<{
    status: string;
    rating: number;
    tags: string[];
    startDate: string;
    finishDate: string;
    summary: string;
  }>({ status: "unread", rating: 0, tags: [], startDate: "", finishDate: "", summary: "" });
  const [tagInput, setTagInput] = React.useState("");
  const [isEditingIntro, setIsEditingIntro] = React.useState(false);
  const [gridCols, setGridCols] = React.useState(6);
  const [selectedGridBook, setSelectedGridBook] = React.useState<string | null>(null);
  const [bookNotesMap, setBookNotesMap] = React.useState<Record<string, TFile>>({});
  const homeRef = React.useRef<HTMLDivElement>(null);

  const [books, setBooks] = React.useState<TFile[]>([]);
  const [booksLoaded, setBooksLoaded] = React.useState(false);
  const [coverCache, setCoverCache] = React.useState<Record<string, any>>(plugin.settings.bookCoverCache || {});
  const [statsTab, setStatsTab] = React.useState<"week" | "month" | "year" | "all">("week");
  const [statsDate, setStatsDate] = React.useState<Date>(() => new Date());
  const [statsChartType, setStatsChartType] = React.useState<"bar" | "calendar" | "heatmap">("bar");
  const [debugImages, setDebugImages] = React.useState<{href: string, size: number, dataUrl: string}[] | null>(null);

  const [refreshTrigger, setRefreshTrigger] = React.useState(0);
  const [expandedItems, setExpandedItems] = React.useState<Set<string>>(new Set());

  const handleToggleSingleMastery = async (e: React.MouseEvent, lemma: string) => {
    e.stopPropagation();
    if (plugin.settings.wordAssets[lemma]) {
      const current = plugin.settings.wordAssets[lemma].mastered;
      await plugin.wordAssetService.setMastered(lemma, !current);
      setRefreshTrigger(p => p + 1);
    }
  };

  const handleDeleteWord = async (lemma: string) => {
    const confirmed = await confirmDestructiveAction(plugin.app, "删除词条", `确定要彻底删除词条 "${lemma}" 吗？此操作不可恢复。`);
    if (!confirmed) return;
    if (!plugin.settings.wordAssets[lemma]) return;
    await plugin.wordAssetService.delete(lemma);
    setRefreshTrigger(p => p + 1);
    new Notice(`已彻底删除词条：${lemma}`);
  };

  const renderTableRow = (asset: any) => {
    const assetKey = getTranslationAssetStorageKey(asset) || asset.lemma;
    const isSentence = asset.kind === "sentence";
    const quote = asset.sources && asset.sources[0] ? asset.sources[0].quote : "";
    const displayWord = isSentence && quote ? quote : asset.lemma;
    const isExpanded = expandedItems.has(assetKey);
    
    const handleRowClick = (e: React.MouseEvent) => {
        if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).closest('svg')) {
            return;
        }
        
        const newExpanded = new Set<string>();
        if (!expandedItems.has(assetKey)) {
            newExpanded.add(assetKey);
        }
        setExpandedItems(newExpanded);
    };

    return (
      <tr 
        key={assetKey} 
        style={{ borderBottom: "1px solid var(--background-modifier-border)", cursor: "pointer" }}
        onClick={handleRowClick}
        onContextMenu={(e) => {
          e.preventDefault();
          const menu = new Menu();
          const isMastered = asset.mastered;

          menu.addItem((item) => {
              item.setTitle(isMastered ? "标记为未掌握" : "标记为已掌握")
                  .setIcon(isMastered ? "cross" : "checkmark")
                  .onClick(async () => {
                      if (plugin.settings.wordAssets[assetKey]) {
                          await plugin.wordAssetService.setMastered(assetKey, !isMastered);
                          setRefreshTrigger(p => p + 1);
                      }
                  });
          });

          menu.addSeparator();

          menu.addItem((item) => {
              item.setTitle("彻底删除")
                  .setIcon("trash")
                  .onClick(() => handleDeleteWord(assetKey));
          });
          menu.showAtMouseEvent(e.nativeEvent);
        }}
      >
        <td style={{ padding: "12px 8px", fontWeight: "bold" }}>
          <div style={{ display: "inline-block" }}>
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
        <td style={{ padding: "12px 8px", fontSize: "0.9em", color: "var(--text-muted)" }}>
          {asset.translation && (
            <div 
              style={{ 
                color: "var(--text-normal)", 
                marginBottom: "4px", 
                whiteSpace: isExpanded ? "normal" : "pre-wrap"
              }}
            >
              {isExpanded && asset.display ? (
                  <div>
                      <MarkdownText content={asset.display} plugin={plugin} />
                  </div>
              ) : (
                  asset.translation
              )}
            </div>
          )}
          {isExpanded && asset.isWord && (asset.oxford === 1 || asset.collins || asset.tags?.length) && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginTop: "8px" }}>
              {asset.oxford === 1 && <span className="jarvis-tag">牛津核心</span>}
              {asset.collins > 0 && <span className="jarvis-tag">{'★'.repeat(asset.collins)}</span>}
              {asset.tags?.map((tag: string) => <span key={tag} className="jarvis-tag">{tag.toUpperCase()}</span>)}
            </div>
          )}
        </td>
        <td style={{ padding: "12px 8px" }}>
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

  // Scan books from Vault
  const loadBooks = React.useCallback(() => {
    const allFiles = plugin.app.vault.getFiles();
    const filtered = allFiles.filter(
      (file) => file instanceof TFile && file.extension.toLowerCase() === "epub"
    );
    setBooks(filtered);
    setBooksLoaded(true);
  }, [plugin]);

  React.useEffect(() => {
    loadBooks();
    const onCreate = () => loadBooks();
    const onDelete = () => loadBooks();
    const onRename = () => loadBooks();
    plugin.app.vault.on("create", onCreate);
    plugin.app.vault.on("delete", onDelete);
    plugin.app.vault.on("rename", onRename);
    return () => {
      plugin.app.vault.off("create", onCreate);
      plugin.app.vault.off("delete", onDelete);
      plugin.app.vault.off("rename", onRename);
    };
  }, [plugin, loadBooks]);

  React.useEffect(() => {
    const handleUpdate = () => setBooks([...books]);
    window.addEventListener("jarvis-reader-bookmarks-updated", handleUpdate);
    return () => window.removeEventListener("jarvis-reader-bookmarks-updated", handleUpdate);
  }, [books]);

  React.useEffect(() => {
    const handleAssetOrHighlightChange = () => setRefreshTrigger((value) => value + 1);
    window.addEventListener("jarvis-reader-word-assets-changed", handleAssetOrHighlightChange);
    window.addEventListener("jarvis-reader-highlights-changed", handleAssetOrHighlightChange);
    return () => {
      window.removeEventListener("jarvis-reader-word-assets-changed", handleAssetOrHighlightChange);
      window.removeEventListener("jarvis-reader-highlights-changed", handleAssetOrHighlightChange);
    };
  }, []);

  React.useEffect(() => {
    if (!activeBook || currentView !== "detail") {
      setDetailHighlights([]);
      return;
    }
    let cancelled = false;

    const loadHighlightDetails = async () => {
      const indexHighlights = getHighlightsForBook(plugin.settings, activeBook.path);
      const highlights: LibraryHighlight[] = await Promise.all(indexHighlights.map(async (highlight) => {
        const noteFile = plugin.app.vault.getAbstractFileByPath(highlight.notePath);
        if (!(noteFile instanceof TFile)) return highlight;
        try {
          const details = await plugin.bookNoteService.readHighlightDetails(noteFile, highlight);
          return {
            ...highlight,
            quote: details.quote || highlight.quote,
            comment: details.comment,
            commentEntries: details.commentEntries,
            aiSections: details.aiSections,
          } as BookHighlight;
        } catch (error) {
          console.warn("Jarvis Reader failed to load library highlight details.", error);
          return highlight;
        }
      }));
      if (!cancelled) setDetailHighlights(highlights);
    };

    void loadHighlightDetails();
    return () => { cancelled = true; };
  }, [activeBook, currentView, plugin, refreshTrigger]);

  // Handle active file syncinges
  React.useEffect(() => {
    setCoverCache(plugin.settings.bookCoverCache || {});
  }, [plugin.settings.bookCoverCache]);

  // Map book paths to their markdown notes
  React.useEffect(() => {
    if (books.length === 0) return;
    const notesMap: Record<string, TFile> = {};
    let changedNotes = false;

    books.forEach(book => {
      const noteFile = findBookNote(plugin.app, book, plugin.settings);
      if (noteFile) {
        notesMap[book.path] = noteFile;
        changedNotes = true;
      }
    });
    if (changedNotes) {
      setBookNotesMap(notesMap);
    }
  }, [books, coverCache, plugin.app, plugin.settings]);

  // Handle Ctrl+Scroll zooming on the entire home container
  React.useEffect(() => {
    const home = homeRef.current;
    if (!home) return;
    
    let lastWheelTime = 0;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        
        const now = Date.now();
        if (now - lastWheelTime < 100) return; // throttle to prevent instant min/max
        lastWheelTime = now;

        if (e.deltaY !== 0) {
          const change = e.deltaY > 0 ? 1 : -1; // scroll down = zoom out = more columns
          setGridCols(prev => Math.min(Math.max(4, prev + change), 9));
        }
      }
    };
    home.addEventListener("wheel", onWheel, { passive: false });
    return () => home.removeEventListener("wheel", onWheel);
  }, []);

  // Background cover queue worker
  React.useEffect(() => {
    if (!booksLoaded) return;
    let cancelled = false;

    const runCoverCacheQueue = async () => {
      const validKeys = books
        .filter((file) => file.extension.toLowerCase() === "epub")
        .map((file) => `${file.path}|${file.stat?.mtime || 0}|${file.stat?.size || 0}`);
      await plugin.pruneBookCoverCache(validKeys);
      if (cancelled) return;
      setCoverCache({ ...plugin.settings.bookCoverCache });

      for (const file of books) {
        if (cancelled) break;
        if (file.extension.toLowerCase() !== "epub") continue;

        const key = `${file.path}|${file.stat?.mtime || 0}|${file.stat?.size || 0}`;
        const cached = plugin.settings.bookCoverCache[key];

        if (!cached || !cached.dataUrl || cached.description === undefined || cached.coverVersion !== 10) {
          try {
            const buffer = await plugin.app.vault.readBinary(file);
            let epubFn = (window as any).JarvisReader_ePub;
            if (!epubFn) {
              const ep = require("epubjs");
              epubFn = ep.default || ep;
            }
            if (!epubFn) continue;
            const book = epubFn(buffer.slice(0));
            await book.opened;

            let dataUrl = cached?.dataUrl || "";
            if (cached?.coverVersion !== 6) {
              dataUrl = "";
            }
            if (!dataUrl) {
              let bestBlob: Blob | null = null;

              // 1. Try EPUB metadata cover (Most reliable)
              try {
                const coverId = book.packaging?.metadata?.cover;
                if (coverId) {
                  const coverItem = book.packaging?.manifest?.[coverId];
                  if (coverItem) {
                    const resolvedHref = book.path ? book.path.resolve(coverItem.href) : coverItem.href;
                    const blob = await book.archive.getBlob(resolvedHref);
                    if (blob) { // Accept any explicit cover
                      bestBlob = blob;
                    }
                  }
                }
              } catch(e) {}

              // 2. Try first few spine items (Front cover page)
              if (!bestBlob) {
                try {
                  for (let i = 0; i < Math.min(3, book.spine.length); i++) {
                    const spineItem = book.spine.get(i);
                    if (!spineItem) continue;
                    const doc = await spineItem.load(book.load.bind(book));
                    const img = doc.querySelector("img, image");
                    let href = img?.getAttribute("src") || img?.getAttribute("href") || img?.getAttribute("xlink:href");
                    if (href) {
                      const resolvedHref = book.path ? book.path.resolve(href) : href;
                      const blob = await book.archive.getBlob(resolvedHref);
                      // If it's an image in the first few pages and >1KB, it's the cover
                      if (blob && blob.size > 1000) {
                        bestBlob = blob;
                        break;
                      }
                    }
                  }
                } catch(e) {}
              }

              // 3. Try standard coverUrl if metadata didn't work
              if (!bestBlob) {
                try {
                  const standardCoverUrl = await book.coverUrl();
                  if (standardCoverUrl) {
                    const res = await fetch(standardCoverUrl);
                    const blob = await res.blob();
                    if (blob && blob.size > 1000) {
                      bestBlob = blob;
                    }
                  }
                } catch(e) {}
              }

              // 4. Fallback to manifest scanning
              if (!bestBlob) {
                let maxSize = 0;
                const manifest = book.packaging?.manifest || {};
                const imageItems = Object.values(manifest).filter((item): item is EpubManifestItem => {
                  return !!item && typeof item === "object" && typeof (item as EpubManifestItem).href === "string" && !!(item as EpubManifestItem).type?.startsWith("image/");
                });
                
                // Prioritize items with "cover" or "front" in name
                const coverCandidates = imageItems.filter((item: any) => {
                  const idHref = `${item.id || ""}${item.href || ""}`.toLowerCase();
                  return idHref.includes("cover") || idHref.includes("front");
                });

                for (const item of coverCandidates) {
                  try {
                      const resolvedHref = book.path ? book.path.resolve(item.href || "") : item.href;
                    const blob = await book.archive.getBlob(resolvedHref);
                    const isBack = item.href.toLowerCase().includes("back");
                    if (blob && !isBack && blob.size > maxSize) {
                      maxSize = blob.size;
                      bestBlob = blob;
                    }
                  } catch(e) {}
                }

                // 5. Absolute fallback: Largest image in the book
                if (!bestBlob) {
                  let checked = 0;
                  for (const item of imageItems) {
                    if (checked++ > 10) break; // Don't scan too many
                    try {
                    const resolvedHref = book.path ? book.path.resolve(item.href || "") : item.href;
                      const blob = await book.archive.getBlob(resolvedHref);
                      const isBack = item.href.toLowerCase().includes("back");
                      if (blob && !isBack && blob.size > maxSize) {
                        maxSize = blob.size;
                        bestBlob = blob;
                      }
                    } catch(e) {}
                  }
                }
              }

              // Finally convert the best blob to base64
              if (bestBlob) {
                dataUrl = await new Promise<string>((resolve, reject) => {
                  const reader = new FileReader();
                  reader.onloadend = () => resolve(reader.result as string);
                  reader.onerror = reject;
                  reader.readAsDataURL(bestBlob!);
                });
              }
            }

            const metadata = book.packaging?.metadata || {};
            const rawDesc = metadata.description || "";
            const description = stripHtml(rawDesc);
            const creator = metadata.creator || "";
            const publisher = metadata.publisher || "";
            const pubdate = metadata.pubdate || "";

            const nextEntry = {
              ...(cached || {}),
              dataUrl: dataUrl || cached?.dataUrl || "",
              updated: new Date().toISOString(),
              description,
              creator,
              publisher,
              pubdate,
              coverVersion: 10,
            };

            await plugin.saveBookCoverCacheEntry(key, nextEntry);
            setCoverCache({ ...plugin.settings.bookCoverCache });
          } catch (err) {
            console.warn("Failed to extract metadata for", file.path, err);
          }
        }
      }
    };

    runCoverCacheQueue();
    return () => {
      cancelled = true;
    };
  }, [books, booksLoaded, plugin]);

  // Book getters
  const getCover = (file: TFile) => {
    const key = `${file.path}|${file.stat?.mtime || 0}|${file.stat?.size || 0}`;
    const cached = coverCache[key];
    if (cached?.vaultPath) {
      const coverFile = plugin.app.vault.getAbstractFileByPath(cached.vaultPath);
      if (coverFile instanceof TFile) {
        return { ...cached, dataUrl: plugin.app.vault.getResourcePath(coverFile) };
      }
    }
    if (cached && cached.dataUrl) return cached;
    return cached;
  };

  const getProgress = (file: TFile): BookProgress | null => {
    return plugin.settings.bookProgress?.[file.path] || null;
  };

  // Stats calculation
  const stats = React.useMemo(() => {
    const total = books.length;
    let readingCount = 0;
    let finishedCount = 0;
    let unreadCount = 0;

    books.forEach((b) => {
      const p = getProgress(b);
      const percentage = p ? Math.round((p.percentage || 0) * 100) : 0;
      
      const noteFile = bookNotesMap[b.path];
      let fm: any = {};
      if (noteFile) {
        const cache = plugin.app.metadataCache.getFileCache(noteFile);
        fm = cache?.frontmatter || {};
      }
      
      let actualStatus = resolveBookStatus(fm, percentage);

      if (actualStatus === "finished") {
        finishedCount++;
      } else if (actualStatus === "reading") {
        readingCount++;
      } else {
        unreadCount++;
      }
    });

    // Count highlights
    let totalHighlights = 0;
    Object.values(plugin.settings.bookHighlights || {}).forEach((list: any) => {
      if (Array.isArray(list)) {
        totalHighlights += list.length;
      }
    });

    // Count words
    const totalWords = Object.keys(plugin.settings.wordAssets || {}).length;

    return {
      total,
      reading: readingCount,
      finished: finishedCount,
      unread: unreadCount,
      highlights: totalHighlights,
      words: totalWords,
    };
  }, [books, plugin.settings.bookHighlights, plugin.settings.wordAssets, bookNotesMap, plugin.app.metadataCache, plugin.settings.bookProgress]);

  // Detailed stats for the Jarvis Reader stats modal
  const selectedStats = React.useMemo(() => {
    const today = (moment as any)(statsDate);
    let startDate: moment.Moment;
    let endDate: moment.Moment;
    let prevStartDate: moment.Moment;
    let prevEndDate: moment.Moment;

    if (statsTab === "week") {
      startDate = today.clone().startOf("isoWeek");
      endDate = today.clone().endOf("isoWeek");
      prevStartDate = startDate.clone().subtract(1, "week");
      prevEndDate = endDate.clone().subtract(1, "week");
    } else if (statsTab === "month") {
      startDate = today.clone().startOf("month");
      endDate = today.clone().endOf("month");
      prevStartDate = startDate.clone().subtract(1, "month");
      prevEndDate = endDate.clone().subtract(1, "month");
    } else if (statsTab === "year") {
      startDate = today.clone().startOf("year");
      endDate = today.clone().endOf("year");
      prevStartDate = startDate.clone().subtract(1, "year");
      prevEndDate = endDate.clone().subtract(1, "year");
    } else {
      startDate = (moment as any)(0);
      endDate = (moment as any)().endOf("day");
      prevStartDate = (moment as any)(0);
      prevEndDate = (moment as any)().endOf("day");
    }

    const statsData = plugin.settings.readingStats || {};
    let totalSeconds = 0;
    let prevTotalSeconds = 0;
    const bookSecondsMap: Record<string, number> = {};
    const dailySecondsMap: Record<string, number> = {};
    const monthlySecondsMap: Record<string, number> = {};
    const yearlySecondsMap: Record<string, number> = {};
    const readDays = new Set<string>();

    Object.entries(statsData).forEach(([dateStr, dailyData]: [string, any]) => {
      const dateVal = (moment as any)(dateStr, "YYYY-MM-DD");
      if (!dateVal.isValid()) return;

      const isCurrentRange = dateVal.isBetween(startDate, endDate, "day", "[]");
      const isPrevRange = dateVal.isBetween(prevStartDate, prevEndDate, "day", "[]");

      if (isCurrentRange) {
        Object.entries(dailyData).forEach(([bookPath, secs]: [string, number]) => {
          totalSeconds += secs;
          bookSecondsMap[bookPath] = (bookSecondsMap[bookPath] || 0) + secs;
          if (secs > 0) {
            readDays.add(dateStr);
            dailySecondsMap[dateStr] = (dailySecondsMap[dateStr] || 0) + secs;
            
            const monthStr = dateVal.format("YYYY-MM");
            monthlySecondsMap[monthStr] = (monthlySecondsMap[monthStr] || 0) + secs;

            const yearStr = dateVal.format("YYYY");
            yearlySecondsMap[yearStr] = (yearlySecondsMap[yearStr] || 0) + secs;
          }
        });
      } else if (isPrevRange && statsTab !== "all") {
        Object.values(dailyData).forEach((secs: number) => {
          prevTotalSeconds += secs;
        });
      }
    });

    // 统计在读中与已读完的书籍
    const readBookPaths = new Set<string>();
    const finishedBookPaths = new Set<string>();

    books.forEach((b) => {
      const prog = getProgress(b);
      const percentage = prog ? Math.round((prog.percentage || 0) * 100) : 0;
      
      const noteFile = bookNotesMap[b.path];
      let fm: any = {};
      if (noteFile) {
        const cache = plugin.app.metadataCache.getFileCache(noteFile);
        fm = cache?.frontmatter || {};
      }

      // 使用对齐前边状态的统一 Resolver
      const actualStatus = resolveBookStatus(fm, percentage);

      if (actualStatus === "finished") {
        if (statsTab === "all") {
          finishedBookPaths.add(b.path);
        } else {
          const updatedVal = prog ? (moment as any)(prog.updated) : (moment as any)(0);
          const finishDateVal = fm.finish_date ? (moment as any)(fm.finish_date, "YYYY-MM-DD") : (moment as any)(0);
          
          const isUpdatedInRange = updatedVal.isValid() && updatedVal.isBetween(startDate, endDate, "day", "[]");
          const isFinishDateInRange = finishDateVal.isValid() && finishDateVal.isBetween(startDate, endDate, "day", "[]");
          
          if (isUpdatedInRange || isFinishDateInRange) {
            finishedBookPaths.add(b.path);
          }
        }
      } else if (actualStatus === "reading") {
        if (statsTab === "all") {
          readBookPaths.add(b.path);
        } else {
          const updatedVal = prog ? (moment as any)(prog.updated) : (moment as any)(0);
          const isUpdatedInRange = updatedVal.isValid() && updatedVal.isBetween(startDate, endDate, "day", "[]");
          const hasTimeSecs = (bookSecondsMap[b.path] || 0) > 0;
          
          if (isUpdatedInRange || hasTimeSecs) {
            readBookPaths.add(b.path);
          }
        }
      }
    });

    const booksReadCount = readBookPaths.size;
    const finishedBooksCount = finishedBookPaths.size;

    let newHighlightsCount = 0;
    Object.values(plugin.settings.bookHighlights || {}).forEach((list: any) => {
      if (Array.isArray(list)) {
        list.forEach((hl: any) => {
          const createdVal = (moment as any)(hl.created);
          if (createdVal.isValid() && createdVal.isBetween(startDate, endDate, "day", "[]")) {
            newHighlightsCount++;
          }
        });
      }
    });

    let newWordsCount = 0;
    Object.values(plugin.settings.wordAssets || {}).forEach((asset: any) => {
      const createdVal = (moment as any)(asset.created);
      if (createdVal.isValid() && createdVal.isBetween(startDate, endDate, "day", "[]")) {
        newWordsCount++;
      }
    });

    const categoryCount: Record<string, number> = {};
    const publisherCount: Record<string, number> = {};

    // 偏好分析书籍集合（包含所有在读中和已读完的书籍）
    const prefBookPaths = new Set<string>([...readBookPaths, ...finishedBookPaths]);

    prefBookPaths.forEach((bookPath) => {
      const noteFile = bookNotesMap[bookPath];
      let fm: any = {};
      if (noteFile) {
        const cache = plugin.app.metadataCache.getFileCache(noteFile);
        fm = cache?.frontmatter || {};
      }

      const secs = bookSecondsMap[bookPath] || 0;
      const weight = secs > 0 ? secs : 1;

      // 按照标签分类
      const tagsList: string[] = [];
      if (Array.isArray(fm.tags) && fm.tags.length > 0) {
        fm.tags.forEach((tag: any) => {
          if (typeof tag === "string" && tag.trim()) {
            tagsList.push(tag.trim());
          }
        });
      }
      if (fm.category && typeof fm.category === "string" && fm.category.trim()) {
        const cat = fm.category.trim();
        if (!tagsList.includes(cat)) {
          tagsList.push(cat);
        }
      }

      if (tagsList.length > 0) {
        tagsList.forEach((tag) => {
          categoryCount[tag] = (categoryCount[tag] || 0) + weight;
        });
      } else {
        categoryCount["未知"] = (categoryCount["未知"] || 0) + weight;
      }

      const publisher = fm.publisher || "";
      if (publisher) {
        publisherCount[publisher] = (publisherCount[publisher] || 0) + weight;
      }
    });

    const topPublishers = Object.entries(publisherCount)
      .sort((a, b) => b[1] - a[1])
      .map(entry => entry[0])
      .slice(0, 2);

    const sortedCategories = Object.entries(categoryCount)
      .sort((a, b) => b[1] - a[1]);
    
    const radarDimensions = ["影视原著", "文学", "个人成长", "社会小说", "男生小说"];
    const topCategories = sortedCategories.slice(0, 5).map(entry => entry[0]);
    topCategories.forEach(cat => {
      if (!radarDimensions.includes(cat) && cat !== "未知") {
        radarDimensions.push(cat);
      }
    });
    const activeDimensions = radarDimensions.slice(0, 5);
    const radarData = activeDimensions.map(dim => {
      return {
        dimension: dim,
        value: categoryCount[dim] || 0
      };
    });

    let trendPercent = 0;
    if (prevTotalSeconds > 0) {
      trendPercent = Math.round(((totalSeconds - prevTotalSeconds) / prevTotalSeconds) * 100);
    } else if (totalSeconds > 0) {
      trendPercent = 100;
    }

    return {
      startDate,
      endDate,
      totalSeconds,
      prevTotalSeconds,
      trendPercent,
      readDaysCount: readDays.size,
      booksReadCount,
      finishedBooksCount,
      newHighlightsCount,
      newWordsCount,
      bookSecondsMap,
      dailySecondsMap,
      monthlySecondsMap,
      yearlySecondsMap,
      radarData,
      topPublishers
    };
  }, [statsTab, statsDate, books, plugin.settings.readingStats, plugin.settings.bookProgress, plugin.settings.bookHighlights, plugin.settings.wordAssets, bookNotesMap, plugin.app.metadataCache]);

  const handlePrevDate = () => {
    setStatsDate((prev) => {
      const m = (moment as any)(prev);
      if (statsTab === "week") return m.subtract(1, "week").toDate();
      if (statsTab === "month") return m.subtract(1, "month").toDate();
      if (statsTab === "year") return m.subtract(1, "year").toDate();
      return prev;
    });
  };

  const handleNextDate = () => {
    setStatsDate((prev) => {
      const m = (moment as any)(prev);
      if (statsTab === "week") return m.add(1, "week").toDate();
      if (statsTab === "month") return m.add(1, "month").toDate();
      if (statsTab === "year") return m.add(1, "year").toDate();
      return prev;
    });
  };

  // Filter & Sort books
  const filteredBooks = React.useMemo(() => {
    return books
      .filter((b) => {
        // Search
        const { title, author } = parseBookInfo(b);
        const text = `${title} ${author} ${b.basename}`.toLowerCase();
        if (searchQuery.trim() && !text.includes(searchQuery.toLowerCase())) {
          return false;
        }

        const noteFile = bookNotesMap[b.path];
        let fm: any = {};
        if (noteFile) {
          const cache = plugin.app.metadataCache.getFileCache(noteFile);
          fm = cache?.frontmatter || {};
        }

        // Reading status using REAL metadata + percentage fallback
        const p = getProgress(b);
        const percentage = p ? Math.round((p.percentage || 0) * 100) : 0;
        let actualStatus = resolveBookStatus(fm, percentage);

        if (filterStatus === "unread" && actualStatus !== "unread") return false;
        if (filterStatus === "reading" && actualStatus !== "reading") return false;
        if (filterStatus === "finished" && actualStatus !== "finished") return false;

        return true;
      })
      .sort((a, b) => {
        const nA = bookNotesMap[a.path];
        const nB = bookNotesMap[b.path];
        const fmA = nA ? plugin.app.metadataCache.getFileCache(nA)?.frontmatter || {} : {};
        const fmB = nB ? plugin.app.metadataCache.getFileCache(nB)?.frontmatter || {} : {};

        if (sortBy === "name") {
          return a.basename.localeCompare(b.basename);
        } else if (sortBy === "rating") {
          const rA = fmA.rating || 0;
          const rB = fmB.rating || 0;
          return rB - rA;
        } else if (sortBy === "start") {
          const dA = fmA.start_date ? new Date(fmA.start_date).getTime() : 0;
          const dB = fmB.start_date ? new Date(fmB.start_date).getTime() : 0;
          return dB - dA;
        } else if (sortBy === "end") {
          const dA = fmA.finish_date ? new Date(fmA.finish_date).getTime() : 0;
          const dB = fmB.finish_date ? new Date(fmB.finish_date).getTime() : 0;
          return dB - dA;
        } else {
          // Recent modification or reading
          const pA = getProgress(a);
          const pB = getProgress(b);
          const timeA = Math.max(pA ? new Date(pA.updated).getTime() : 0, a.stat.mtime);
          const timeB = Math.max(pB ? new Date(pB.updated).getTime() : 0, b.stat.mtime);
          return timeB - timeA;
        }
      });
  }, [books, searchQuery, filterStatus, sortBy, plugin.settings.bookProgress, bookNotesMap, plugin.app.metadataCache]);

  // Load Metadata when detail view opens
  React.useEffect(() => {
    if (!activeBook || currentView !== "detail") return;

    const loadMetadata = () => {
      const noteFile = findBookNote(plugin.app, activeBook, plugin.settings);
      
      let status = "unread";
      let rating = 0;
      let tags: string[] = [];
      let startDate = "";
      let finishDate = "";
      let summary = "";

      const progress = getProgress(activeBook);
      const percentage = progress ? Math.round((progress.percentage || 0) * 100) : 0;

      if (noteFile instanceof TFile) {
        const cache = plugin.app.metadataCache.getFileCache(noteFile);
        if (cache && cache.frontmatter) {
          const fm = cache.frontmatter;
          let fmStatus = fm.status || "unread";
          if (fmStatus === "unread" && percentage > 0) {
             status = percentage >= 100 ? "finished" : "reading";
          } else if (fmStatus === "reading" && percentage >= 100) {
             status = "finished";
          } else {
             status = fmStatus;
          }
          if (fm.rating) rating = Number(fm.rating);
          if (fm.tags) {
            if (Array.isArray(fm.tags)) tags = fm.tags;
            else if (typeof fm.tags === "string") tags = fm.tags.split(",").map((t: string) => t.trim());
          }
          if (fm.start_date) startDate = fm.start_date;
          if (fm.finish_date) finishDate = fm.finish_date;
          if (fm.summary) summary = fm.summary;
        } else {
          // Sync default status if no frontmatter
          if (percentage >= 100) status = "finished";
          else if (percentage > 0) status = "reading";
        }

      } else {
        // Sync default status if no file
        if (percentage >= 100) status = "finished";
        else if (percentage > 0) status = "reading";
      }
      setBookMetadata({ status, rating, tags, startDate, finishDate, summary });
      setTagInput(tags.length > 0 ? tags.map(t => `#${t.replace(/^#/, '')}`).join(" ") : "");
    };

    loadMetadata();
  }, [activeBook, currentView, plugin]);

  const handleUpdateMetadata = async (key: string, value: any) => {
    if (!activeBook) return;
    
    setBookMetadata(prev => ({ ...prev, [key]: value }));
    
    try {
      const noteFile = await getOrCreateBookNote(plugin.app, activeBook, "", plugin.settings);
      if (noteFile) {
        await plugin.app.fileManager.processFrontMatter(noteFile, (fm: any) => {
          if (key === "startDate") fm.start_date = value;
          else if (key === "finishDate") fm.finish_date = value;
          else fm[key] = value;
        });
      }
    } catch (e) {
      console.error("Failed to update frontmatter", e);
      new Notice("保存元数据失败");
    }
  };

  // Actions
  const openBook = async (file: TFile) => {
    const leaf = plugin.app.workspace.getLeaf(true);
    await leaf.openFile(file, { active: true });
    if (typeof plugin.openBookshelfPane === "function") {
      await plugin.openBookshelfPane(true);
    }
  };

  const openNote = async (file: TFile) => {
    const progress = getProgress(file);
    const tocMd = progress?.chapterTitle ? `## ${progress.chapterTitle}` : "";
    await openOrCreateNote(plugin.app, file, tocMd, plugin.settings);
  };

  const deleteBook = async (file: TFile) => {
    const confirmed = await confirmDestructiveAction(
      plugin.app,
      "删除电子书文件",
      `确认删除《${file.basename}》的 EPUB 文件吗？书籍笔记、划线和知识笔记会保留，阅读位置、进度、书签和封面缓存会清理。`,
    );
    if (confirmed) {
      try {
        await plugin.app.vault.delete(file);
        await plugin.bookStateService.clearRuntimeState(file.path);
        new Notice(`已删除电子书文件：${file.basename}`);
        if (activeBook?.path === file.path) {
          setCurrentView("home");
          setActiveBook(null);
        }
        loadBooks();
      } catch (err) {
        console.error("Failed to delete book or clean runtime state", err);
        new Notice(`删除或清理失败：${String(err)}`);
      }
    }
  };

  const playAudio = (word: string) => {
    const template = plugin.settings.wordAudioTemplate || DEFAULT_WORD_AUDIO_TEMPLATE;
    const accent = plugin.settings.wordAudioAccent || "us";
    const url = buildWordAudioUrl(template, word, accent);
    if (url) {
      const audio = new Audio(url);
      audio.play().catch((err) => {
        new Notice("音频播放失败");
      });
    }
  };

  const toggleWordMastery = async (lemma: string, currentVal: boolean) => {
    if (plugin.settings.wordAssets[lemma]) {
      await plugin.wordAssetService.setMastered(lemma, !currentVal);
      // Force state reload
      loadBooks();
    }
  };

  // Jump to specific highlight in book
  const jumpToHighlight = async (file: TFile, highlight: BookHighlight) => {
    plugin.settings.bookInitLocations[file.path] = highlight.cfiRange;
    await plugin.saveSettings();
    await openBook(file);
  };

  const extractAllImages = async (file: TFile) => {
    try {
      new Notice("正在提取书籍中的所有图片...");
      const buffer = await plugin.app.vault.readBinary(file);
      let epubFn = (window as any).JarvisReader_ePub;
      if (!epubFn) {
        const ep = require("epubjs");
        epubFn = ep.default || ep;
      }
      const book = epubFn(buffer.slice(0));
      await book.opened;

      const manifest = book.packaging?.manifest || {};
      const imageItems = Object.values(manifest).filter((item: any) => item.type?.startsWith("image/"));
      
      const imagesList = [];
      for (const item of imageItems) {
        try {
          const resolvedHref = book.path ? book.path.resolve((item as any).href) : (item as any).href;
          const blob = await book.archive.getBlob(resolvedHref);
          if (blob) {
            const dataUrl = await new Promise<string>((resolve) => {
              const reader = new FileReader();
              reader.onloadend = () => resolve(reader.result as string);
              reader.readAsDataURL(blob);
            });
            imagesList.push({ href: (item as any).href, size: blob.size, dataUrl });
          }
        } catch(e) {}
      }
      
      imagesList.sort((a, b) => b.size - a.size);
      setDebugImages(imagesList);
      new Notice(`提取完成，共 ${imagesList.length} 张图片`);
    } catch(err) {
      new Notice("提取失败: " + err);
    }
  };

  // Debug Modal
  const renderDebugModal = () => {
    if (!debugImages) return null;
    return (
      <div className="jarvis-library-stats-modal-overlay" onClick={() => setDebugImages(null)}>
        <div className="jarvis-library-stats-modal" onClick={(e) => e.stopPropagation()} style={{ width: '80%', height: '80%', maxWidth: 'none', overflowY: 'auto' }}>
          <div className="jarvis-library-stats-modal-header">
            <h3>图片提取调试</h3>
            <button className="jarvis-library-stats-close-btn" onClick={() => setDebugImages(null)}>
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6 6 18M6 6l12 12"/></svg>
            </button>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', padding: '20px' }}>
            {debugImages.map(img => (
              <div key={img.href} style={{ border: '1px solid var(--background-modifier-border)', padding: '12px', borderRadius: '8px', background: 'var(--background-secondary)' }}>
                <img src={img.dataUrl} style={{ maxWidth: '240px', maxHeight: '340px', display: 'block', objectFit: 'contain' }} />
                <div style={{ marginTop: '12px', fontSize: '12px', wordBreak: 'break-all', maxWidth: '240px', color: 'var(--text-normal)' }}>
                  <b>大小:</b> {Math.round(img.size / 1024)} KB<br/>
                  <b>路径:</b> {img.href}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  // Stats View
  const renderStatsView = () => {
    const {
      startDate,
      endDate,
      totalSeconds,
      prevTotalSeconds,
      trendPercent,
      readDaysCount,
      booksReadCount,
      finishedBooksCount,
      newHighlightsCount,
      newWordsCount,
      bookSecondsMap,
      dailySecondsMap,
      monthlySecondsMap,
      yearlySecondsMap,
      radarData,
      topPublishers
    } = selectedStats;

    const statsData = plugin.settings.readingStats || {};

    // First reading date for "All" tab subtext
    const sortedDates = Object.keys(statsData).sort();
    const firstDateStr = sortedDates.length > 0 ? sortedDates[0] : (moment as any)().format("YYYY-MM-DD");
    const earliestYearStr = sortedDates.length > 0 ? sortedDates[0] : null;

    // Format date string for range picker
    let dateRangeStr = "";
    if (statsTab === "week") {
      const start = (moment as any)(startDate);
      const end = (moment as any)(endDate);
      dateRangeStr = `${start.format("YYYY · M/D")} - ${end.format("M/D")}`;
    } else if (statsTab === "month") {
      dateRangeStr = (moment as any)(startDate).format("YYYY年M月");
    } else if (statsTab === "year") {
      dateRangeStr = (moment as any)(startDate).format("YYYY年");
    }

    // formatDuration is now imported globally

    // Helper: render large duration digits
    const renderLargeDuration = (secs: number) => {
      if (secs <= 0) {
        return (
          <>
            0<span>分钟</span>
          </>
        );
      }
      const h = Math.floor(secs / 3600);
      const m = Math.round((secs % 3600) / 60);
      if (h > 0 && m > 0) {
        return (
          <>
            {h}<span>小时</span>{m}<span>分钟</span>
          </>
        );
      } else if (h > 0) {
        return (
          <>
            {h}<span>小时</span>
          </>
        );
      } else {
        return (
          <>
            {m}<span>分钟</span>
          </>
        );
      }
    };

    // Subtext for summary card
    let mainCardSub = "";
    const avgSecs = Math.round(totalSeconds / (readDaysCount || 1));
    const trendText = trendPercent > 0 ? `↑ ${trendPercent}%` : trendPercent < 0 ? `↓ ${Math.abs(trendPercent)}%` : "--";
    const trendClass = trendPercent > 0 ? "jarvis-stats-trend-up" : trendPercent < 0 ? "jarvis-stats-trend-down" : "";

    if (statsTab === "week") {
      mainCardSub = `日均阅读 ${formatDuration(avgSecs)} · 比上周 `;
    } else if (statsTab === "month") {
      mainCardSub = `日均阅读 ${formatDuration(avgSecs)} · 比上月 `;
    } else if (statsTab === "year") {
      mainCardSub = `日均阅读 ${formatDuration(avgSecs)} · 比去年 `;
    } else {
      mainCardSub = `${firstDateStr}至今 · 日均阅读 ${formatDuration(avgSecs)} · 与 Jarvis Reader 相伴 ${readDaysCount} 天`;
    }

    // Chart toggle logic
    let activeChart = statsChartType;
    if (statsTab === "week") {
      activeChart = "bar";
    } else if (statsTab === "month" && activeChart === "heatmap") {
      activeChart = "bar";
    } else if ((statsTab === "year" || statsTab === "all") && activeChart === "calendar") {
      activeChart = "heatmap";
    }

    // Precalculate ranking characteristics
    let maxSingleDaySecs = 0;
    let maxSingleDayBook = "";
    let maxHighlightsCount = 0;
    let maxHighlightsBook = "";

    const bookDailyMaxSecs: Record<string, number> = {};
    const bookRangeHighlightsCount: Record<string, number> = {};

    Object.entries(statsData).forEach(([dateStr, dailyData]: [string, any]) => {
      const dateVal = (moment as any)(dateStr, "YYYY-MM-DD");
      if (!dateVal.isValid()) return;
      
      const isCurrentRange = dateVal.isBetween(startDate, endDate, "day", "[]");
      if (isCurrentRange) {
        Object.entries(dailyData).forEach(([bookPath, secs]: [string, number]) => {
          if (secs > 0) {
            bookDailyMaxSecs[bookPath] = Math.max(bookDailyMaxSecs[bookPath] || 0, secs);
          }
        });
      }
    });

    Object.entries(plugin.settings.bookHighlights || {}).forEach(([bookPath, list]: [string, any]) => {
      if (Array.isArray(list)) {
        list.forEach((hl: any) => {
          const createdVal = (moment as any)(hl.created);
          if (createdVal.isValid() && createdVal.isBetween(startDate, endDate, "day", "[]")) {
            bookRangeHighlightsCount[bookPath] = (bookRangeHighlightsCount[bookPath] || 0) + 1;
          }
        });
      }
    });

    Object.entries(bookDailyMaxSecs).forEach(([bookPath, secs]) => {
      if (secs > maxSingleDaySecs) {
        maxSingleDaySecs = secs;
        maxSingleDayBook = bookPath;
      }
    });

    Object.entries(bookRangeHighlightsCount).forEach(([bookPath, count]) => {
      if (count > maxHighlightsCount) {
        maxHighlightsCount = count;
        maxHighlightsBook = bookPath;
      }
    });

    let sortedRankBooks: [string, number][] = [];
    let isTimeRank = true;
    if (Object.keys(bookSecondsMap).length > 0) {
      sortedRankBooks = Object.entries(bookSecondsMap)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);
      isTimeRank = true;
    } else {
      const progRankList: [string, number][] = [];
      Object.entries(plugin.settings.bookProgress || {}).forEach(([bookPath, prog]: [string, any]) => {
        if (prog && prog.percentage > 0) {
          if (statsTab === "all") {
            progRankList.push([bookPath, prog.percentage]);
          } else {
            const updatedVal = (moment as any)(prog.updated);
            if (updatedVal.isValid() && updatedVal.isBetween(startDate, endDate, "day", "[]")) {
              progRankList.push([bookPath, prog.percentage]);
            }
          }
        }
      });
      sortedRankBooks = progRankList
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);
      isTimeRank = false;
    }

    const maxRankSecs = isTimeRank && sortedRankBooks.length > 0 ? sortedRankBooks[0][1] : 0;
    const isReadable = (plugin.app.vault as any).getConfig ? (plugin.app.vault as any).getConfig("readableLineLength") : true;

    return (
      <div className="jarvis-library-stats-view">
        <div className={`jarvis-library-stats-view-container ${isReadable ? "is-readable-width" : "is-full-width"}`}>
          <div className="jarvis-library-stats-view-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <button className="jarvis-library-back-btn" onClick={() => setCurrentView("home")}>
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
                返回书架
              </button>
              <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700 }}>阅读统计</h2>
            </div>
          </div>

          {/* Navigation and tab bar */}
          <div className="jarvis-stats-header-wrap">
            <div className="jarvis-stats-nav-tabs">
              <button className={`jarvis-stats-tab-btn ${statsTab === "week" ? "is-active" : ""}`} onClick={() => setStatsTab("week")}>周</button>
              <button className={`jarvis-stats-tab-btn ${statsTab === "month" ? "is-active" : ""}`} onClick={() => setStatsTab("month")}>月</button>
              <button className={`jarvis-stats-tab-btn ${statsTab === "year" ? "is-active" : ""}`} onClick={() => setStatsTab("year")}>年</button>
              <button className={`jarvis-stats-tab-btn ${statsTab === "all" ? "is-active" : ""}`} onClick={() => setStatsTab("all")}>全部</button>
            </div>
            {statsTab !== "all" && (
              <div className="jarvis-stats-date-picker">
                <button className="jarvis-stats-date-btn" onClick={handlePrevDate}>
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m15 18-6-6 6-6"/></svg>
                </button>
                <span className="jarvis-stats-date-text">{dateRangeStr}</span>
                <button className="jarvis-stats-date-btn" onClick={handleNextDate}>
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m9 18 6-6-6-6"/></svg>
                </button>
              </div>
            )}
          </div>

          {/* Main Card */}
          <div className="jarvis-stats-main-card">
            <div className="jarvis-stats-main-time">
              {renderLargeDuration(totalSeconds)}
            </div>
            <div className="jarvis-stats-main-sub">
              {mainCardSub}
              {statsTab !== "all" && (
                <span className={trendClass}>{trendText}</span>
              )}
            </div>
          </div>

          {/* Mini Cards Grid */}
          <div className="jarvis-stats-mini-grid">
            <div className="jarvis-stats-mini-card">
              <span className="jarvis-stats-mini-val" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-muted)' }}><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>
                {readDaysCount}天
              </span>
              <span className="jarvis-stats-mini-label">阅读天数</span>
            </div>
            {statsTab !== "all" && (
              <div className="jarvis-stats-mini-card">
                <span className="jarvis-stats-mini-val" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-muted)' }}><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"></polyline><polyline points="17 6 23 6 23 12"></polyline></svg>
                  {formatDuration(avgSecs)}
                  <span className={trendClass} style={{ fontSize: '9px', padding: '1px 3px', borderRadius: '4px', background: trendPercent > 0 ? '#E5F5F1' : trendPercent < 0 ? '#FCE8E6' : 'var(--background-modifier-border)' }}>
                    {trendText}
                  </span>
                </span>
                <span className="jarvis-stats-mini-label">日均时长</span>
              </div>
            )}
            {statsTab !== "week" && (
              <>
                <div className="jarvis-stats-mini-card">
                  <span className="jarvis-stats-mini-val" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-muted)' }}><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path></svg>
                    {booksReadCount}本
                  </span>
                  <span className="jarvis-stats-mini-label">在读</span>
                </div>
                <div className="jarvis-stats-mini-card">
                  <span className="jarvis-stats-mini-val" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-muted)' }}><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="6"></circle><circle cx="12" cy="12" r="2"></circle></svg>
                    {finishedBooksCount}本
                  </span>
                  <span className="jarvis-stats-mini-label">已读完</span>
                </div>
                <div className="jarvis-stats-mini-card">
                  <span className="jarvis-stats-mini-val" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-muted)' }}><path d="M15.5 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.5L15.5 3z"></path><polyline points="15 3 15 9 21 9"></polyline></svg>
                    {newHighlightsCount}条
                  </span>
                  <span className="jarvis-stats-mini-label">笔记</span>
                </div>
                <div className="jarvis-stats-mini-card">
                  <span className="jarvis-stats-mini-val" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-muted)' }}><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>
                    {newWordsCount}条
                  </span>
                  <span className="jarvis-stats-mini-label">词条</span>
                </div>
              </>
            )}
          </div>

          {/* Visual Chart Section */}
          <div className="jarvis-stats-chart-section">
            <div className="jarvis-stats-chart-header">
              <span className="jarvis-stats-chart-title">
                {activeChart === "bar" && (statsTab === "week" || statsTab === "month" ? "每日阅读时长" : statsTab === "year" ? "每月阅读时长" : "每年阅读时长")}
                {activeChart === "calendar" && "每日阅读时长"}
                {activeChart === "heatmap" && "每日阅读时长"}
              </span>
              <div className="jarvis-stats-chart-toggles">
                {statsTab === "month" && (
                  <>
                    <button className={`jarvis-stats-chart-toggle-btn ${activeChart === "bar" ? "is-active" : ""}`} onClick={() => setStatsChartType("bar")}>
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 20V10M12 20V4M6 20v-6"/></svg>
                    </button>
                    <button className={`jarvis-stats-chart-toggle-btn ${activeChart === "calendar" ? "is-active" : ""}`} onClick={() => setStatsChartType("calendar")}>
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                    </button>
                  </>
                )}
                {(statsTab === "year" || statsTab === "all") && (
                  <>
                    <button className={`jarvis-stats-chart-toggle-btn ${activeChart === "heatmap" ? "is-active" : ""}`} onClick={() => setStatsChartType("heatmap")}>
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
                    </button>
                    <button className={`jarvis-stats-chart-toggle-btn ${activeChart === "bar" ? "is-active" : ""}`} onClick={() => setStatsChartType("bar")}>
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 20V10M12 20V4M6 20v-6"/></svg>
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Render selected chart */}
            {activeChart === "bar" && (() => {
              // Construct data based on current tab
              let data: { label: string; secs: number; tooltip: string }[] = [];
              if (statsTab === "week") {
                const weekdays = ["一", "二", "三", "四", "五", "六", "日"];
                data = Array.from({ length: 7 }).map((_, i) => {
                  const day = (moment as any)(startDate).add(i, "days");
                  const dateStr = day.format("YYYY-MM-DD");
                  const secs = dailySecondsMap[dateStr] || 0;
                  return { label: weekdays[i], secs, tooltip: `${day.format("M月D日")} 阅读 ${formatDuration(secs)}` };
                });
              } else if (statsTab === "month") {
                const daysInMonth = (moment as any)(startDate).daysInMonth();
                data = Array.from({ length: daysInMonth }).map((_, i) => {
                  const day = (moment as any)(startDate).add(i, "days");
                  const dateStr = day.format("YYYY-MM-DD");
                  const secs = dailySecondsMap[dateStr] || 0;
                  return { label: String(i + 1), secs, tooltip: `${day.format("M月D日")} 阅读 ${formatDuration(secs)}` };
                });
              } else if (statsTab === "year") {
                data = Array.from({ length: 12 }).map((_, i) => {
                  const month = (moment as any)(startDate).add(i, "months");
                  const monthStr = month.format("YYYY-MM");
                  const secs = monthlySecondsMap[monthStr] || 0;
                  return { label: `${i + 1}月`, secs, tooltip: `${month.format("YYYY年M月")} 阅读 ${formatDuration(secs)}` };
                });
              } else {
                const currentYear = (moment as any)().year();
                const startYear = earliestYearStr ? (moment as any)(earliestYearStr, "YYYY-MM-DD").year() : currentYear - 4;
                const yearsCount = Math.max(currentYear - startYear + 1, 1);
                data = Array.from({ length: yearsCount }).map((_, i) => {
                  const year = String(startYear + i);
                  const secs = yearlySecondsMap[year] || 0;
                  return { label: year, secs, tooltip: `${year}年 阅读 ${formatDuration(secs)}` };
                });
              }

              const chartHeightPx = 136;
              const getStep = (seconds: number) => {
                if (seconds <= 15 * 60) return 5 * 60;
                if (seconds <= 30 * 60) return 10 * 60;
                if (seconds <= 60 * 60) return 15 * 60;
                if (seconds <= 2 * 3600) return 30 * 60;
                if (seconds <= 4 * 3600) return 60 * 60;
                return 2 * 3600;
              };
              const rawMax = Math.max(...data.map(d => d.secs), 0);
              const maxVal = rawMax <= 60 * 60
                ? 60 * 60
                : Math.max(Math.ceil(rawMax / getStep(rawMax || 60)) * getStep(rawMax || 60), 60);
              const tickStep = getStep(maxVal);
              const yAxisTicks: number[] = [];
              for (let tick = maxVal; tick >= 0; tick -= tickStep) {
                yAxisTicks.push(tick);
              }
              if (yAxisTicks[yAxisTicks.length - 1] !== 0) yAxisTicks.push(0);

              return (
                <div style={{ position: 'relative' }}>
                  {/* Grid Lines */}
                  <div style={{ position: 'absolute', left: 0, right: 0, top: '20px', bottom: '38px', pointerEvents: 'none', zIndex: 1 }}>
                    {yAxisTicks.map((tick) => {
                      const ratio = maxVal > 0 ? tick / maxVal : 0;
                      return (
                        <div
                          key={tick}
                          style={{
                            position: 'absolute',
                            left: 0,
                            right: 0,
                            bottom: `${ratio * 100}%`,
                            borderBottom: '1px dashed var(--background-modifier-border)',
                            width: '100%',
                            display: 'flex',
                            justifyContent: 'flex-start'
                          }}
                        >
                          <span style={{ fontSize: '9px', color: 'var(--text-muted)', transform: 'translateY(-100%)' }}>
                            {tick === 0 ? '0' : formatDuration(tick)}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  <div className="jarvis-stats-bar-chart-container" style={{ position: 'relative', zIndex: 2 }}>
                    {data.map((item, idx) => {
                      const heightPx = item.secs > 0
                        ? Math.max((item.secs / maxVal) * chartHeightPx, 6)
                        : 0;
                      return (
                        <div key={idx} className="jarvis-stats-bar-column">
                          <div className="jarvis-stats-bar-tooltip">{item.tooltip}</div>
                          <div className="jarvis-stats-bar" style={{ height: `${heightPx}px` }} />
                          <span className="jarvis-stats-bar-label">{item.label}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {activeChart === "calendar" && (() => {
              const daysInMonth = (moment as any)(startDate).daysInMonth();
              const firstDayOffset = (((moment as any)(startDate).clone().startOf("month").day() + 6) % 7);
              const weekdays = ["一", "二", "三", "四", "五", "六", "日"];
              
              const cells: any[] = [];
              // Fill blanks before start of month
              for (let i = 0; i < firstDayOffset; i++) {
                cells.push(<div key={`empty-start-${i}`} className="jarvis-stats-calendar-cell is-empty" />);
              }
              
              // Fill days of month
              for (let d = 1; d <= daysInMonth; d++) {
                const day = (moment as any)(startDate).clone().date(d);
                const dateStr = day.format("YYYY-MM-DD");
                const secs = dailySecondsMap[dateStr] || 0;
                
                cells.push(
                  <div key={`day-${d}`} className={`jarvis-stats-calendar-cell ${secs > 0 ? "has-read" : ""}`}>
                    <span style={{ fontWeight: secs > 0 ? 700 : 500 }}>{d}</span>
                    {secs > 0 && (
                      <span className="jarvis-stats-calendar-cell-time">{formatDuration(secs)}</span>
                    )}
                  </div>
                );
              }

              return (
                <div>
                  <div className="jarvis-stats-calendar-grid" style={{ marginBottom: '8px' }}>
                    {weekdays.map(wd => (
                      <div key={wd} className="jarvis-stats-calendar-weekday">{wd}</div>
                    ))}
                  </div>
                  <div className="jarvis-stats-calendar-grid">
                    {cells}
                  </div>
                </div>
              );
            })()}

            {activeChart === "heatmap" && (() => {
              const renderHeatmapWall = (yearStr: string) => {
                const startOfYear = (moment as any)(`${yearStr}-01-01`);
                const gridStart = startOfYear.clone().startOf("isoWeek");

                const weeksCount = 53;
                const columns: any[] = [];

                // Precalculate month headers positioning
                const monthLabels: { label: string; colIndex: number }[] = [];
                let lastMonth = -1;

                for (let w = 0; w < weeksCount; w++) {
                  const colCells: any[] = [];
                  const colMonday = gridStart.clone().add(w * 7, "days");
                  
                  // Record month label if it changes
                  const m = colMonday.month();
                  if (m !== lastMonth) {
                    monthLabels.push({ label: `${m + 1}月`, colIndex: w });
                    lastMonth = m;
                  }

                  for (let d = 0; d < 7; d++) {
                    const cellDate = gridStart.clone().add(w * 7 + d, "days");
                    const isTargetYear = cellDate.year() === Number(yearStr);
                    const dateStr = cellDate.format("YYYY-MM-DD");
                    const secs = isTargetYear ? (dailySecondsMap[dateStr] || 0) : 0;
                    
                    const mins = secs / 60;
                    let level = 0;
                    if (mins > 0 && mins <= 5) level = 1;
                    else if (mins > 5 && mins <= 15) level = 2;
                    else if (mins > 15 && mins <= 45) level = 3;
                    else if (mins > 45) level = 4;

                    const tooltipText = isTargetYear 
                      ? `${cellDate.format("YYYY年M月D日")} 阅读 ${formatDuration(secs)}`
                      : "";

                    colCells.push(
                      <div key={`d-${d}`} className={`jarvis-stats-heatmap-cell level-${level}`}>
                        {tooltipText && (
                          <div className="jarvis-stats-heatmap-cell-tooltip">{tooltipText}</div>
                        )}
                      </div>
                    );
                  }

                  columns.push(
                    <div key={`w-${w}`} className="jarvis-stats-heatmap-col">
                      {colCells}
                    </div>
                  );
                }

                const yearsTotalDays = Object.entries(dailySecondsMap).filter(([dateStr, secs]) => {
                  return dateStr.startsWith(yearStr) && secs > 0;
                }).length;

                const yearsTotalSecs = Object.entries(dailySecondsMap)
                  .filter(([dateStr]) => dateStr.startsWith(yearStr))
                  .reduce((acc, entry) => acc + entry[1], 0);

                return (
                  <div key={yearStr} style={{ marginBottom: '24px' }}>
                    {statsTab === "all" && (
                      <h4 style={{ fontSize: '13px', margin: '0 0 10px 0', fontWeight: '700' }}>{yearStr}</h4>
                    )}
                    <div className="jarvis-stats-heatmap-wrapper">
                      {/* Months Row Header */}
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(53, 1fr)', gap: '3px', fontSize: '9px', color: 'var(--text-muted)', marginBottom: '4px', paddingLeft: '15px' }}>
                        {monthLabels.map(ml => (
                          <span key={ml.label} style={{ gridColumnStart: ml.colIndex + 1, whiteSpace: 'nowrap' }}>{ml.label}</span>
                        ))}
                      </div>
                      
                      <div style={{ display: 'flex', gap: '8px' }}>
                        {/* Weekday labels */}
                        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', fontSize: '9px', color: 'var(--text-muted)', height: '88px', padding: '2px 0' }}>
                          <span>一</span>
                          <span>三</span>
                          <span>五</span>
                        </div>
                        
                        {/* Heatmap Grid Container */}
                        <div style={{ display: 'flex', gap: '3px' }}>
                          {columns}
                        </div>
                      </div>
                    </div>
                    <div className="jarvis-stats-heatmap-footer">
                      <span>{yearStr}年共阅读 {yearsTotalDays}天，累计 {formatDuration(yearsTotalSecs)}</span>
                      <div className="jarvis-stats-heatmap-legend">
                        <span>少</span>
                        <div className="jarvis-stats-heatmap-legend-box level-0" />
                        <div className="jarvis-stats-heatmap-legend-box level-1" />
                        <div className="jarvis-stats-heatmap-legend-box level-2" />
                        <div className="jarvis-stats-heatmap-legend-box level-3" />
                        <div className="jarvis-stats-heatmap-legend-box level-4" />
                        <span>多</span>
                      </div>
                    </div>
                  </div>
                );
              };

              if (statsTab === "year") {
                const yearStr = (moment as any)(startDate).format("YYYY");
                return renderHeatmapWall(yearStr);
              } else {
                // Stacked heatmaps for All years in descending order
                const currentYear = (moment as any)().year();
                const startYear = earliestYearStr ? (moment as any)(earliestYearStr, "YYYY-MM-DD").year() : currentYear;
                const yearsList = [];
                for (let y = currentYear; y >= startYear; y--) {
                  yearsList.push(String(y));
                }
                return (
                  <div>
                    {yearsList.map(y => renderHeatmapWall(y))}
                  </div>
                );
              }
            })()}
          </div>

          {/* Book Rankings TOP 10 (Not shown for Week view) */}
          {statsTab !== "week" && (
            <div className="jarvis-stats-top-section">
              <div className="jarvis-stats-top-title">
                {isTimeRank ? "阅读时长" : "阅读进度"} TOP {sortedRankBooks.length}
              </div>
              {sortedRankBooks.length > 0 ? (
                <div className="jarvis-stats-top-list">
                  {sortedRankBooks.map(([bookPath, val], idx) => {
                    const book = books.find(b => b.path === bookPath);
                    const cover = book ? getCover(book) : null;
                    const { title, author } = book ? parseBookInfo(book) : { title: bookPath.split("/").pop() || "未知", author: "未知" };
                    
                    const noteFile = book ? bookNotesMap[book.path] : null;
                    let fm: any = {};
                    if (noteFile) {
                      const cache = plugin.app.metadataCache.getFileCache(noteFile);
                      fm = cache?.frontmatter || {};
                    }
                    const displayAuthor = fm.author || fm.creator || cover?.creator || author;

                    const progressPct = isTimeRank ? (maxRankSecs > 0 ? (val / maxRankSecs) * 100 : 0) : val * 100;
                    
                    const isSingleDayMax = bookPath === maxSingleDayBook && maxSingleDaySecs > 0;
                    const isMostNotes = bookPath === maxHighlightsBook && maxHighlightsCount > 0;

                    return (
                      <div key={bookPath} className="jarvis-stats-top-item">
                        <div className="jarvis-stats-top-rank">{idx + 1}</div>
                        {cover?.dataUrl ? (
                          <div className="jarvis-stats-top-cover" style={{ backgroundImage: `url("${cover.dataUrl}")` }} />
                        ) : (
                          <div className="jarvis-stats-top-cover" style={{ background: '#E6E6E6', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '9px', textAlign: 'center', padding: '2px', color: 'var(--text-muted)' }}>
                            {title.slice(0, 4)}
                          </div>
                        )}
                        <div className="jarvis-stats-top-info">
                          <span className="jarvis-stats-top-bookname">{title}</span>
                          <div className="jarvis-stats-top-author-row">
                            <span className="jarvis-stats-top-author">{displayAuthor}</span>
                            {isSingleDayMax && (
                              <span className="jarvis-stats-top-badge">单日阅读最久</span>
                            )}
                            {isMostNotes && (
                              <span className="jarvis-stats-top-badge" style={{ background: 'rgba(45, 140, 240, 0.08)', color: 'var(--text-accent)', border: '1px solid rgba(45, 140, 240, 0.2)' }}>笔记最多</span>
                            )}
                          </div>
                        </div>
                        <div className="jarvis-stats-top-time-col">
                          <span className="jarvis-stats-top-time">
                            {isTimeRank ? formatDuration(val) : `已读 ${Math.round(val * 100)}%`}
                          </span>
                          <div className="jarvis-stats-top-progress-bg">
                            <div className="jarvis-stats-top-progress-bar" style={{ width: `${progressPct}%` }} />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)', fontSize: '12px' }}>暂无书籍阅读记录</div>
              )}
            </div>
          )}

          {/* Preference Analysis (Shown for Year and All views) */}
          {(statsTab === "year" || statsTab === "all") && (
            <div>
              <div className="jarvis-stats-top-title" style={{ marginTop: '24px', marginBottom: '12px' }}>偏好分析</div>
              <div className="jarvis-stats-pref-section">
                {/* Category preference radar */}
                <div className="jarvis-stats-pref-card">
                  <span className="jarvis-stats-pref-title" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-muted)' }}><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path><line x1="7" y1="7" x2="7.01" y2="7"></line></svg>
                    分类偏好
                  </span>
                  <span className="jarvis-stats-pref-sub">
                    {radarData.length > 0 ? `偏好阅读 ${radarData[0].dimension}` : "暂无分类偏好记录"}
                  </span>
                  <div className="jarvis-stats-radar-container">
                    {radarData.length > 0 ? (() => {
                      const CX = 75;
                      const CY = 75;
                      const R = 45;
                      const numPoints = 5;
                      const maxRadarVal = Math.max(...radarData.map(d => d.value), 60);

                      const angles = Array.from({ length: numPoints }).map((_, i) => -Math.PI / 2 + i * (2 * Math.PI / numPoints));

                      // Draw concentric pentagons (5 layers)
                      const pentagons = Array.from({ length: 5 }).map((_, layerIdx) => {
                        const r = R * ((layerIdx + 1) / 5);
                        return angles.map(angle => ({
                          x: CX + r * Math.cos(angle),
                          y: CY + r * Math.sin(angle)
                        }));
                      });

                      // Axis lines from center to outer vertices
                      const axes = angles.map(angle => ({
                        x1: CX,
                        y1: CY,
                        x2: CX + R * Math.cos(angle),
                        y2: CY + R * Math.sin(angle)
                      }));

                      // Data polygon
                      const dataPoints = radarData.map((d, i) => {
                        const angle = angles[i] || 0;
                        const r = R * (d.value / maxRadarVal);
                        return {
                          x: CX + r * Math.cos(angle),
                          y: CY + r * Math.sin(angle),
                          value: d.value
                        };
                      });

                      const polygonPointsStr = dataPoints.map(p => `${p.x},${p.y}`).join(" ");

                      return (
                        <svg width="150" height="150" viewBox="0 0 150 150">
                          {pentagons.map((points, idx) => (
                            <polygon
                              key={`p-${idx}`}
                              points={points.map(p => `${p.x},${p.y}`).join(" ")}
                              fill="none"
                              stroke="var(--background-modifier-border)"
                              strokeWidth="0.8"
                            />
                          ))}
                          {axes.map((axis, idx) => (
                            <line
                              key={`line-${idx}`}
                              x1={axis.x1}
                              y1={axis.y1}
                              x2={axis.x2}
                              y2={axis.y2}
                              stroke="var(--background-modifier-border)"
                              strokeWidth="0.8"
                            />
                          ))}
                          {dataPoints.length > 0 && (
                            <polygon
                              points={polygonPointsStr}
                              fill="rgba(140, 26, 26, 0.08)"
                              stroke="#8C1A1A"
                              strokeWidth="1.5"
                            />
                          )}
                          {dataPoints.map((p, idx) => p.value > 0 && (
                            <circle
                              key={`circle-${idx}`}
                              cx={p.x}
                              cy={p.y}
                              r="2.5"
                              fill="#ffffff"
                              stroke="#8C1A1A"
                              strokeWidth="1.5"
                            />
                          ))}
                          {radarData.map((d, i) => {
                            const angle = angles[i] || 0;
                            const textR = R + 10;
                            const tx = CX + textR * Math.cos(angle);
                            const ty = CY + textR * Math.sin(angle);
                            let textAnchor = "middle";
                            let dy = "3px";
                            if (Math.abs(Math.cos(angle)) > 0.1) {
                              textAnchor = Math.cos(angle) > 0 ? "start" : "end";
                            }
                            if (angle === -Math.PI / 2) {
                              dy = "-4px";
                            } else if (angle > 0 && angle < Math.PI) {
                              dy = "7px";
                            }
                            return (
                              <text
                                key={`txt-${i}`}
                                x={tx}
                                y={ty}
                                textAnchor={textAnchor}
                                dy={dy}
                                fontSize="8px"
                                fill="var(--text-muted)"
                              >
                                {d.dimension}
                              </text>
                            );
                          })}
                        </svg>
                      );
                    })() : (
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>暂无分析数据</div>
                    )}
                  </div>
                </div>

                {/* Publisher preference list */}
                <div className="jarvis-stats-pref-card">
                  <span className="jarvis-stats-pref-title" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-muted)' }}><rect x="4" y="2" width="16" height="20" rx="2" ry="2"></rect><line x1="9" y1="22" x2="9" y2="16"></line><line x1="15" y1="22" x2="15" y2="16"></line><line x1="9" y1="16" x2="15" y2="16"></line><path d="M8 6h8M8 10h8M8 14h8"></path></svg>
                    偏好出版方
                  </span>
                  <span className="jarvis-stats-pref-sub">偏好出版方排行</span>
                  <div className="jarvis-stats-publishers-list">
                    {topPublishers.length > 0 ? (
                      topPublishers.map((pub, idx) => (
                        <div key={pub} className="jarvis-stats-publisher-item">
                          {pub}
                        </div>
                      ))
                    ) : (
                      <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)', fontSize: '11px' }}>暂无出版方信息</div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  // Render Home
  const renderHome = () => {
    let totalAppReadingTime = 0;
    if (plugin.settings.readingStats) {
      for (const daily of Object.values(plugin.settings.readingStats)) {
        for (const secs of Object.values(daily)) {
          totalAppReadingTime += secs as number;
        }
      }
    }

    return (
      <div className="jarvis-library-home" ref={homeRef}>
        {/* Header toolbar */}
        <div className="jarvis-library-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ flex: 1 }}></div>

          {/* Center Search Input */}
          <div className="jarvis-library-search-wrap" style={{ flex: 1.5, display: 'flex', justifyContent: 'center' }}>
            <svg className="jarvis-search-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
            <input
              type="text"
              placeholder="搜索书名、作者..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="jarvis-library-search-input"
            />
            {searchQuery && (
              <button className="jarvis-library-search-clear" onClick={() => setSearchQuery("")}>
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              </button>
            )}
          </div>

          {/* Right side controls */}
          <div className="jarvis-library-header-right" style={{ flex: 1, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '12px' }}>
            <div style={{ position: 'relative', display: 'flex', gap: '8px' }}>
              <button className={`jarvis-library-filter-btn ${showFilters ? 'is-active' : ''}`} onClick={() => setShowFilters(!showFilters)} title="筛选与排序">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>
              </button>

            {showFilters && (
              <div className="jarvis-library-filter-popup">
                <select value={filterStatus} onChange={(e: any) => setFilterStatus(e.target.value)} className="jarvis-library-select">
                  <option value="all">所有状态</option>
                  <option value="unread">未读</option>
                  <option value="reading">在读</option>
                  <option value="finished">已读完</option>
                </select>
                <select value={sortBy} onChange={(e: any) => setSortBy(e.target.value as LibrarySortBy)} className="jarvis-library-select">
                  <option value="recent">最近阅读/修改</option>
                  <option value="rating">评分最高</option>
                  <option value="start">开始时间排序</option>
                  <option value="end">读完时间排序</option>
                  <option value="name">书名排序</option>
                </select>
              </div>
            )}
            </div>

            <div className="jarvis-library-layout-toggle">
              <button className={`jarvis-library-layout-btn ${viewLayout === "grid" ? "is-active" : ""}`} onClick={() => setViewLayout("grid")} title="网格布局">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
              </button>
              <button className={`jarvis-library-layout-btn ${viewLayout === "list" ? "is-active" : ""}`} onClick={() => setViewLayout("list")} title="列表布局">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
              </button>
            </div>

            <div className="jarvis-library-header-actions">
              <button className="jarvis-library-action-icon-btn" title="插件设置" onClick={() => {
                const setting = (plugin as any).app.setting;
                setting.open();
                setting.openTabById(plugin.manifest.id);
              }}>
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
              </button>
            </div>
          </div>
        </div>

        {/* Stats Quick Strip */}
        <div className="jarvis-library-stats-container">
          <div style={{ display: 'flex', gap: '20px', alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', opacity: 0.6 }}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>
            </div>
            <div className="stats-strip-item">
              <span>总书籍 <b>{stats.total}</b></span>
            </div>
            <div className="stats-strip-item">
              <span>在读 <b>{stats.reading}</b></span>
            </div>
            <div className="stats-strip-item">
              <span>已读完 <b>{stats.finished}</b></span>
            </div>
            <div className="stats-strip-item">
              <span>笔记 <b>{stats.highlights}</b></span>
            </div>
            <div className="stats-strip-item">
              <span>词条 <b>{stats.words}</b></span>
            </div>
            <div className="stats-strip-item">
              <span>总阅读时长 <b>{formatDuration(totalAppReadingTime)}</b></span>
            </div>
          </div>
          
          <button 
            className="jarvis-library-back-btn" 
            onClick={() => setCurrentView("stats")}
            title="查看数据统计"
            style={{ padding: "4px 12px !important" }}
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '4px' }}><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>
            详细统计
          </button>
        </div>

        {/* Books shelf grid/list */}
        {filteredBooks.length === 0 ? (
          <div className="jarvis-library-empty-state">
            <p>没有找到符合筛选条件的书籍</p>
          </div>
        ) : viewLayout === "grid" ? (
          <div className="jarvis-library-grid" style={{ gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))` }}>
            {filteredBooks.map((book, i) => {
              const { title, author } = parseBookInfo(book);
              const progress = getProgress(book);
              const percentage = progress ? Math.round((progress.percentage || 0) * 100) : 0;
              const cover = getCover(book);
              const creator = cover?.creator || author;
              const highlightsCount = getHighlightsForBook(plugin.settings, book.path).length;

              const wordsCount = Object.values(plugin.settings.wordAssets || {}).filter((a: any) => a.sources?.some((s: any) => s.bookPath === book.path)).length;
              
              // Real Metadata from Note
              const noteFile = bookNotesMap[book.path];
              let fm: any = {};
              if (noteFile) {
                const cache = plugin.app.metadataCache.getFileCache(noteFile);
                fm = cache?.frontmatter || {};
              }
              const bookStatus = formatBookStatus(resolveBookStatus(fm, percentage));
              const rating = fm.rating ? `评分 ${fm.rating}` : "暂无评分";
              const tags = Array.isArray(fm.tags) ? fm.tags.slice(0, 3) : [];
              const startDate = fm.start_date || "";
              const finishDate = fm.finish_date || "";
              const displayDate = finishDate ? `读完 ${finishDate}` : startDate ? `开始 ${startDate}` : `加入 ${formatDate(book.stat.ctime).split(' ')[0]}`;

              const isSelected = selectedGridBook === book.path;
              const isLastCol = (i % gridCols) === (gridCols - 1);

              return (
                <div key={book.path} style={{ position: 'relative' }}>
                  {/* Invisible placeholder to rigidly hold the grid cell size */}
                  <div className="jarvis-library-book-card" style={{ visibility: 'hidden', pointerEvents: 'none', margin: 0 }}>
                    <div className="book-card-cover-wrap"></div>
                    <div className="book-card-title">{title}</div>
                  </div>

                  {/* Actual interactive card */}
                  <div 
                    className={`jarvis-library-book-card ${isSelected ? 'is-selected' : ''}`} 
                    style={isSelected 
                      ? { position: 'absolute', top: 0, left: isLastCol ? 'auto' : 0, right: isLastCol ? 0 : 'auto', width: 'calc(200% + 20px)', height: 'max-content' } 
                      : { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }
                    }
                    onClick={() => setSelectedGridBook(isSelected ? null : book.path)}
                    onDoubleClick={() => openBook(book)}
                    title={isSelected ? "双击直接开始阅读" : "单击查看详情，双击开始阅读"}
                  >
                  <div className="book-card-cover-wrap">
                    {cover?.dataUrl ? (
                      <img src={cover.dataUrl} alt={title} className="book-card-cover" />
                    ) : (() => {
                      let hash = 0;
                      for (let j = 0; j < title.length; j++) hash = title.charCodeAt(j) + ((hash << 5) - hash);
                      const hue = Math.abs(hash) % 360;
                      const gradientBg = `linear-gradient(135deg, hsl(${hue}, 45%, 65%), hsl(${(hue + 40) % 360}, 55%, 45%))`;
                      return (
                        <div className="book-card-cover-placeholder" style={{ background: gradientBg }}>
                          <span className="placeholder-title">{title.substring(0, 8)}</span>
                        </div>
                      );
                    })()}
                    {!isSelected && percentage > 0 && (
                      <span className="pure-cover-progress">{percentage}%</span>
                    )}
                  </div>
                  {isSelected && (
                    <div className="book-card-info" style={{ display: 'flex', flexDirection: 'column', gap: '6px', color: 'var(--text-normal)' }}>
                      <h4 className="book-card-title" title={title} style={{ fontWeight: 'normal', fontSize: '16px', margin: 0 }}>{title}</h4>
                      <p className="book-card-author" style={{ color: 'var(--text-muted)', margin: 0, fontSize: '13px' }}>{creator}</p>
                      
                      <div className="book-card-meta-list" style={{ marginTop: 'auto', fontSize: '12px', color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <div>状态：{bookStatus}</div>
                        <div>评分：{rating}</div>
                        {tags.length > 0 && <div>标签：{tags.map((t: string) => `#${t}`).join(' ')}</div>}
                        <div>数据：笔记 {highlightsCount} · 词条 {wordsCount} · 时长 {formatDuration(getBookTotalSeconds(plugin.settings.readingStats, book.path))}</div>
                        <div>时间：{displayDate}</div>
                      </div>

                      <div className="book-card-grid-actions" style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                        <button className="jarvis-library-btn btn-primary" onClick={(e) => { e.stopPropagation(); openBook(book); }} style={{ flex: 1, padding: "6px 0", fontSize: "12px", justifyContent: 'center' }}>
                          {percentage > 0 ? "继续阅读" : "开始阅读"}
                        </button>
                        <button className="jarvis-library-btn btn-secondary" onClick={(e) => { e.stopPropagation(); setActiveBook(book); setCurrentView("detail"); }} style={{ flex: 1, padding: "6px 0", fontSize: "12px", justifyContent: 'center' }}>
                          查看详情
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                </div>
              );
            })}
          </div>
        ) : (
          /* List layout - HTML Table */
          <div className="jarvis-library-list" style={{ padding: '0 20px 20px 20px', overflowX: 'auto', flex: 1, minHeight: 0, overflowY: 'auto' }}>
            <table className="jarvis-library-table" style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
              <colgroup>
                <col style={{ width: '28%' }} />
                <col style={{ width: '16%' }} />
                <col style={{ width: '70px' }} />
                <col style={{ width: '90px' }} />
                <col style={{ width: '50px' }} />
                <col style={{ width: '14%' }} />
                <col style={{ width: '110px' }} />
                <col style={{ width: '90px' }} />
                <col style={{ width: '90px' }} />
              </colgroup>
              <thead style={{ position: 'sticky', top: 0, background: 'var(--background-primary)', zIndex: 10 }}>
                <tr style={{ borderBottom: '1px solid var(--background-modifier-border)', color: 'var(--text-muted)' }}>
                  <th style={{ padding: '12px 8px', fontWeight: 'normal' }}>书名</th>
                  <th style={{ padding: '12px 8px', fontWeight: 'normal' }}>作者</th>
                  <th style={{ padding: '12px 8px', fontWeight: 'normal' }}>状态</th>
                  <th style={{ padding: '12px 8px', fontWeight: 'normal' }}>进度</th>
                  <th style={{ padding: '12px 8px', fontWeight: 'normal' }}>评分</th>
                  <th style={{ padding: '12px 8px', fontWeight: 'normal' }}>标签</th>
                  <th style={{ padding: '12px 8px', fontWeight: 'normal' }}>数据 (笔记/词条/时长)</th>
                  <th style={{ padding: '12px 8px', fontWeight: 'normal' }}>开始时间</th>
                  <th style={{ padding: '12px 8px', fontWeight: 'normal' }}>读完时间</th>
                </tr>
              </thead>
              <tbody>
                {filteredBooks.map((book) => {
                  const { title, author } = parseBookInfo(book);
                  const progress = getProgress(book);
                  const percentage = progress ? Math.round((progress.percentage || 0) * 100) : 0;
                  const cover = getCover(book);
                  const creator = cover?.creator || author;
                  const highlightsCount = getHighlightsForBook(plugin.settings, book.path).length;
                  const wordsCount = Object.values(plugin.settings.wordAssets || {}).filter((a: any) => a.sources?.some((s: any) => s.bookPath === book.path)).length;
                  
                  // Real Metadata from Note
                  const noteFile = bookNotesMap[book.path];
                  let fm: any = {};
                  if (noteFile) {
                    const cache = plugin.app.metadataCache.getFileCache(noteFile);
                    fm = cache?.frontmatter || {};
                  }
                  const bookStatus = formatBookStatus(resolveBookStatus(fm, percentage));
                  const rating = fm.rating ? fm.rating : "-";
                  const tags = Array.isArray(fm.tags) ? fm.tags.slice(0, 3) : [];
                  const startDate = fm.start_date || "-";
                  const finishDate = fm.finish_date || "-";

                  let hash = 0;
                  for (let i = 0; i < title.length; i++) {
                    hash = title.charCodeAt(i) + ((hash << 5) - hash);
                  }
                  const hue = Math.abs(hash) % 360;
                  const gradientBg = `linear-gradient(135deg, hsl(${hue}, 45%, 60%), hsl(${(hue + 40) % 360}, 50%, 45%))`;

                  return (
                    <tr 
                      key={book.path} 
                      className="jarvis-library-table-row" 
                      onClick={() => { setActiveBook(book); setCurrentView("detail"); }} 
                      style={{ cursor: 'pointer', borderBottom: '1px solid var(--background-modifier-border)' }}
                    >
                      <td style={{ padding: '12px 8px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                          {cover?.dataUrl ? (
                            <img src={cover.dataUrl} alt={title} style={{ width: '28px', height: '42px', objectFit: 'cover', borderRadius: '4px', flexShrink: 0 }} />
                          ) : (
                            <div style={{ width: '28px', height: '42px', background: gradientBg, borderRadius: '4px', flexShrink: 0 }}></div>
                          )}
                          <span style={{ color: 'var(--text-normal)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', whiteSpace: 'normal', wordBreak: 'break-word' }} title={title}>{title}</span>
                        </div>
                      </td>
                      <td style={{ padding: '12px 8px', color: 'var(--text-muted)' }}>
                        <div style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', whiteSpace: 'normal', wordBreak: 'break-word' }} title={creator}>{creator}</div>
                      </td>
                      <td style={{ padding: '12px 8px', color: 'var(--text-muted)' }}>{bookStatus}</td>
                      <td style={{ padding: '12px 8px', color: 'var(--text-muted)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                           <div style={{ width: '40px', height: '4px', background: 'var(--background-modifier-border)', borderRadius: '2px', overflow: 'hidden' }}>
                             <div style={{ width: `${percentage}%`, height: '100%', background: 'var(--interactive-accent)' }}></div>
                           </div>
                           <span style={{ fontSize: '11px' }}>{percentage}%</span>
                        </div>
                      </td>
                      <td style={{ padding: '12px 8px', color: 'var(--text-muted)' }}>{rating}</td>
                      <td style={{ padding: '12px 8px', color: 'var(--text-muted)' }}>
                        <div style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', whiteSpace: 'normal', wordBreak: 'break-word' }}>
                          {tags.length > 0 ? tags.map((t: string) => `#${t}`).join(' ') : '-'}
                        </div>
                      </td>
                      <td style={{ padding: '12px 8px', color: 'var(--text-muted)' }}>
                        {highlightsCount} / {wordsCount} / {formatDuration(getBookTotalSeconds(plugin.settings.readingStats, book.path))}
                      </td>
                      <td style={{ padding: '12px 8px', color: 'var(--text-muted)' }}>{startDate}</td>
                      <td style={{ padding: '12px 8px', color: 'var(--text-muted)' }}>{finishDate}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  };
  const hiddenFileInput = React.useRef<HTMLInputElement>(null);

  const handleCustomCoverUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !activeBook) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = async () => {
        const canvas = document.createElement("canvas");
        const MAX_DIM = 800;
        let width = img.width;
        let height = img.height;
        if (width > height && width > MAX_DIM) {
          height *= MAX_DIM / width;
          width = MAX_DIM;
        } else if (height > MAX_DIM) {
          width *= MAX_DIM / height;
          height = MAX_DIM;
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, width, height);
        
        canvas.toBlob(async (blob) => {
          if (!blob) return;
          const buffer = await blob.arrayBuffer();
          const targetFolder = plugin.settings.customCoverFolder || "00-Attachment";
          const folderAbstract = plugin.app.vault.getAbstractFileByPath(targetFolder);
          if (!folderAbstract) {
             try { await plugin.app.vault.createFolder(targetFolder); } catch (e) {}
          }
          const baseName = activeBook.basename.replace(/[\\/:*?"<>|]/g, "_");
          const targetPath = `${targetFolder}/cover_${baseName}.jpg`;
          
          let targetFile = plugin.app.vault.getAbstractFileByPath(targetPath);
          if (targetFile instanceof TFile) {
            await plugin.app.vault.modifyBinary(targetFile, buffer);
          } else {
            try {
               targetFile = await plugin.app.vault.createBinary(targetPath, buffer);
            } catch (e) {
               console.error("Failed to create cover file", e);
               return;
            }
          }
          
          if (targetFile instanceof TFile) {
            const key = `${activeBook.path}|${activeBook.stat?.mtime || 0}|${activeBook.stat?.size || 0}`;
            const existingCache = coverCache[key] || {};
            const nextEntry = {
              ...existingCache,
              vaultPath: targetFile.path,
              isCustom: true,
              updated: new Date().toISOString()
            };
            await plugin.saveBookCoverCacheEntry(key, nextEntry);
            setCoverCache({ ...plugin.settings.bookCoverCache });
          }
        }, "image/jpeg", 0.85);
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
    if (hiddenFileInput.current) {
       hiddenFileInput.current.value = "";
    }
  };

  // Render Detail
  const renderDetail = () => {
    if (!activeBook) return null;
    const { title, author } = parseBookInfo(activeBook);
    const progress = getProgress(activeBook);
    const percentage = progress ? Math.round((progress.percentage || 0) * 100) : 0;
    const cover = getCover(activeBook);
    const highlights = detailHighlights;
    const bookmarks = plugin.settings.bookBookmarks?.[activeBook.path] || [];

    // Filter word assets for this book
    const wordAssets = Object.values(plugin.settings.wordAssets || {}).filter((asset: WordAsset) =>
      asset.sources && asset.sources.some((src) => src.bookPath === activeBook.path)
    );

    // Placeholder gradient
    let hash = 0;
    for (let i = 0; i < title.length; i++) {
      hash = title.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = Math.abs(hash) % 360;
    const gradientBg = `linear-gradient(135deg, hsl(${hue}, 45%, 65%), hsl(${(hue + 40) % 360}, 55%, 45%))`;

    // Strip/display description
    const rawDesc = cover?.description || "";
    const description = rawDesc ? stripHtml(rawDesc) : "暂无书籍简介。可在阅读过程中自动拉取或更新简介。";
    const creator = cover?.creator || author;
    const publisher = cover?.publisher || "";
    const pubdateRaw = cover?.pubdate || "";
    const pubdate = pubdateRaw ? pubdateRaw.split('T')[0] : "";

    return (
      <div className="jarvis-library-detail">
        {/* Navigation / Back Header */}
        <div className="jarvis-library-detail-nav">
          <button className="jarvis-library-back-btn" onClick={() => { setCurrentView("home"); setActiveBook(null); }}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
            返回书架
          </button>
          <div className="jarvis-library-detail-actions">
            <button className="jarvis-library-btn btn-warning" onClick={() => deleteBook(activeBook)}>
              删除图书
            </button>
          </div>
        </div>

        {/* Top Info section */}
        <div className="jarvis-library-detail-header">
          <div className="detail-header-cover-side" style={{ position: "relative" }} onClick={() => hiddenFileInput.current?.click()}>
            <input type="file" accept="image/*" ref={hiddenFileInput} onChange={handleCustomCoverUpload} style={{ display: "none" }} />
            <div className="cover-hover-overlay" style={{
              position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
              background: "rgba(0,0,0,0.5)", color: "white",
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
              opacity: 0, transition: "opacity 0.2s", cursor: "pointer", borderRadius: "8px", zIndex: 10
            }} onMouseEnter={(e) => e.currentTarget.style.opacity = "1"} onMouseLeave={(e) => e.currentTarget.style.opacity = "0"}>
               <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: "8px" }}><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>
               <span style={{ fontWeight: 600 }}>更换封面</span>
               <span style={{ fontSize: "12px", opacity: 0.8, marginTop: "8px", textAlign: "center", padding: "0 12px", lineHeight: 1.4 }}>
                 推荐比例 2:3<br/>
                 (建议 600×900 及以上)
               </span>
            </div>
            {cover?.dataUrl ? (
              <img src={cover.dataUrl} alt={title} className="detail-cover" />
            ) : (
              <div className="detail-cover-placeholder" style={{ background: gradientBg }}>
                <span className="placeholder-title">{title}</span>
                <span className="placeholder-format">{activeBook.extension.toUpperCase()}</span>
              </div>
            )}
          </div>
          <div className="detail-header-info-side">
            <h2 className="detail-book-title">{title}</h2>
            <div className="detail-book-meta-row">
              <span className={`book-format-badge format-${activeBook.extension.toLowerCase()}`}>
                {activeBook.extension.toUpperCase()}
              </span>
              <span className="detail-meta-text">作者: {creator}</span>
              {publisher && <span className="detail-meta-text">出版社: {publisher}</span>}
              {pubdate && <span className="detail-meta-text">出版日期: {pubdate}</span>}
            </div>

            {/* Reading progress board */}
            <div className="detail-progress-board">
              <div className="detail-progress-stat">
                <span className="progress-stat-value">{percentage}%</span>
                <span className="progress-stat-label">
                  {percentage >= 99 ? "已读完" : "当前位置"}
                </span>
              </div>
              <div className="detail-progress-divider" />
              <div className="detail-progress-stat">
                <span className="progress-stat-value">{highlights.length}</span>
                <span className="progress-stat-label">笔记</span>
              </div>
              <div className="detail-progress-divider" />
              <div className="detail-progress-stat">
                <span className="progress-stat-value">{wordAssets.length}</span>
                <span className="progress-stat-label">词条</span>
              </div>
            </div>

            {/* Action buttons */}
            <div className="detail-action-buttons" style={{ display: 'flex', gap: '12px', width: '100%', flexWrap: 'wrap' }}>
              <button className="jarvis-library-btn btn-primary" onClick={() => openBook(activeBook)} style={{ flex: 1, minWidth: '120px' }}>
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '6px' }}><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path></svg>
                {percentage > 0 ? "继续阅读" : "开始阅读"}
              </button>
              <button className="jarvis-library-btn btn-secondary" onClick={() => openOrCreateNote(plugin.app, activeBook, "", plugin.settings)} style={{ flex: 1, minWidth: '120px' }}>
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '6px' }}><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><line x1="10" y1="9" x2="8" y2="9"></line></svg>
                打开笔记文件
              </button>
              {wordAssets.length > 0 && (
                <button className="jarvis-library-btn btn-secondary" onClick={() => plugin.openWordBook()} style={{ flex: 1, minWidth: '120px' }}>
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '6px' }}><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>
                  打开词条
                </button>
              )}
            </div>

            {/* Interactive Metadata Editor */}
            <div className="detail-metadata-editor">
              <div className="metadata-row">
                <span className="metadata-label">状态</span>
                <select 
                  className="metadata-select" 
                  value={bookMetadata.status} 
                  onChange={(e) => handleUpdateMetadata("status", e.target.value)}
                >
                  <option value="unread">未读</option>
                  <option value="reading">在读</option>
                  <option value="finished">已读完</option>
                </select>
              </div>
              <div className="metadata-row">
                <span className="metadata-label">评分</span>
                <div className="metadata-stars">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <span 
                      key={star}
                      className={`metadata-star ${bookMetadata.rating >= star ? 'is-filled' : ''}`}
                      onClick={() => handleUpdateMetadata("rating", star)}
                    >
                      ★
                    </span>
                  ))}
                </div>
              </div>
              <div className="metadata-row">
                <span className="metadata-label">开始</span>
                <input 
                  type="date" 
                  className="metadata-input" 
                  value={bookMetadata.startDate} 
                  onChange={(e) => handleUpdateMetadata("startDate", e.target.value)}
                />
              </div>
              <div className="metadata-row">
                <span className="metadata-label">结束</span>
                <input 
                  type="date" 
                  className="metadata-input" 
                  value={bookMetadata.finishDate} 
                  onChange={(e) => handleUpdateMetadata("finishDate", e.target.value)}
                />
              </div>
              <div className="metadata-row">
                <span className="metadata-label">时长</span>
                <span className="metadata-value" style={{ fontSize: '13px', display: 'inline-flex', alignItems: 'center', height: '30px', color: 'var(--text-muted)' }}>
                  {formatDuration(getBookTotalSeconds(plugin.settings.readingStats, activeBook.path))}
                </span>
              </div>
              <div className="metadata-row full-width">
                <span className="metadata-label">标签</span>
                <input 
                  type="text" 
                  className="metadata-input" 
                  placeholder="例如: #科幻 #随笔" 
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onBlur={(e) => {
                    const rawTags = e.target.value.split(/[,，\s]+/).map(t => t.trim()).filter(t => t);
                    const cleanTags = rawTags.map(t => t.replace(/^#/, ''));
                    handleUpdateMetadata("tags", cleanTags);
                    setTagInput(cleanTags.length > 0 ? cleanTags.map(t => `#${t}`).join(" ") : "");
                  }}
                />
              </div>
            </div>
          </div>

          {/* Book introduction (Right column) */}
          <div className="detail-header-intro-side" onDoubleClick={() => setIsEditingIntro(true)}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h4 style={{ margin: 0 }}>书籍简介</h4>
              {!isEditingIntro && (
                <span style={{ fontSize: '12px', cursor: 'pointer', color: 'var(--text-muted)' }} onClick={() => setIsEditingIntro(true)}>
                  ✏️ 自定义
                </span>
              )}
            </div>
            <div className="detail-intro-scroll">
              {isEditingIntro ? (
                <textarea
                  className="metadata-textarea"
                  defaultValue={bookMetadata.summary || (rawDesc ? stripHtml(rawDesc) : "")}
                  autoFocus
                  onBlur={(e) => {
                    handleUpdateMetadata("summary", e.target.value);
                    setIsEditingIntro(false);
                  }}
                  placeholder="在这里输入您自己的简介或笔记摘要..."
                />
              ) : (
                <p style={{ cursor: 'pointer' }} onClick={() => setIsEditingIntro(true)} title="点击或双击编辑简介">
                  {bookMetadata.summary || description || "暂无书籍简介"}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Tab switcher */}
        <div className="jarvis-library-detail-tabs" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="detail-tab-group">
            <button className={`detail-tab-btn ${activeTab === "highlights" ? "is-active" : ""}`} onClick={() => setActiveTab("highlights")}>
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M15.5 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.5L15.5 3z"></path><polyline points="15 3 15 9 21 9"></polyline></svg>
              笔记 ({highlights.length})
            </button>
            <button className={`detail-tab-btn ${activeTab === "words" ? "is-active" : ""}`} onClick={() => setActiveTab("words")}>
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>
              词条 ({wordAssets.length})
            </button>
            <button className={`detail-tab-btn ${activeTab === "bookmarks" ? "is-active" : ""}`} onClick={() => setActiveTab("bookmarks")}>
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"></path></svg>
              书签 ({bookmarks.length})
            </button>
          </div>
        </div>

        {/* Bottom Tab Content */}
        <div className="jarvis-library-detail-content">
          {activeTab === "highlights" ? (
            <BookHighlightsPanel plugin={plugin} book={activeBook} title={title} highlights={highlights} onJump={jumpToHighlight} />
          ) : activeTab === "words" ? (
            /* Word Cards List */
            wordAssets.length === 0 ? (
              <div className="jarvis-library-tab-empty">
                <p>本书暂无关联的单词或翻译卡片。</p>
              </div>
            ) : (
              <div className="jarvis-library-list" style={{ overflow: "auto", padding: "0 4px 20px 4px" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "32px" }}>
                  {(() => {
                    const wordsAndPhrases = (wordAssets as WordAsset[]).filter(w => w.kind !== "sentence");
                    const sentences = (wordAssets as WordAsset[]).filter(w => w.kind === "sentence");
                    return (
                      <>
                        {wordsAndPhrases.length > 0 && (
                          <div>
                            <h3 style={{ marginTop: 0, marginBottom: "16px", paddingBottom: "8px", borderBottom: "1px solid var(--background-modifier-border)", fontSize: "1.1em", fontWeight: "600" }}>单词 & 短语</h3>
                            <table className="jarvis-library-table" style={{ width: "100%", tableLayout: "fixed", borderCollapse: "collapse", textAlign: "left", fontSize: "13px" }}>
                              <thead style={{ position: "sticky", top: 0, background: "var(--background-primary)", zIndex: 1 }}>
                                <tr style={{ borderBottom: "1px solid var(--background-modifier-border)", color: "var(--text-muted)" }}>
                                  <th style={{ padding: "12px 8px", fontWeight: "600", fontSize: "var(--font-ui-small)" }}>词条</th>
                                  <th style={{ padding: "12px 8px", fontWeight: "600", fontSize: "var(--font-ui-small)", width: "55%" }}>释义</th>
                                  <th style={{ padding: "12px 8px", fontWeight: "600", fontSize: "var(--font-ui-small)", width: "60px" }}>状态</th>
                                </tr>
                              </thead>
                              <tbody>{wordsAndPhrases.map(renderTableRow)}</tbody>
                            </table>
                          </div>
                        )}
                        {sentences.length > 0 && (
                          <div>
                            <h3 style={{ marginTop: 0, marginBottom: "16px", paddingBottom: "8px", borderBottom: "1px solid var(--background-modifier-border)", fontSize: "1.1em", fontWeight: "600" }}>长句</h3>
                            <table className="jarvis-library-table" style={{ width: "100%", tableLayout: "fixed", borderCollapse: "collapse", textAlign: "left", fontSize: "13px" }}>
                              <thead style={{ position: "sticky", top: 0, background: "var(--background-primary)", zIndex: 1 }}>
                                <tr style={{ borderBottom: "1px solid var(--background-modifier-border)", color: "var(--text-muted)" }}>
                                  <th style={{ padding: "12px 8px", fontWeight: "600", fontSize: "var(--font-ui-small)" }}>词条</th>
                                  <th style={{ padding: "12px 8px", fontWeight: "600", fontSize: "var(--font-ui-small)", width: "55%" }}>释义</th>
                                  <th style={{ padding: "12px 8px", fontWeight: "600", fontSize: "var(--font-ui-small)", width: "60px" }}>状态</th>
                                </tr>
                              </thead>
                              <tbody>{sentences.map(renderTableRow)}</tbody>
                            </table>
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
              </div>
            )
          ) : <BookBookmarksPanel plugin={plugin} book={activeBook} bookmarks={bookmarks} />}
        </div>
      </div>
    );
  };

  return (
    <div className="jarvis-library-app">
      {currentView === "home" ? (
        renderHome()
      ) : currentView === "detail" ? (
        renderDetail()
      ) : (
        renderStatsView()
      )}
      {renderDebugModal()}
    </div>
  );
}
