import type { BookProgress, ReaderPagePosition } from "../domain/index.ts";

export interface EpubTocItem {
  label: string;
  href: string;
  subitems?: EpubTocItem[];
}

export interface RelocatedLocation {
  start?: {
    cfi?: string;
    href?: string;
    index?: number;
    percentage?: number;
    displayed?: { page?: number; total?: number };
  };
}

export interface ProgressRenditionLike {
  book?: {
    pageList?: {
      pageFromCfi?(cfi: string): number;
      percentageFromCfi?(cfi: string): number;
      lastPage?: number;
    };
    locations?: {
      percentageFromCfi?(cfi: string): number;
      _locations?: unknown[];
      total?: number;
    };
    spine?: { items?: unknown[] };
  };
}

export interface ReaderMode {
  scrolled: boolean;
  singlePage: boolean;
}

export interface ReaderOptions {
  allowPopups: false;
  flow?: "scrolled";
  manager?: "continuous";
  spread?: "none";
}

export function getEpubTocMarkdown(rawToc?: EpubTocItem[] | null): string {
  const output: string[] = [];
  const visit = (item: EpubTocItem | undefined, depth: number): void => {
    if (!item) return;
    const label = String(item.label || "").replace(/\u0000/g, "").trim();
    output.push(`${"#".repeat(depth)} ${label}`);
    for (const child of item.subitems || []) visit(child, depth + 1);
  };
  for (const item of rawToc || []) visit(item, 1);
  return output.join("\n\n");
}

export function normalizeEpubHref(href?: string | null): string {
  return (href || "").split("#")[0]?.split("?")[0] || "";
}

export function findChapterTitle(toc: EpubTocItem[], href?: string): string {
  const target = normalizeEpubHref(href);
  let best = "";
  const visit = (items: EpubTocItem[]): void => {
    for (const item of items) {
      const itemHref = normalizeEpubHref(item.href);
      if (
        itemHref &&
        target &&
        (target === itemHref || target.endsWith(itemHref) || itemHref.endsWith(target))
      ) {
        best = item.label || best;
      }
      visit(item.subitems || []);
    }
  };
  visit(toc);
  return best;
}

export function clampReaderZoom(value: unknown): number {
  const parsed = Number.parseFloat(String(value));
  const zoom = Number.isFinite(parsed) ? parsed : 1;
  return Math.min(2, Math.max(0.6, Math.round(zoom * 20) / 20));
}

export function clampReaderLineHeight(value: unknown): number {
  const parsed = Number.parseFloat(String(value));
  const lineHeight = Number.isFinite(parsed) ? parsed : 1.6;
  return Math.min(2.4, Math.max(1.1, Math.round(lineHeight * 20) / 20));
}

export function normalizeReaderMode(mode: ReaderMode): ReaderMode {
  return mode.singlePage
    ? { singlePage: true, scrolled: mode.scrolled }
    : { singlePage: false, scrolled: false };
}

export function getReaderOptions(mode: ReaderMode): ReaderOptions {
  const normalized = normalizeReaderMode(mode);
  if (normalized.scrolled) {
    return { allowPopups: false, flow: "scrolled", manager: "continuous" };
  }
  return normalized.singlePage
    ? { allowPopups: false, spread: "none" }
    : { allowPopups: false };
}

function clampProgressValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : null;
}

function getDisplayedPage(relocated: RelocatedLocation): ReaderPagePosition | null {
  const displayed = relocated.start?.displayed;
  if (!displayed?.total) return null;
  return { page: displayed.page || 1, total: displayed.total };
}

function getPageListProgress(
  relocated: RelocatedLocation,
  rendition?: ProgressRenditionLike | null,
): (ReaderPagePosition & { percentage: number | null }) | null {
  const cfi = relocated.start?.cfi || "";
  const pageList = rendition?.book?.pageList;
  if (!cfi || !pageList?.pageFromCfi) return null;
  const page = pageList.pageFromCfi(cfi);
  if (!Number.isFinite(page) || page <= 0) return null;
  const total =
    typeof pageList.lastPage === "number" && pageList.lastPage > 0
      ? pageList.lastPage
      : 0;
  const percentage = pageList.percentageFromCfi
    ? clampProgressValue(pageList.percentageFromCfi(cfi))
    : null;
  return { page, total, percentage };
}

function getLocationsPercentage(
  relocated: RelocatedLocation,
  rendition?: ProgressRenditionLike | null,
): number | null {
  const cfi = relocated.start?.cfi || "";
  const locations = rendition?.book?.locations;
  if (!cfi || !locations?.percentageFromCfi) return null;
  const hasLocations =
    (Array.isArray(locations._locations) && locations._locations.length > 0) ||
    (typeof locations.total === "number" && locations.total > 0);
  return hasLocations ? clampProgressValue(locations.percentageFromCfi(cfi)) : null;
}

function getSpineFallbackPercentage(
  relocated: RelocatedLocation,
  rendition: ProgressRenditionLike | null | undefined,
  displayedPage: ReaderPagePosition | null,
): number | null {
  if (typeof relocated.start?.index !== "number") return null;
  const items = rendition?.book?.spine?.items;
  const totalSections = Array.isArray(items) ? items.length : 0;
  if (totalSections <= 0) return null;
  const page = displayedPage || { page: 1, total: 1 };
  const inSection = Math.min(
    1,
    Math.max(0, (page.page - 1) / Math.max(1, page.total)),
  );
  return clampProgressValue((relocated.start.index + inSection) / totalSections);
}

export function formatReaderProgressLabel(
  progress?: Pick<BookProgress, "percentage" | "bookPage" | "chapterPage"> | null,
): string {
  if (!progress) return "";
  const percentageText = `全书 ${Math.round((progress.percentage || 0) * 100)}%`;
  if (progress.bookPage?.page) {
    return progress.bookPage.total
      ? `页 ${progress.bookPage.page} / ${progress.bookPage.total} ${percentageText}`
      : `页 ${progress.bookPage.page} ${percentageText}`;
  }
  if (progress.chapterPage?.total) {
    return `本章 ${progress.chapterPage.page} / ${progress.chapterPage.total} ${percentageText}`;
  }
  return percentageText;
}

export function getReaderProgress(
  relocated: RelocatedLocation,
  rendition?: ProgressRenditionLike | null,
  chapterTitle = "",
  now: () => string = () => new Date().toISOString(),
): BookProgress | null {
  if (!relocated.start) return null;
  const chapterPage = getDisplayedPage(relocated);
  const pageList = getPageListProgress(relocated, rendition);
  let percentage = pageList?.percentage ?? null;
  if (percentage === null) percentage = getLocationsPercentage(relocated, rendition);
  if (percentage === null) percentage = clampProgressValue(relocated.start.percentage);
  if (percentage === null || percentage <= 0) {
    percentage = getSpineFallbackPercentage(relocated, rendition, chapterPage);
  }
  percentage ??= 0;

  const progress: BookProgress = {
    percentage,
    href: relocated.start.href || "",
    updated: now(),
    page: chapterPage?.page ?? null,
    total: chapterPage?.total ?? null,
    chapterPage,
    bookPage: pageList ? { page: pageList.page, total: pageList.total } : null,
    label: "",
    chapterTitle,
  };
  progress.label = formatReaderProgressLabel(progress);
  return progress;
}
