import assert from "node:assert/strict";
import test from "node:test";
import {
  appendReflectionDocument,
  deleteHighlightDocument,
  insertHighlightDocument,
  readHighlightDetailsDocument,
  replaceHighlightDocument,
} from "../src/book-note-document.ts";
import type { BookHighlight } from "../src/types.ts";

function makeHighlight(overrides: Partial<BookHighlight> = {}): BookHighlight {
  return {
    id: "h-1",
    blockId: "h-1",
    bookPath: "books/a.epub",
    bookTitle: "A",
    chapterTitle: "第一章",
    cfiRange: "epubcfi(1)",
    quote: "原文第一行\n原文第二行",
    comment: "第一条笔记",
    notePath: "notes/A.md",
    created: "2026-07-20T10:00:00+08:00",
    updated: "2026-07-20T11:00:00+08:00",
    ...overrides,
  };
}

test("inserts a highlight into its matching chapter without disturbing later chapters", () => {
  const source = "# A\n\n## 第一章\n\n手写内容\n\n## 第二章\n\n保留内容\n";
  const result = insertHighlightDocument(source, makeHighlight());
  assert.match(result, /手写内容[\s\S]*原文第一行[\s\S]*\^h-1[\s\S]*## 第二章/);
  assert.match(result, /保留内容/);
});

test("appends multiple reflections while preserving quote and existing notes", () => {
  const first = insertHighlightDocument("# A\n", makeHighlight());
  const second = appendReflectionDocument(first, makeHighlight(), "第二条笔记");
  const details = readHighlightDetailsDocument(second, makeHighlight({ quote: "", comment: "" }));
  assert.equal(details.quote, "原文第一行\n原文第二行");
  assert.deepEqual(details.commentEntries.map((entry) => entry.text), ["第一条笔记", "第二条笔记"]);
  assert.match(second, /> \*\*笔记 2\*\*/);
});

test("replaces only the selected block and leaves surrounding manual Markdown untouched", () => {
  const first = insertHighlightDocument("# A\n\n人工前言\n", makeHighlight());
  const withManualText = `${first}\n人工尾注\n`;
  const result = replaceHighlightDocument(withManualText, makeHighlight({ quote: "更新原文", comment: "更新笔记" }));
  assert.match(result, /人工前言/);
  assert.match(result, /人工尾注/);
  assert.match(result, /更新原文/);
  assert.match(result, /更新笔记/);
  assert.doesNotMatch(result, /原文第一行/);
});

test("deletes only the selected highlight block", () => {
  const first = insertHighlightDocument("# A\n", makeHighlight());
  const secondHighlight = makeHighlight({ id: "h-2", blockId: "h-2", quote: "另一段原文", comment: "另一条笔记" });
  const second = insertHighlightDocument(first, secondHighlight);
  const result = deleteHighlightDocument(second, "h-2");
  assert.match(result, /\^h-1/);
  assert.match(result, /原文第一行/);
  assert.doesNotMatch(result, /\^h-2/);
  assert.doesNotMatch(result, /另一段原文/);
});

test("missing or malformed block ids never delete unrelated Markdown", () => {
  const source = "# A\n\n普通正文\n^orphan\n";
  assert.equal(deleteHighlightDocument(source, "missing"), source);
  assert.equal(deleteHighlightDocument(source, "orphan"), source);
});

test("reads every note and relation from persisted Markdown", () => {
  const source = `${insertHighlightDocument("# A\n", makeHighlight())}\n`;
  const withSecond = appendReflectionDocument(source, makeHighlight(), "第二条笔记");
  const enriched = withSecond.replace(
    "> **时间**",
    ">\n> ### 关联文章\n> [[知识/复利]] | 2026-07-20 12:00:00\n>\n> **时间**",
  );
  const details = readHighlightDetailsDocument(enriched, makeHighlight({ quote: "", comment: "" }));
  assert.equal(details.commentEntries.length, 2);
  assert.deepEqual(details.aiSections[0]?.links, ["知识/复利|2026-07-20 12:00:00"]);
});

test("hydrates quote and notes from Markdown when the index contains no content fields", () => {
  const source = insertHighlightDocument("# A\n", makeHighlight());
  const details = readHighlightDetailsDocument(source, { blockId: "h-1" });
  assert.equal(details.quote, "原文第一行\n原文第二行");
  assert.deepEqual(details.commentEntries.map((entry) => entry.text), ["第一条笔记"]);
});

test("ignores multiline chapter titles leaked outside a newly written callout", () => {
  const source = `## 无处不在的系统

> [!note]${" "}
          无处不在的系统
${"        "}
> “是你的手。你把手拿开了。”大家回答
>
> **笔记**
> created: 2026-07-25 09:40:08
>
> 测试笔记
> **时间**
> 2026-07-25 09:40:08
^ar-current
`;
  const details = readHighlightDetailsDocument(source, { blockId: "ar-current" });
  assert.equal(details.quote, "“是你的手。你把手拿开了。”大家回答");
  assert.deepEqual(details.commentEntries.map((entry) => entry.text), ["测试笔记"]);
});
