import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_BOOK_NOTE_TEMPLATE, renderBookNoteTemplate } from "../src/book-note-template.ts";
import { insertHighlightDocument, readHighlightDetailsDocument } from "../src/book-note-document.ts";
import type { BookHighlight } from "../src/types.ts";

const file = { basename: "示例书", extension: "epub" };

test("默认及空模板保留书籍统计属性，不预铺空章节", () => {
  for (const template of [DEFAULT_BOOK_NOTE_TEMPLATE, "", "  "]) {
    const content = renderBookNoteTemplate(template, file, "# 空章节", "2026-10-03 10:00:00");
    assert.match(content, /bookname: "\[\[示例书.epub\]\]"/);
    for (const field of ["status", "rating", "tags", "start_date", "finish_date", "created"]) assert.match(content, new RegExp(`^${field}:`, "m"));
    assert.doesNotMatch(content, /^#/m);
  }
});

test("用户初始模板和目录占位符继续生效，输入模板不被改写", () => {
  const template = "# {{title}}\n{{bookname}} / {{extension}}\n{{created}}\n{{toc}}\n我的总结";
  assert.equal(renderBookNoteTemplate(template, file, "## 第一章", "2026-10-03"), "# 示例书\n示例书.epub / epub\n2026-10-03\n## 第一章\n我的总结");
  assert.ok(template.includes("{{toc}}"));
});

test("无预铺目录的新笔记仍可插入并解析原文、笔记和稳定块ID", () => {
  const highlight = { id: "ar-template", blockId: "ar-template", bookPath: "books/示例书.epub", bookTitle: "示例书", chapterTitle: "第一章", quote: "摘录内容", comment: "我的判断", created: "2026-10-03T02:00:00Z", updated: "2026-10-03T02:00:00Z", cfiRange: "epubcfi(/6/2!/4/2/1:0)" } as BookHighlight;
  const content = insertHighlightDocument(renderBookNoteTemplate("", file, "# 无摘录章节", "2026-10-03"), highlight);
  assert.match(content, /^## 第一章$/m);
  assert.match(content, /^\^ar-template$/m);
  assert.doesNotMatch(content, /无摘录章节/);
  const details = readHighlightDetailsDocument(content, highlight);
  assert.equal(details.quote, "摘录内容");
  assert.equal(details.commentEntries[0].text, "我的判断");
});
