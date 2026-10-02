import * as React from "react";
import { bindDialogFocus } from "../dialog-focus";
import { projectLibraryBookNotes } from "./book-note-projection";
import { isBookInFolder } from "../storage-folders";
import type JarvisReaderPlugin from "../main";
import { TFile, Notice, Menu, moment } from "obsidian";
import { getOrCreateBookNote, findBookNote } from "../book-notes";
import { getHighlightsForBook } from "../highlights";
import { confirmDestructiveAction, formatDuration, getBookTotalSeconds } from "../utils";
import type { BookProgress } from "../types";
import { ReadingStatsService } from "../reading-stats-service";
import { openFileOnceInActiveTab } from "../workspace-navigation";

export interface LibraryAppProps {
  plugin: JarvisReaderPlugin;
}

type LibrarySortBy = "recent" | "name" | "rating" | "start" | "end";

interface EpubManifestItem {
  id?: string;
  href?: string;
  type?: string;
}

function todayDate(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
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

export function LibraryApp({ plugin }: LibraryAppProps) {
  // Navigation & UI States
  const [currentView, setCurrentView] = React.useState<"home" | "stats">("home");
  const [timeBook, setTimeBook] = React.useState<TFile | null>(null);
  const [timeDate, setTimeDate] = React.useState(() => todayDate());
  const [timeMinutes, setTimeMinutes] = React.useState("30");
  const [savingTime, setSavingTime] = React.useState(false);
  const manualStats = React.useRef(new ReadingStatsService());
  const [activeBook, setActiveBook] = React.useState<TFile | null>(null);
  const editorRef = React.useRef<HTMLDivElement>(null);
  const timeEditorRef = React.useRef<HTMLFormElement>(null);
  React.useEffect(() => {
    const dialog = activeBook ? editorRef.current : timeBook ? timeEditorRef.current : null;
    return dialog ? bindDialogFocus(dialog) : undefined;
  }, [activeBook, timeBook]);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [filterStatus, setFilterStatus] = React.useState<"all" | "unread" | "reading" | "finished">("all");
  const [sortBy, setSortBy] = React.useState<LibrarySortBy>("recent");
  const [viewLayout, setViewLayout] = React.useState<"grid" | "list">("grid");
  const [showFilters, setShowFilters] = React.useState(false);

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
  const [gridCols, setGridCols] = React.useState(6);
  const [selectedGridBook, setSelectedGridBook] = React.useState<string | null>(null);
  const [bookNotesMap, setBookNotesMap] = React.useState<Record<string, TFile>>({});
  const [bookNoteIssues, setBookNoteIssues] = React.useState<Record<string, string>>({});
  const homeRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (currentView !== "home" || viewLayout !== "grid" || !selectedGridBook) return;
    const ownerDocument = homeRef.current?.ownerDocument;
    if (!ownerDocument) return;
    const collapseOutsideBook = (event: PointerEvent) => {
      if ((event.target as Element | null)?.closest?.('.jarvis-library-book-card')) return;
      setSelectedGridBook(null);
    };
    ownerDocument.addEventListener('pointerdown', collapseOutsideBook, true);
    return () => ownerDocument.removeEventListener('pointerdown', collapseOutsideBook, true);
  }, [currentView, viewLayout, selectedGridBook]);

  const [books, setBooks] = React.useState<TFile[]>([]);
  const [booksLoaded, setBooksLoaded] = React.useState(false);
  const [coverCache, setCoverCache] = React.useState<Record<string, any>>(plugin.settings.bookCoverCache || {});
  const [statsTab, setStatsTab] = React.useState<"week" | "month" | "year" | "all">("week");
  const [statsDate, setStatsDate] = React.useState<Date>(() => new Date());
  const [statsChartType, setStatsChartType] = React.useState<"bar" | "calendar" | "heatmap">("bar");

  const [refreshTrigger, setRefreshTrigger] = React.useState(0);
  // Scan books from Vault
  const loadBooks = React.useCallback(() => {
    const allFiles = plugin.app.vault.getFiles();
    const filtered = allFiles.filter(
      (file) => file instanceof TFile && file.extension.toLowerCase() === "epub" && isBookInFolder(file.path, plugin.settings.bookFolder)
    );
    setBooks(filtered);
    setBooksLoaded(true);
  }, [plugin]);

  React.useEffect(() => {
    loadBooks();
    const onCreate = () => loadBooks();
    const onDelete = () => loadBooks();
    const onRename = () => loadBooks();
    window.addEventListener("jarvis-reader-folders-updated", loadBooks);
    plugin.app.vault.on("create", onCreate);
    plugin.app.vault.on("delete", onDelete);
    plugin.app.vault.on("rename", onRename);
    return () => {
      window.removeEventListener("jarvis-reader-folders-updated", loadBooks);
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
    plugin.app.metadataCache.on("changed", handleAssetOrHighlightChange);
    window.addEventListener("jarvis-reader-word-assets-changed", handleAssetOrHighlightChange);
    window.addEventListener("jarvis-reader-highlights-changed", handleAssetOrHighlightChange);
    return () => {
      plugin.app.metadataCache.off("changed", handleAssetOrHighlightChange);
      window.removeEventListener("jarvis-reader-word-assets-changed", handleAssetOrHighlightChange);
      window.removeEventListener("jarvis-reader-highlights-changed", handleAssetOrHighlightChange);
    };
  }, []);

  // Handle active file syncinges
  React.useEffect(() => {
    setCoverCache(plugin.settings.bookCoverCache || {});
  }, [plugin.settings.bookCoverCache]);

  // Map book paths to their markdown notes
  React.useEffect(() => {
    const projection = projectLibraryBookNotes(books, book => findBookNote(plugin.app, book, plugin.settings));
    setBookNotesMap(projection.notes);
    setBookNoteIssues(projection.issues);
  }, [books, coverCache, plugin.app, plugin.settings, refreshTrigger]);

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
      // Directory filtering only changes visibility; retain covers for every EPUB in the vault.
      const validKeys = plugin.app.vault.getFiles()
        .filter((file) => file.extension.toLowerCase() === "epub")
        .map((file) => `${file.path}|${file.stat?.mtime || 0}|${file.stat?.size || 0}`);
      await plugin.pruneBookCoverCache(validKeys);
      if (cancelled || plugin.bookPathUpdateInProgress || plugin.bookPathUpdateBlocked) return;
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
              ...(plugin.settings.bookCoverCache[key] || {}),
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

    return {
      total,
      reading: readingCount,
      finished: finishedCount,
      unread: unreadCount,
      highlights: totalHighlights,
    };
  }, [books, plugin.settings.bookHighlights, bookNotesMap, plugin.app.metadataCache, plugin.settings.bookProgress, refreshTrigger]);

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
      bookSecondsMap,
      dailySecondsMap,
      monthlySecondsMap,
      yearlySecondsMap,
      radarData,
      topPublishers
    };
  }, [statsTab, statsDate, books, plugin.settings.readingStats, plugin.settings.bookProgress, plugin.settings.bookHighlights, bookNotesMap, plugin.app.metadataCache, refreshTrigger]);

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
    if (!activeBook) return;

    const loadMetadata = () => {
      const projection = projectLibraryBookNotes([activeBook], book => findBookNote(plugin.app, book, plugin.settings));
      const noteFile = projection.notes[activeBook.path];
      
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
    const leaf = await openFileOnceInActiveTab(plugin.app.workspace, file, "epub");
    if (typeof plugin.openBookshelfPane === "function") {
      await plugin.openBookshelfPane(true);
    }
    plugin.app.workspace.setActiveLeaf(leaf, { focus: true });
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

    return (
      <div className="jarvis-library-stats-view">
        <div className="jarvis-library-stats-view-container">
          <div className="jarvis-library-stats-view-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <button className="jarvis-library-back-btn is-icon" aria-label="返回书架" title="返回书架" onClick={() => setCurrentView("home")}>
                <ObsidianIcon name="arrow-left" />
              </button>
              <h2 style={{ margin: 0, fontSize: 'var(--font-ui-medium)', fontWeight: 600 }}>阅读统计</h2>
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
                  <span className={trendClass} style={{ fontSize: 'var(--font-ui-smaller)', padding: '1px 3px', borderRadius: '4px', background: 'var(--background-secondary)' }}>
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
                <div className="jarvis-stats-bar-plot">
                  {/* Grid Lines */}
                  <div style={{ position: 'absolute', left: 'var(--jarvis-stats-axis-width)', right: 0, top: '20px', height: `${chartHeightPx}px`, pointerEvents: 'none', zIndex: 1 }}>
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
                          <span className="jarvis-stats-axis-label">
                            {tick === 0 ? '0' : formatDuration(tick)}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  <div className="jarvis-stats-bar-chart-container" style={{ position: 'relative', zIndex: 2, height: `${chartHeightPx + 46}px` }}>
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
                <div className="jarvis-stats-calendar">
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
                  
                  // The first week may begin in December of the preceding year.
                  const labelDate = colMonday.isBefore(startOfYear) ? startOfYear : colMonday;
                  const m = labelDate.month();
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
                  <div key={yearStr} style={{ marginBottom: '8px' }}>
                    {statsTab === "all" && (
                      <h4 style={{ fontSize: 'var(--font-ui-small)', margin: '0 0 10px 0', fontWeight: 600 }}>{yearStr}</h4>
                    )}
                    <div className="jarvis-stats-heatmap-wrapper">
                      {/* Months Row Header */}
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(53, 10px)', gap: '3px', fontSize: 'var(--font-ui-smaller)', color: 'var(--text-muted)', marginBottom: '4px', paddingLeft: 'calc(var(--font-ui-smaller) + 8px)', width: 'max-content' }}>
                        {monthLabels.map(ml => (
                          <span key={`${ml.label}-${ml.colIndex}`} style={{ gridColumnStart: ml.colIndex + 1, whiteSpace: 'nowrap' }}>{ml.label}</span>
                        ))}
                      </div>
                      
                      <div style={{ display: 'flex', gap: '8px' }}>
                        {/* Weekday labels */}
                        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', fontSize: 'var(--font-ui-smaller)', color: 'var(--text-muted)', height: '88px', padding: '2px 0', width: 'var(--font-ui-smaller)', flexShrink: 0 }}>
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

          {/* Book Rankings TOP 10 for the selected date range */}
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
                          <div className="jarvis-stats-top-cover" style={{ background: 'var(--background-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 'var(--font-ui-smaller)', textAlign: 'center', padding: '2px', color: 'var(--text-muted)' }}>
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
                <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)', fontSize: 'var(--font-ui-smaller)' }}>暂无书籍阅读记录</div>
              )}
            </div>

          {/* Preference Analysis (Shown for Year and All views) */}
          {(statsTab === "year" || statsTab === "all") && (
            <div>
              <div className="jarvis-stats-top-title" style={{ marginTop: 0, marginBottom: '8px' }}>偏好分析</div>
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
                              fill="color-mix(in srgb, var(--interactive-accent) 12%, transparent)"
                              stroke="var(--interactive-accent)"
                              strokeWidth="1.5"
                            />
                          )}
                          {dataPoints.map((p, idx) => p.value > 0 && (
                            <circle
                              key={`circle-${idx}`}
                              cx={p.x}
                              cy={p.y}
                              r="2.5"
                              fill="var(--background-primary)"
                              stroke="var(--interactive-accent)"
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
                                fontSize="var(--font-ui-smaller)"
                                fill="var(--text-muted)"
                              >
                                {d.dimension}
                              </text>
                            );
                          })}
                        </svg>
                      );
                    })() : (
                      <div style={{ fontSize: 'var(--font-ui-smaller)', color: 'var(--text-muted)' }}>暂无分析数据</div>
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
                      <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)', fontSize: 'var(--font-ui-smaller)' }}>暂无出版方信息</div>
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
        {Object.keys(bookNoteIssues).length > 0 && (
          <div role="status" style={{ color: "var(--text-muted)", fontSize: "var(--font-ui-small)", marginBottom: "12px" }}>
            {Object.keys(bookNoteIssues).length} 本书的读书笔记关联路径失效，阅读仍可用；请恢复或修正笔记路径。
          </div>
        )}
        {/* Header toolbar */}
        <div className="jarvis-library-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="jarvis-library-header-spacer" style={{ flex: 1 }}></div>

          {/* Center Search Input */}
          <div className="jarvis-library-search-wrap" style={{ flex: 1.5, display: 'flex', justifyContent: 'center' }}>
            <ObsidianIcon name="search" className="jarvis-search-icon" />
            <input
              type="text"
              placeholder="搜索书名、作者..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="jarvis-library-search-input"
            />
            {searchQuery && (
              <button aria-label="清除搜索" title="清除搜索" className="jarvis-library-search-clear" onClick={() => setSearchQuery("")}>
                <ObsidianIcon name="x" />
              </button>
            )}
          </div>

          {/* Right side controls */}
          <div className="jarvis-library-header-right" style={{ flex: 1, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '12px' }}>
            <div style={{ position: 'relative', display: 'flex', gap: '8px' }}>
              <button className={`jarvis-library-filter-btn ${showFilters ? 'is-active' : ''}`} onClick={() => setShowFilters(!showFilters)} aria-label="筛选与排序" aria-expanded={showFilters} title="筛选与排序">
                <ObsidianIcon name="sliders-horizontal" />
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
              <button className={`jarvis-library-layout-btn ${viewLayout === "grid" ? "is-active" : ""}`} onClick={() => setViewLayout("grid")} aria-label="网格布局" aria-pressed={viewLayout === "grid"} title="网格布局">
                <ObsidianIcon name="layout-grid" />
              </button>
              <button className={`jarvis-library-layout-btn ${viewLayout === "list" ? "is-active" : ""}`} onClick={() => setViewLayout("list")} aria-label="列表布局" aria-pressed={viewLayout === "list"} title="列表布局">
                <ObsidianIcon name="list" />
              </button>
            </div>

            <div className="jarvis-library-header-actions">
              <button className="jarvis-library-action-icon-btn" aria-label="插件设置" title="插件设置" onClick={() => {
                const setting = (plugin as any).app.setting;
                setting.open();
                setting.openTabById(plugin.manifest.id);
              }}>
                <ObsidianIcon name="settings" />
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
              <span>总阅读时长 <b>{formatDuration(totalAppReadingTime)}</b></span>
            </div>
          </div>
          
          <button 
            className="jarvis-library-back-btn" 
            onClick={() => setCurrentView("stats")}
          >
            <ObsidianIcon name="chart-no-axes-column" />
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
            {filteredBooks.map((book) => {
              const { title } = parseBookInfo(book);
              const progress = getProgress(book);
              const percentage = progress ? Math.round((progress.percentage || 0) * 100) : 0;
              const cover = getCover(book);
              const isSelected = selectedGridBook === book.path;
              return (
                <div key={book.path} className={`jarvis-library-book-card ${isSelected ? 'is-selected' : ''}`}
                  onClick={() => setSelectedGridBook(book.path)}
                  onDoubleClick={() => openBook(book)}
                  onContextMenu={(event) => { event.preventDefault(); showBookMenu(book, event); }}
                  tabIndex={0} role="button" aria-label={title} aria-pressed={isSelected}
                  onKeyDown={(event) => { if (event.target !== event.currentTarget) return; if (event.key === "Enter") { event.preventDefault(); void openBook(book); } else if (event.key === " ") { event.preventDefault(); setSelectedGridBook(book.path); } }}>
                  <div className="book-card-cover-wrap">
                    {cover?.dataUrl ? <img src={cover.dataUrl} alt={title} className="book-card-cover" /> : (
                      <div className="book-card-cover-placeholder"><span className="placeholder-title">{title}</span></div>
                    )}
                  </div>
                  <div className="book-card-footer">
                    <span>{percentage}%</span>
                    <button className="book-card-menu" aria-label={`书籍选项：${title}`}
                      onClick={(event) => { event.stopPropagation(); showBookMenu(book, event); }}
                      onDoubleClick={(event) => event.stopPropagation()}>
                      <ObsidianIcon name="ellipsis" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          /* List layout - HTML Table */
          <div className="jarvis-library-list" style={{ padding: '0 20px 20px 20px', overflowX: 'auto', flex: 1, minHeight: 0, overflowY: 'auto' }}>
            <table className="jarvis-library-table" style={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse', textAlign: 'left', fontSize: 'var(--font-ui-small)' }}>
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
                  <th style={{ padding: '12px 8px', fontWeight: 'normal' }}>数据 (笔记/时长)</th>
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
                      onClick={() => setSelectedGridBook(book.path)}
                      onDoubleClick={() => openBook(book)}
                      onContextMenu={(event) => { event.preventDefault(); showBookMenu(book, event); }}
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
                           <span style={{ fontSize: 'var(--font-ui-smaller)' }}>{percentage}%</span>
                        </div>
                      </td>
                      <td style={{ padding: '12px 8px', color: 'var(--text-muted)' }}>{rating}</td>
                      <td style={{ padding: '12px 8px', color: 'var(--text-muted)' }}>
                        <div style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', whiteSpace: 'normal', wordBreak: 'break-word' }}>
                          {tags.length > 0 ? tags.map((t: string) => `#${t}`).join(' ') : '-'}
                        </div>
                      </td>
                      <td style={{ padding: '12px 8px', color: 'var(--text-muted)' }}>
                        {highlightsCount} / {formatDuration(getBookTotalSeconds(plugin.settings.readingStats, book.path))}
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
  const coverUploadBook = React.useRef<TFile | null>(null);

  const handleCustomCoverUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    const uploadBook = coverUploadBook.current;
    if (!file || !uploadBook) return;

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
          try {
            await plugin.saveCustomCover(uploadBook, buffer);
            setCoverCache({ ...plugin.settings.bookCoverCache });
          } catch (error) {
            new Notice(error instanceof Error ? error.message : "封面保存失败，请检查封面目录或缓存状态。");
            console.error("Failed to save custom cover", error);
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

  const showBookMenu = (book: TFile, event: React.MouseEvent) => {
    setSelectedGridBook(book.path);
    const menu = new Menu();
    menu.addItem(item => item.setTitle("编辑阅读资料").setIcon("sliders-horizontal").onClick(() => setActiveBook(book)));
    menu.addItem(item => item.setTitle("更换封面").setIcon("image").onClick(() => {
      coverUploadBook.current = book;
      hiddenFileInput.current?.click();
    }));
    const coverKey = `${book.path}|${book.stat?.mtime || 0}|${book.stat?.size || 0}`;
    const currentCover = plugin.settings.bookCoverCache[coverKey];
    if (currentCover?.isCustom || currentCover?.vaultPath) {
      menu.addItem(item => item.setTitle("恢复原始封面").setIcon("rotate-ccw").onClick(async () => {
        try {
          await plugin.restoreOriginalCover(book);
          setCoverCache({ ...plugin.settings.bookCoverCache });
          setBooks(current => [...current]);
        } catch (error) {
          new Notice(error instanceof Error ? error.message : "恢复封面失败，请重试。");
        }
      }));
    }
    menu.addItem(item => item.setTitle("补录阅读时长").setIcon("clock").onClick(() => {
      setTimeDate(todayDate());
      setTimeMinutes("30");
      setTimeBook(book);
    }));
    menu.addSeparator();
    menu.addItem(item => item.setTitle("删除").setIcon("trash").onClick(() => { void deleteBook(book); }));
    const rect = event.currentTarget.getBoundingClientRect();
    menu.showAtPosition({ x: event.type === "contextmenu" ? event.clientX : rect.left, y: event.type === "contextmenu" ? event.clientY : rect.bottom });
  };

  const renderBookEditor = () => activeBook ? (
    <div className="jarvis-book-editor-backdrop" onClick={() => setActiveBook(null)}>
      <div ref={editorRef} tabIndex={-1} className="jarvis-book-editor" role="dialog" aria-modal="true" aria-label="编辑阅读资料"
        onClick={event => event.stopPropagation()} onKeyDown={event => { if (event.key === "Escape") setActiveBook(null); }}>
        <div className="jarvis-book-editor-header"><h3>编辑阅读资料</h3><button aria-label="关闭" onClick={() => setActiveBook(null)}>×</button></div>
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
                    <button
                      type="button"
                      aria-label={`${star}星`}
                      aria-pressed={bookMetadata.rating === star}
                      key={star}
                      className={`metadata-star ${bookMetadata.rating >= star ? 'is-filled' : ''}`}
                      onClick={() => handleUpdateMetadata("rating", star)}
                    >
                      ★
                    </button>
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
                <span className="metadata-value" style={{ fontSize: 'var(--font-ui-small)', display: 'inline-flex', alignItems: 'center', height: '30px', color: 'var(--text-muted)' }}>
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
    </div>
  ) : null;

  return (
    <div className="jarvis-library-app">
      {currentView === "home" ? (
        renderHome()
      ) : (
        renderStatsView()
      )}
      <input type="file" accept="image/*" ref={hiddenFileInput} onChange={handleCustomCoverUpload} style={{ display: "none" }} />
      {renderBookEditor()}
      {timeBook && <div className="jarvis-book-editor-backdrop" onClick={() => { if (!savingTime) setTimeBook(null); }}>
        <form ref={timeEditorRef} tabIndex={-1} className="jarvis-book-editor" role="dialog" aria-modal="true" aria-label="补录阅读时长"
          onKeyDown={event => { if (event.key === "Escape" && !savingTime) setTimeBook(null); }}
          onClick={event => event.stopPropagation()} onSubmit={async event => {
            event.preventDefault();
            if (savingTime) return;
            setSavingTime(true);
            try {
              const stats = plugin.settings.readingStats || (plugin.settings.readingStats = {});
              await manualStats.current.recordManual(timeBook.path, timeDate, Number(timeMinutes), stats, () => plugin.saveSettings());
              setRefreshTrigger(value => value + 1);
              setTimeBook(null);
              new Notice("阅读时长已补录");
            } catch (error) { new Notice(`补录失败：${String(error)}`); }
            finally { setSavingTime(false); }
          }}>
          <h3>补录阅读时长</h3>
          <div className="metadata-row"><label htmlFor="jr-reading-date">日期</label><input id="jr-reading-date" type="date" required value={timeDate} onChange={event => setTimeDate(event.target.value)} /></div>
          <div className="metadata-row"><label htmlFor="jr-reading-minutes">分钟</label><input id="jr-reading-minutes" type="number" min="1" max="1440" step="1" required value={timeMinutes} onChange={event => setTimeMinutes(event.target.value)} /></div>
          <div className="jarvis-book-editor-header"><button type="button" disabled={savingTime} onClick={() => setTimeBook(null)}>取消</button><button type="submit" disabled={savingTime}>保存</button></div>
        </form>
      </div>}
    </div>
  );
}
