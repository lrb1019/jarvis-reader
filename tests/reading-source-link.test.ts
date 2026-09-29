import assert from "node:assert/strict";
import test from "node:test";

import { buildReadingSourceLink, parseReadingSourceTarget } from "../src/reading-source-link.ts";

test("builds and parses an encoded EPUB source link", () => {
  const link = buildReadingSourceLink({ bookPath: "Books/中文 (新版).epub", id: "h 1", blockId: "h 1", cfiRange: "epubcfi(/6/2[part]!/4/1:0)" });
  assert.match(link, /^obsidian:\/\/jarvis-reader\?/);
  assert.match(link, /%20/);
  const parameters = Object.fromEntries(new URL(link).searchParams);
  assert.deepEqual(parseReadingSourceTarget(parameters), {
    bookPath: "Books/中文 (新版).epub", highlightId: "h 1", cfiRange: "epubcfi(/6/2[part]!/4/1:0)",
  });
});

test("rejects incomplete, unsupported, and unsafe source links", () => {
  assert.equal(parseReadingSourceTarget({ v: "2", book: "a.epub", highlight: "h", cfi: "cfi" }), null);
  assert.equal(parseReadingSourceTarget({ v: "1", book: "../a.epub", highlight: "h", cfi: "cfi" }), null);
  assert.equal(parseReadingSourceTarget({ v: "1", book: "a.pdf", highlight: "h", cfi: "cfi" }), null);
  assert.deepEqual(parseReadingSourceTarget({ v: "1", book: "Books+with+spaces.epub", highlight: "h", cfi: "cfi" }), {
    bookPath: "Books with spaces.epub", highlightId: "h", cfiRange: "cfi",
  });
  assert.equal(buildReadingSourceLink({ bookPath: "a.epub", id: "h", blockId: "h", cfiRange: "" }), "");
});
