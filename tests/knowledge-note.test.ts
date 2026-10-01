import assert from "node:assert/strict";
import test from "node:test";
import { buildKnowledgeNoteBody, buildKnowledgeNoteContent, buildKnowledgeNotePath, hasKnowledgeNoteSource } from "../src/knowledge-note.ts";

test("builds an independent note that links to the original book block", () => {
  const content = buildKnowledgeNoteContent({ title: "延迟回报", body: "我的判断", sourceNotePath: "阅读/原子习惯", sourceBlockId: "abc", sourceBookTitle: "原子习惯" }, "2026-07-11");
  assert.doesNotMatch(content, /^# 延迟回报$/m);
  assert.match(content, /\[\[阅读\/原子习惯#\^abc\|返回读书笔记\]\]/);
  assert.match(content, /我的判断/);
});

test("keeps the source block link and adds a direct EPUB link when available", () => {
  const location = "obsidian://jarvis-reader?v=1&book=books%2Ftest.epub&highlight=abc&cfi=epubcfi(%2F6%2F2)";
  const content = buildKnowledgeNoteContent({
    title: "延迟回报", body: "我的判断", sourceNotePath: "阅读/原子习惯",
    sourceBlockId: "abc", sourceBookTitle: "原子习惯", sourceLocationLink: location,
  }, "2026-07-11");
  assert.match(content, /## 来源\n\n\[\[阅读\/原子习惯#\^abc\|返回读书笔记\]\]\n\n\[返回原文\]/);
  assert.ok(content.includes(`[返回原文](${location})`));
});

test("recognizes both named and existing source block links without matching other blocks", () => {
  assert.ok(hasKnowledgeNoteSource("## 来源\n\n[[阅读/原子习惯#^abc|返回读书笔记]]", "阅读/原子习惯", "abc"));
  assert.ok(hasKnowledgeNoteSource("## 来源\r\n\r\n[[阅读/原子习惯#^abc]]", "阅读/原子习惯", "abc"));
  assert.equal(hasKnowledgeNoteSource("## 来源\n\n[[阅读/原子习惯#^other|返回读书笔记]]", "阅读/原子习惯", "abc"), false);
});

test("builds a knowledge note body with the quote and every reflection", () => {
  const body = buildKnowledgeNoteBody("原文第一行\n原文第二行", [
    { label: "笔记", created: "2026-07-10 10:00", text: "第一条判断" },
    { label: "笔记 2", created: "2026-07-11 11:00", text: "第二条判断" },
  ]);

  assert.match(body, /## 原文\n\n> 原文第一行\n> 原文第二行/);
  assert.match(body, /### 笔记[\s\S]*第一条判断/);
  assert.match(body, /### 笔记 2[\s\S]*第二条判断/);
});

test("builds a vault-relative Markdown path", () => {
  assert.equal(buildKnowledgeNotePath("知识库/想法", "延迟:回报"), "知识库/想法/延迟-回报.md");
});

test("a moved source note reopens its existing knowledge note by stable source block identity", () => {
  const content = buildKnowledgeNoteContent({ title: "Idea", body: "user idea", sourceNotePath: "Old/A.md", sourceBlockId: "ar-stable-123", sourceBookTitle: "Book" }, "2026-10-01");
  assert.equal(hasKnowledgeNoteSource(content, "Reading Notes/Renamed.md", "ar-stable-123"), true);
  assert.equal(hasKnowledgeNoteSource(content, "Reading Notes/Renamed.md", "other"), false);
  assert.equal(hasKnowledgeNoteSource(content, "Reading Notes/Renamed.md", ""), false);
});
