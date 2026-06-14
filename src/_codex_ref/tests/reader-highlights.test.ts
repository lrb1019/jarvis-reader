import assert from "node:assert/strict";
import test from "node:test";
import type { BookHighlight } from "../src/domain/index.ts";
import {
  removeRenderedHighlight,
  renderHighlight,
  type HighlightRenditionLike,
} from "../src/reader/highlights.ts";

function createHighlight(markColor: BookHighlight["markColor"] = "green"): BookHighlight {
  return {
    id: "ar-test",
    bookPath: "Book.epub",
    bookTitle: "Book",
    chapterTitle: "Chapter",
    cfiRange: "epubcfi(1)",
    quote: "Quote",
    comment: "",
    markColor,
    notePath: "Book.md",
    blockId: "ar-test",
    created: "2026-06-12T00:00:00.000Z",
  };
}

test("renders EPUB annotations with a single DOM-safe color class", () => {
  const calls: Array<{ className: string; styles: Record<string, string> }> = [];
  const rendition: HighlightRenditionLike = {
    display: () => undefined,
    annotations: {
      highlight: (_cfi, _data, _callback, className, styles) => {
        if (/\s/.test(className)) throw new Error("InvalidCharacterError");
        calls.push({ className, styles });
      },
      remove: () => undefined,
    },
  };

  renderHighlight(rendition, createHighlight("green"), () => undefined);

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.className, "jarvis-reader-highlight-green");
  assert.equal(calls[0]?.styles.fill, "#86efac");
});

test("removing a rendered annotation allows the same highlight to render again", () => {
  let renderCount = 0;
  const rendition: HighlightRenditionLike = {
    display: () => undefined,
    annotations: {
      highlight: () => {
        renderCount += 1;
      },
      remove: () => undefined,
    },
  };
  const highlight = createHighlight();
  renderHighlight(rendition, highlight, () => undefined);
  renderHighlight(rendition, highlight, () => undefined);
  assert.equal(renderCount, 1);
  removeRenderedHighlight(rendition, highlight);
  renderHighlight(rendition, highlight, () => undefined);
  assert.equal(renderCount, 2);
});
