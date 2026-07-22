import type { BookBookmark, JarvisReaderSettings } from "./types.ts";

export interface BookStateHost {
  settings: Pick<JarvisReaderSettings, "bookBookmarks" | "bookInitLocations" | "bookProgress">;
  saveSettings(): Promise<void>;
}

export class BookStateService {
  private readonly host: BookStateHost;

  constructor(host: BookStateHost) {
    this.host = host;
  }

  async addBookmark(bookPath: string, bookmark: BookBookmark): Promise<boolean> {
    const current = this.host.settings.bookBookmarks?.[bookPath] || [];
    if (current.some((item) => item.cfi === bookmark.cfi)) return false;
    await this.commitBookmarks(bookPath, [...current, bookmark]);
    return true;
  }

  async removeBookmark(bookPath: string, bookmark: Pick<BookBookmark, "cfi" | "created">): Promise<boolean> {
    const current = this.host.settings.bookBookmarks?.[bookPath] || [];
    const next = current.filter((item) => !(item.cfi === bookmark.cfi && item.created === bookmark.created));
    if (next.length === current.length) return false;
    await this.commitBookmarks(bookPath, next);
    return true;
  }

  async clearRuntimeState(bookPath: string): Promise<void> {
    const previousBookmarks = this.host.settings.bookBookmarks;
    const previousLocations = this.host.settings.bookInitLocations;
    const previousProgress = this.host.settings.bookProgress;
    const nextBookmarks = { ...previousBookmarks };
    const nextLocations = { ...previousLocations };
    const nextProgress = { ...previousProgress };
    delete nextBookmarks[bookPath];
    delete nextLocations[bookPath];
    delete nextProgress[bookPath];
    this.host.settings.bookBookmarks = nextBookmarks;
    this.host.settings.bookInitLocations = nextLocations;
    this.host.settings.bookProgress = nextProgress;
    try {
      await this.host.saveSettings();
    } catch (error) {
      this.host.settings.bookBookmarks = previousBookmarks;
      this.host.settings.bookInitLocations = previousLocations;
      this.host.settings.bookProgress = previousProgress;
      throw error;
    }
  }

  private async commitBookmarks(bookPath: string, next: BookBookmark[]): Promise<void> {
    const previous = this.host.settings.bookBookmarks;
    const nextMap = { ...previous };
    if (next.length) nextMap[bookPath] = next;
    else delete nextMap[bookPath];
    this.host.settings.bookBookmarks = nextMap;
    try {
      await this.host.saveSettings();
    } catch (error) {
      this.host.settings.bookBookmarks = previous;
      throw error;
    }
  }
}
