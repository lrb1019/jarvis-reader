import type { BookHighlight, BookHighlightsMap } from "./types.ts";

export interface HighlightServiceHost {
  settings: { bookHighlights?: BookHighlightsMap };
  persistHighlightSidecar(reason?: string): Promise<void>;
  onHighlightsChanged?(): void;
}

export class HighlightService {
  private readonly host: HighlightServiceHost;

  constructor(host: HighlightServiceHost) {
    this.host = host;
  }

  async replaceBookHighlights(bookPath: string, highlights: BookHighlight[], reason: string): Promise<void> {
    const map = this.highlights();
    const hadPrevious = Object.prototype.hasOwnProperty.call(map, bookPath);
    const previous = map[bookPath];
    map[bookPath] = highlights;
    try {
      await this.host.persistHighlightSidecar(reason);
    } catch (error) {
      if (hadPrevious) map[bookPath] = previous;
      else delete map[bookPath];
      throw error;
    }
    this.host.onHighlightsChanged?.();
  }

  async replaceAll(highlights: BookHighlightsMap, reason: string): Promise<void> {
    const previous = this.highlights();
    this.host.settings.bookHighlights = { ...highlights };
    try {
      await this.host.persistHighlightSidecar(reason);
    } catch (error) {
      this.host.settings.bookHighlights = previous;
      throw error;
    }
    this.host.onHighlightsChanged?.();
  }

  private highlights(): BookHighlightsMap {
    if (!this.host.settings.bookHighlights || typeof this.host.settings.bookHighlights !== "object") {
      this.host.settings.bookHighlights = {};
    }
    return this.host.settings.bookHighlights;
  }
}
