// Extracted from main.js L49011-49176 — reading progress calculation

import type { BookProgress, ReaderPagePosition } from "./types";

export function normalizeEpubHref(href: string): string {
  return (href || "").split("#")[0].split("?")[0];
}

export function findChapterTitle(toc: any, href: string): string {
  const target = normalizeEpubHref(href);
  let best = "";
  const visit = (items: any[]) => {
    for (const item of items || []) {
      const itemHref = normalizeEpubHref(item.href);
      if (itemHref && target && (target === itemHref || target.endsWith(itemHref) || itemHref.endsWith(target))) {
        best = item.label || best;
      }
      if (item.subitems && item.subitems.length) {
        visit(item.subitems);
      }
    }
  };
  visit(toc);
  return best;
}

export function clampProgressValue(value: any): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return Math.min(1, Math.max(0, value));
}

export function getReaderDisplayedPage(relocated: any): ReaderPagePosition | null {
  if (!relocated || !relocated.start) {
    return null;
  }
  const displayed = relocated.start.displayed;
  if (!displayed || !displayed.total) {
    return null;
  }
  return {
    page: displayed.page || 1,
    total: displayed.total,
  };
}

export function getPageListProgress(relocated: any, rendition: any): any {
  const cfi = relocated && relocated.start ? relocated.start.cfi : "";
  const pageList = rendition && rendition.book ? rendition.book.pageList : null;
  if (!cfi || !pageList || typeof pageList.pageFromCfi !== "function") {
    return null;
  }
  const page = pageList.pageFromCfi(cfi);
  if (typeof page !== "number" || !Number.isFinite(page) || page <= 0) {
    return null;
  }
  const lastPage = typeof pageList.lastPage === "number" && pageList.lastPage > 0 ? pageList.lastPage : null;
  const percentage = typeof pageList.percentageFromCfi === "function" ? clampProgressValue(pageList.percentageFromCfi(cfi)) : null;
  return {
    page,
    total: lastPage,
    percentage,
  };
}

export function getLocationsPercentage(relocated: any, rendition: any): number | null {
  const cfi = relocated && relocated.start ? relocated.start.cfi : "";
  const locations = rendition && rendition.book ? rendition.book.locations : null;
  if (!cfi || !locations || typeof locations.percentageFromCfi !== "function") {
    return null;
  }
  const hasLocations = Array.isArray(locations._locations) && locations._locations.length > 0 || typeof locations.total === "number" && locations.total > 0;
  if (!hasLocations) {
    return null;
  }
  return clampProgressValue(locations.percentageFromCfi(cfi));
}

export function getSpineFallbackPercentage(relocated: any, rendition: any, displayedPage: ReaderPagePosition | null): number | null {
  if (!relocated || !relocated.start || typeof relocated.start.index !== "number") {
    return null;
  }
  const spineItems = rendition && rendition.book && rendition.book.spine && rendition.book.spine.items;
  const totalSections = Array.isArray(spineItems) && spineItems.length ? spineItems.length : 0;
  if (totalSections <= 0) {
    return null;
  }
  const page = displayedPage || { page: 1, total: 1 };
  const inSection = Math.min(1, Math.max(0, (page.page - 1) / Math.max(1, page.total)));
  return clampProgressValue((relocated.start.index + inSection) / totalSections);
}

export function formatReaderProgressLabel(progress: any): string {
  if (!progress) {
    return "";
  }
  const percentage = Math.round((progress.percentage || 0) * 100);
  const percentageText = `\u5168\u4e66 ${percentage}%`;
  if (progress.bookPage && progress.bookPage.page) {
    return progress.bookPage.total ? `\u9875 ${progress.bookPage.page} / ${progress.bookPage.total} ${percentageText}` : `\u9875 ${progress.bookPage.page} ${percentageText}`;
  }
  if (progress.chapterPage && progress.chapterPage.total) {
    return `\u672c\u7ae0 ${progress.chapterPage.page} / ${progress.chapterPage.total} ${percentageText}`;
  }
  return percentageText;
}

export function getReaderProgressLabel(relocated: any, rendition: any = null): string {
  const progress = getReaderProgress(relocated, rendition);
  return progress ? progress.label : "";
}

export function ensureReaderLocations(rendition: any, onReady?: (current: any) => void): void {
  const locations = rendition && rendition.book ? rendition.book.locations : null;
  if (!rendition || !locations || typeof locations.generate !== "function") {
    return;
  }
  const hasLocations = Array.isArray(locations._locations) && locations._locations.length > 0 || typeof locations.total === "number" && locations.total > 0;
  if (hasLocations || rendition.__jarvisReaderLocationsLoading) {
    return;
  }
  rendition.__jarvisReaderLocationsLoading = true;
  Promise.resolve(rendition.book.ready).then(() => locations.generate(1600)).then(() => {
    if (typeof rendition.currentLocation === "function" && typeof onReady === "function") {
      const current = rendition.currentLocation();
      if (current) {
        onReady(current);
      }
    }
  }).catch(() => {
  }).finally(() => {
    rendition.__jarvisReaderLocationsLoading = false;
  });
}

export function getReaderProgress(relocated: any, rendition: any): (BookProgress & { label: string }) | null {
  if (!relocated || !relocated.start) {
    return null;
  }
  const chapterPage = getReaderDisplayedPage(relocated);
  const bookPage = getPageListProgress(relocated, rendition);
  let percentage = bookPage && bookPage.percentage != null ? bookPage.percentage : null;
  if (percentage == null) {
    percentage = getLocationsPercentage(relocated, rendition);
  }
  if (percentage == null) {
    percentage = clampProgressValue(relocated.start.percentage);
  }
  if (percentage == null || percentage <= 0) {
    percentage = getSpineFallbackPercentage(relocated, rendition, chapterPage);
  }
  if (percentage == null) {
    percentage = 0;
  }
  const progress: any = {
    percentage,
    href: relocated.start.href || "",
    updated: new Date().toISOString(),
    page: chapterPage ? chapterPage.page : null,
    total: chapterPage ? chapterPage.total : null,
    chapterPage,
    bookPage: bookPage ? {
      page: bookPage.page,
      total: bookPage.total,
    } : null,
  };
  progress.label = formatReaderProgressLabel(progress);
  return {
    ...progress,
  };
}

export function getBookshelfProgressLabel(progress: BookProgress | null): string {
  if (!progress) {
    return "0%";
  }
  const percentage = Math.round((progress.percentage || 0) * 100);
  const chapterTitle = (progress.chapterTitle || "").trim();
  return chapterTitle ? `${chapterTitle} ${percentage}%` : `${percentage}%`;
}
