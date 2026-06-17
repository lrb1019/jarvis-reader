import * as React from "react";
import type JarvisReaderPlugin from "../main";
import { TFile, Notice, MarkdownRenderer } from "obsidian";
import { openOrCreateNote, getOrCreateBookNote, getBookNotePath, findBookNote } from "../book-notes";
import { getHighlightsForBook } from "../highlights";
import { buildWordAudioUrl, DEFAULT_WORD_AUDIO_TEMPLATE } from "../word-assets";
import type { BookHighlight, WordAsset, BookProgress } from "../types";
import { WordCard } from "../word-book/WordCard";

export interface LibraryAppProps {
  plugin: JarvisReaderPlugin;
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
  return status === "finished" ? "已读完" : status === "reading" ? "在读中" : "未读";
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
  const [currentView, setCurrentView] = React.useState<"home" | "detail">("home");
  const [activeBook, setActiveBook] = React.useState<TFile | null>(null);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [filterStatus, setFilterStatus] = React.useState<"all" | "unread" | "reading" | "finished">("all");
  const [sortBy, setSortBy] = React.useState<"recent" | "name">("recent");
  const [viewLayout, setViewLayout] = React.useState<"grid" | "list" | "coverflow">("grid");
  const [coverFlowIndex, setCoverFlowIndex] = React.useState(0);
  const [activeTab, setActiveTab] = React.useState<"highlights" | "words" | "bookmarks">("highlights");
  const [descExpanded, setDescExpanded] = React.useState(false);
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
  const [isEditingIntro, setIsEditingIntro] = React.useState(false);
  const [gridCols, setGridCols] = React.useState(6);
  const [selectedGridBook, setSelectedGridBook] = React.useState<string | null>(null);
  const [isSpinning, setIsSpinning] = React.useState(false);
  const [bookNotesMap, setBookNotesMap] = React.useState<Record<string, TFile>>({});
  const homeRef = React.useRef<HTMLDivElement>(null);
  const wheelTimeoutRef = React.useRef<any>(null);

  const [books, setBooks] = React.useState<TFile[]>([]);
  const [coverCache, setCoverCache] = React.useState<Record<string, any>>(plugin.settings.bookCoverCache || {});
  const [noteFallbackCovers, setNoteFallbackCovers] = React.useState<Record<string, string>>({});
  const [showStatsModal, setShowStatsModal] = React.useState(false);
  const [debugImages, setDebugImages] = React.useState<{href: string, size: number, dataUrl: string}[] | null>(null);

  // Scan books from Vault
  const loadBooks = React.useCallback(() => {
    const allFiles = plugin.app.vault.getFiles();
    const filtered = allFiles.filter(
      (file) => file instanceof TFile && file.extension.toLowerCase() === "epub"
    );
    setBooks(filtered);
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

  // Handle active file syncinges
  React.useEffect(() => {
    setCoverCache(plugin.settings.bookCoverCache || {});
  }, [plugin.settings.bookCoverCache]);

  // Find fallback covers from markdown notes for books without covers
  React.useEffect(() => {
    if (books.length === 0) return;
    const fallbacks: Record<string, string> = {};
    const notesMap: Record<string, TFile> = {};
    let changedFallbacks = false;
    let changedNotes = false;

    books.forEach(book => {
      const noteFile = findBookNote(plugin.app, book, plugin.settings);
      if (noteFile) {
        notesMap[book.path] = noteFile;
        changedNotes = true;
      }

      const key = `${book.path}|${book.stat?.mtime || 0}|${book.stat?.size || 0}`;
      const cover = coverCache[key];
      if (!cover || !cover.dataUrl) {
        if (noteFile) {
          const cache = plugin.app.metadataCache.getFileCache(noteFile);
          if (cache?.embeds && cache.embeds.length > 0) {
            const imgEmbed = cache.embeds.find(e => {
                const ext = e.link.split('.').pop()?.toLowerCase();
                return ext && ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'].includes(ext);
            }) || cache.embeds[0];
            const imgFile = plugin.app.metadataCache.getFirstLinkpathDest(imgEmbed.link, noteFile.path);
            if (imgFile instanceof TFile) {
              const resourcePath = plugin.app.vault.getResourcePath(imgFile);
              fallbacks[book.path] = resourcePath;
              changedFallbacks = true;
            }
          }
        }
      }
    });
    if (changedFallbacks) {
      setNoteFallbackCovers(fallbacks);
    }
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
  }, [viewLayout]);

  // Background cover queue worker
  React.useEffect(() => {
    if (books.length === 0) return;
    let cancelled = false;

    const runCoverCacheQueue = async () => {
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
                const imageItems = Object.values(manifest).filter((item: any) => item.type?.startsWith("image/"));
                
                // Prioritize items with "cover" or "front" in name
                const coverCandidates = imageItems.filter((item: any) => {
                  const idHref = (item.id + item.href).toLowerCase();
                  return idHref.includes("cover") || idHref.includes("front");
                });

                for (const item of coverCandidates) {
                  try {
                    const resolvedHref = book.path ? book.path.resolve(item.href) : item.href;
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
                      const resolvedHref = book.path ? book.path.resolve(item.href) : item.href;
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

            plugin.settings.bookCoverCache[key] = {
              dataUrl,
              updated: new Date().toISOString(),
              description,
              creator,
              publisher,
              pubdate,
              coverVersion: 10,
            };

            await plugin.saveSettings();
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
  }, [books, plugin]);

  // Book getters
  const getCover = (file: TFile) => {
    const key = `${file.path}|${file.stat?.mtime || 0}|${file.stat?.size || 0}`;
    const cached = coverCache[key];
    if (cached && cached.dataUrl) return cached;
    
    if (noteFallbackCovers[file.path]) {
      return { ...(cached || {}), dataUrl: noteFallbackCovers[file.path] };
    }
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

  // Keyboard Navigation for CoverFlow
  React.useEffect(() => {
    if (viewLayout !== "coverflow" || filteredBooks.length === 0) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        setCoverFlowIndex((prev) => Math.max(0, prev - 1));
      } else if (e.key === "ArrowRight") {
        setCoverFlowIndex((prev) => Math.min(filteredBooks.length - 1, prev + 1));
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [viewLayout, filteredBooks.length]);

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
    // Obsidian style notification & prompt
    if (confirm(`确认要从库中彻底删除《${file.basename}》吗？`)) {
      try {
        await plugin.app.vault.delete(file);
        new Notice(`已删除书籍: ${file.basename}`);
        if (activeBook?.path === file.path) {
          setCurrentView("home");
          setActiveBook(null);
        }
        loadBooks();
      } catch (err) {
        new Notice(`删除失败: ${err}`);
      }
    }
  };

  const handleRandomSelect = () => {
    if (filteredBooks.length === 0 || isSpinning) return;
    setIsSpinning(true);
    let spins = 0;
    const maxSpins = 20;
    
    // Quick interval to simulate spinning
    const interval = setInterval(() => {
      const randomIndex = Math.floor(Math.random() * filteredBooks.length);
      setCoverFlowIndex(randomIndex);
      spins++;
      
      if (spins >= maxSpins) {
        clearInterval(interval);
        setIsSpinning(false);
      }
    }, 60);
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
      plugin.settings.wordAssets[lemma].mastered = !currentVal;
      plugin.settings.wordAssets[lemma].updated = new Date().toISOString();
      await plugin.saveSettings();
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

  // Stats Modal
  const renderStatsModal = () => {
    if (!showStatsModal) return null;
    return (
      <div className="jarvis-library-stats-modal-overlay" onClick={() => setShowStatsModal(false)}>
        <div className="jarvis-library-stats-modal" onClick={(e) => e.stopPropagation()}>
          <div className="jarvis-library-stats-modal-header">
            <h3>📊 阅读统计</h3>
            <button className="jarvis-library-stats-close-btn" onClick={() => setShowStatsModal(false)}>
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6 6 18M6 6l12 12"/></svg>
            </button>
          </div>
          <div className="jarvis-library-stats-grid">
            <div className="jarvis-library-stats-card">
              <span className="jarvis-library-stats-label">全部书籍</span>
              <span className="jarvis-library-stats-number">{stats.total}</span>
            </div>
            <div className="jarvis-library-stats-card">
              <span className="jarvis-library-stats-label">在读中</span>
              <span className="jarvis-library-stats-number status-reading">{stats.reading}</span>
            </div>
            <div className="jarvis-library-stats-card">
              <span className="jarvis-library-stats-label">已读完</span>
              <span className="jarvis-library-stats-number status-finished">{stats.finished}</span>
            </div>
            <div className="jarvis-library-stats-card">
              <span className="jarvis-library-stats-label">未开始</span>
              <span className="jarvis-library-stats-number status-unread">{stats.unread}</span>
            </div>
            <div className="jarvis-library-stats-card">
              <span className="jarvis-library-stats-label">划线摘抄</span>
              <span className="jarvis-library-stats-number">{stats.highlights}</span>
            </div>
            <div className="jarvis-library-stats-card">
              <span className="jarvis-library-stats-label">收集词卡</span>
              <span className="jarvis-library-stats-number">{stats.words}</span>
            </div>
          </div>
          <div className="jarvis-library-stats-visuals">
            <span className="jarvis-library-stats-subheader">阅读进度比例</span>
            <div className="jarvis-library-progress-track">
              <div className="jarvis-library-progress-bar status-finished" style={{ width: `${stats.total ? (stats.finished / stats.total) * 100 : 0}%` }} title={`已读完: ${stats.finished}`} />
              <div className="jarvis-library-progress-bar status-reading" style={{ width: `${stats.total ? (stats.reading / stats.total) * 100 : 0}%` }} title={`在读中: ${stats.reading}`} />
              <div className="jarvis-library-progress-bar status-unread" style={{ width: `${stats.total ? (stats.unread / stats.total) * 100 : 0}%` }} title={`未开始: ${stats.unread}`} />
            </div>
            <div className="jarvis-library-progress-legend">
              <span><span className="legend-dot status-finished"/>已读完 {stats.total ? Math.round((stats.finished / stats.total) * 100) : 0}%</span>
              <span><span className="legend-dot status-reading"/>在读中 {stats.total ? Math.round((stats.reading / stats.total) * 100) : 0}%</span>
              <span><span className="legend-dot status-unread"/>未开始 {stats.total ? Math.round((stats.unread / stats.total) * 100) : 0}%</span>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // Render Home
  const renderHome = () => {
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
              {viewLayout === "coverflow" && (
                <button className={`jarvis-library-filter-btn`} onClick={handleRandomSelect} title="随机选书">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={isSpinning ? 'jarvis-spin-anim' : ''}><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.3"/></svg>
                </button>
              )}
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
                <select value={sortBy} onChange={(e: any) => setSortBy(e.target.value)} className="jarvis-library-select">
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
              <button className={`jarvis-library-layout-btn ${viewLayout === "coverflow" ? "is-active" : ""}`} onClick={() => { setViewLayout("coverflow"); setCoverFlowIndex(0); }} title="3D 封面流">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="10" rx="2" ry="2"></rect><line x1="12" y1="7" x2="12" y2="17"></line></svg>
              </button>
            </div>

            <div className="jarvis-library-header-actions">
              <button className="jarvis-library-action-icon-btn" title="阅读统计" onClick={() => setShowStatsModal(true)}>
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>
              </button>
              <button className="jarvis-library-action-icon-btn" title="插件设置" onClick={() => (plugin as any).app.setting.openTabById(plugin.manifest.id)}>
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
              </button>
            </div>
          </div>
        </div>

        {/* Stats Quick Strip */}
        <div className="jarvis-library-stats-strip minimalist" onClick={() => setShowStatsModal(true)}>
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
            <span>划线摘抄 <b>{stats.highlights}</b></span>
          </div>
          <div className="stats-strip-item">
            <span>词句卡片 <b>{stats.words}</b></span>
          </div>
        </div>

        {/* Books shelf grid/list */}
        {filteredBooks.length === 0 ? (
          <div className="jarvis-library-empty-state">
            <p>没有找到符合筛选条件的书籍</p>
          </div>
        ) : viewLayout === "coverflow" ? (
          <div className="jarvis-library-coverflow-wrapper">
            {/* Left: 3D Scene */}
            <div className="jarvis-library-coverflow-scene" onWheel={(e) => {
              if (wheelTimeoutRef.current) return;
              if (e.deltaY > 0) {
                setCoverFlowIndex(p => p + 1);
              } else if (e.deltaY < 0) {
                setCoverFlowIndex(p => p - 1);
              }
              wheelTimeoutRef.current = setTimeout(() => {
                wheelTimeoutRef.current = null;
              }, 80);
            }}>
              <div className="jarvis-library-cf-stage">
                {Array.from({ length: 31 }).map((_, idx) => {
                  const offset = idx - 15;
                  const virtualPos = coverFlowIndex + offset;
                  
                  let actualIndex = virtualPos % filteredBooks.length;
                  if (actualIndex < 0) actualIndex += filteredBooks.length;
                  
                  const book = filteredBooks[actualIndex];
                  if (!book) return null;

                  const cover = getCover(book);
                  const { title } = parseBookInfo(book);
                  const absOffset = Math.abs(offset);
                  const sign = Math.sign(offset);
                  // Calibre-style gentle U-shape arc:
                  // 1. push the stack further away from center (140) but keep tight spacing between cards (35)
                  // 2. drastically reduce Z-axis dropoff (40 instead of 80) so cards don't shrink rapidly into a V-shape
                  // 3. steepen the rotation (75deg) so side cards show mostly their spines/edges
                  const translateX = sign * (140 + absOffset * 35);
                  const translateZ = -absOffset * 40;
                  const rotateY = sign * -75;
                  
                  const transform = offset === 0 
                    ? `translate(-50%, -50%) translateZ(40px) scale(1.02)` 
                    : `translate(-50%, -50%) translateX(${translateX}px) translateZ(${translateZ}px) rotateY(${rotateY}deg)`;

                  let gradientBg = "";
                  if (!cover?.dataUrl) {
                    let hash = 0;
                    for (let j = 0; j < title.length; j++) hash = title.charCodeAt(j) + ((hash << 5) - hash);
                    const hue = Math.abs(hash) % 360;
                    gradientBg = `linear-gradient(135deg, hsl(${hue}, 45%, 65%), hsl(${(hue + 40) % 360}, 55%, 45%))`;
                  }

                  return (
                    <div 
                      key={virtualPos} 
                      className={`jarvis-library-cf-card ${offset === 0 ? "is-active" : ""}`} 
                      style={{ transform, zIndex: 100 - absOffset }} 
                      onClick={() => {
                        if (offset !== 0) setCoverFlowIndex(virtualPos);
                        else { setActiveBook(book); setCurrentView("detail"); }
                      }}
                    >
                      <div className="cf-card-inner">
                        {cover?.dataUrl ? (
                          <img src={cover.dataUrl} alt={title} />
                        ) : (
                          <div className="cf-placeholder" style={{ background: gradientBg }}>
                            <span>{title}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Right: Focused Book Info */}
            <div className="jarvis-library-cf-info">
              {(() => {
                let actualIndex = coverFlowIndex % filteredBooks.length;
                if (actualIndex < 0) actualIndex += filteredBooks.length;
                const activeB = filteredBooks[actualIndex];
                if (!activeB) return null;
                const { title, author } = parseBookInfo(activeB);
                const progress = getProgress(activeB);
                const percentage = progress ? Math.round((progress.percentage || 0) * 100) : 0;
                const cover = getCover(activeB);
                const highlightsCount = getHighlightsForBook(plugin.settings, activeB.path).length;
                const wordsCount = Object.values(plugin.settings.wordAssets || {}).filter((a: any) => a.sources?.some((s: any) => s.bookPath === activeB.path)).length;
                
                const rawDesc = cover?.description || "";
                const description = rawDesc ? stripHtml(rawDesc) : "暂无书籍简介。";
                const creator = cover?.creator || author;

                const noteFile = bookNotesMap[activeB.path];
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
                const displayDate = finishDate ? `读完 ${finishDate}` : startDate ? `开始 ${startDate}` : `加入 ${formatDate(activeB.stat.ctime).split(' ')[0]}`;

                return (
                  <div className="cf-info-content">
                    <h2 className="cf-info-title">{title}</h2>
                    <p className="cf-info-author">{creator}</p>
                    
                    <div className="cf-info-stats">
                      <div className="cf-stat">
                        <span className="cf-stat-val">{percentage}%</span>
                        <span className="cf-stat-lbl">进度</span>
                      </div>
                      <div className="cf-stat">
                        <span className="cf-stat-val">{highlightsCount}</span>
                        <span className="cf-stat-lbl">划线</span>
                      </div>
                      <div className="cf-stat">
                        <span className="cf-stat-val">{wordsCount}</span>
                        <span className="cf-stat-lbl">词卡</span>
                      </div>
                    </div>

                    <div className="book-card-meta-list" style={{ marginTop: '16px', fontSize: '13px', color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <div>状态：{bookStatus}</div>
                      <div>评分：{rating}</div>
                      <div className="text-ellipsis" style={{ minHeight: '19px' }}>标签：{tags.length > 0 ? tags.map((t: string) => `#${t}`).join(' ') : '无'}</div>
                      <div>时间：{displayDate}</div>
                    </div>

                    <div className="cf-info-desc" style={{ marginTop: '16px' }}>
                      <p>{description}</p>
                    </div>

                    <div className="cf-info-actions">
                      <button className="jarvis-library-btn btn-primary" onClick={() => openBook(activeB)}>
                        {percentage > 0 ? "继续阅读" : "开始阅读"}
                      </button>
                      <button className="jarvis-library-btn btn-secondary" onClick={() => { setActiveBook(activeB); setCurrentView("detail"); }}>
                        查看详情
                      </button>
                    </div>
                  </div>
                );
              })()}
            </div>
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
                        <div>数据：划线 {highlightsCount} · 词卡 {wordsCount}</div>
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
                  <th style={{ padding: '12px 8px', fontWeight: 'normal' }}>数据 (划线/词卡)</th>
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
                      <td style={{ padding: '12px 8px', color: 'var(--text-muted)' }}>{highlightsCount} / {wordsCount}</td>
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

  // Render Detail
  const renderDetail = () => {
    if (!activeBook) return null;
    const { title, author } = parseBookInfo(activeBook);
    const progress = getProgress(activeBook);
    const percentage = progress ? Math.round((progress.percentage || 0) * 100) : 0;
    const cover = getCover(activeBook);
    const highlights = getHighlightsForBook(plugin.settings, activeBook.path);
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
          <div className="detail-header-cover-side">
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
                <span className="progress-stat-label">划线摘抄</span>
              </div>
              <div className="detail-progress-divider" />
              <div className="detail-progress-stat">
                <span className="progress-stat-value">{wordAssets.length}</span>
                <span className="progress-stat-label">关联词卡</span>
              </div>
            </div>

            {/* Action buttons */}
            <div className="detail-action-buttons" style={{ display: 'flex', gap: '12px', width: '100%' }}>
              <button className="jarvis-library-btn btn-primary" onClick={() => openBook(activeBook)} style={{ flex: 1 }}>
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '6px' }}><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path></svg>
                {percentage > 0 ? "继续阅读" : "开始阅读"}
              </button>
              <button className="jarvis-library-btn btn-secondary" onClick={() => openOrCreateNote(plugin.app, activeBook, "", plugin.settings)} style={{ flex: 1 }}>
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '6px' }}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                打开笔记文件
              </button>
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
        {/* Tab switcher */}
        <div className="jarvis-library-detail-tabs" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <button className={`detail-tab-btn ${activeTab === "highlights" ? "is-active" : ""}`} onClick={() => setActiveTab("highlights")}>
              ✏️ 我的划线与感想 ({highlights.length})
            </button>
            <button className={`detail-tab-btn ${activeTab === "words" ? "is-active" : ""}`} onClick={() => setActiveTab("words")}>
              📇 关联词句卡片 ({wordAssets.length})
            </button>
            <button className={`detail-tab-btn ${activeTab === "bookmarks" ? "is-active" : ""}`} onClick={() => setActiveTab("bookmarks")}>
              🔖 书签 ({bookmarks.length})
            </button>
          </div>
        </div>

        {/* Bottom Tab Content */}
        <div className="jarvis-library-detail-content">
          {activeTab === "highlights" ? (
            /* Highlights List */
            highlights.length === 0 ? (
              <div className="jarvis-library-tab-empty">
                <p>本书暂无划线或笔记。在阅读器中选中文本即可添加。</p>
              </div>
            ) : (
              <div className="jarvis-library-highlights-list">
                {highlights.map((h: BookHighlight) => {
                  const hasComment = h.comment && h.comment.trim();
                  return (
                    <div key={h.id || h.blockId} className="jarvis-library-highlight-card">
                      <div className="hl-card-header">
                        <span className="hl-card-chapter">{h.chapterTitle || "正文章节"}</span>
                        <span className="hl-card-date">{formatDate(h.updated || h.created)}</span>
                      </div>
                      <div className="hl-card-body">
                        <blockquote className="hl-card-quote">
                          <p>{h.quote}</p>
                        </blockquote>
                        {hasComment && (
                          <div className="hl-card-comment-bubble">
                            <span className="comment-label">💡 我的笔记：</span>
                            <MarkdownText content={h.comment} plugin={plugin} />
                          </div>
                        )}
                      </div>
                      <div className="hl-card-actions">
                        <button className="hl-card-action-btn" onClick={() => {
                          navigator.clipboard.writeText(`《${title}》：「${h.quote}」${h.comment ? `（感想：${h.comment}）` : ""}`);
                          new Notice("高亮已复制到剪贴板");
                        }}>
                          复制内容
                        </button>
                        <button className="hl-card-action-btn action-jump" onClick={() => jumpToHighlight(activeBook, h)}>
                          跳转原文 →
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          ) : activeTab === "words" ? (
            /* Word Cards List */
            wordAssets.length === 0 ? (
              <div className="jarvis-library-tab-empty">
                <p>本书暂无关联的单词或翻译卡片。</p>
              </div>
            ) : (
              <div className="jarvis-library-word-cards-grid">
                {wordAssets.map((w: WordAsset) => {
                  return (
                    <WordCard 
                        key={w.lemma}
                        plugin={plugin}
                        asset={w}
                        onToggleMastery={(lemma, mastered) => {
                            if (plugin.settings.wordAssets[lemma]) {
                                plugin.settings.wordAssets[lemma].mastered = mastered;
                                plugin.saveSettings();
                                // We don't need a strict re-load here since React might trigger or we just let it update visually?
                                // Actually we should trigger an update. The toggleWordMastery from earlier does it.
                            }
                        }}
                        onDelete={(lemma) => {
                            // Only via context menu
                            if (plugin.activeReaderView && typeof plugin.activeReaderView.deleteWordAsset === "function") {
                                plugin.activeReaderView.deleteWordAsset(plugin.settings.wordAssets[lemma]).catch(console.error);
                            } else {
                                delete plugin.settings.wordAssets[lemma];
                                plugin.saveSettings();
                            }
                        }}
                    />
                  );
                })}
              </div>
            )
          ) : (
            /* Bookmarks List */
            bookmarks.length === 0 ? (
              <div className="jarvis-library-tab-empty">
                <p>本书暂无保存的书签。在阅读器中点击右侧悬浮栏的书签按钮即可添加。</p>
              </div>
            ) : (
              <div className="jarvis-library-bookmarks-list" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {[...bookmarks].sort((a,b) => b.created - a.created).map((b) => {
                  const dateStr = new Date(b.created).toLocaleString();
                  return (
                    <div key={b.created} className="jarvis-library-bookmark-card hl-card">
                      <div className="hl-card-content" style={{ paddingBottom: '12px' }}>
                        <div style={{ fontWeight: "bold", fontSize: "1.1em", marginBottom: "4px", color: "var(--text-normal)" }}>{b.title}</div>
                        <div style={{ fontSize: "0.85em", color: "var(--text-muted)" }}>{dateStr}</div>
                      </div>
                      <div className="hl-card-actions">
                        <button className="hl-card-action-btn" onClick={(e) => {
                          e.stopPropagation();
                          plugin.settings.bookBookmarks[activeBook.path] = plugin.settings.bookBookmarks[activeBook.path].filter((x: any) => x.created !== b.created);
                          plugin.saveSettings().then(() => {
                            window.dispatchEvent(new CustomEvent("jarvis-reader-bookmarks-updated"));
                          });
                        }}>
                          删除
                        </button>
                        <button className="hl-card-action-btn action-jump" onClick={() => {
                          // Jump to bookmark
                          let found = false;
                          plugin.app.workspace.iterateAllLeaves((leaf) => {
                            if (leaf.view.getViewType() === "epub" && (leaf.view as any).file?.path === activeBook.path) {
                                if (typeof (leaf.view as any).jumpToCfi === "function") {
                                    (leaf.view as any).jumpToCfi(b.cfi);
                                }
                                plugin.app.workspace.setActiveLeaf(leaf, { focus: true });
                                found = true;
                            }
                          });
                          if (!found) {
                            const leaf = plugin.app.workspace.getLeaf(true);
                            leaf.openFile(activeBook, { eState: { epubcifi: b.cfi } });
                            if (typeof plugin.openBookshelfPane === "function") {
                              plugin.openBookshelfPane(true);
                            }
                          }
                        }}>
                          跳转位置 →
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="jarvis-library-app">
      {currentView === "home" ? renderHome() : renderDetail()}
      {renderStatsModal()}
      {renderDebugModal()}
    </div>
  );
}
