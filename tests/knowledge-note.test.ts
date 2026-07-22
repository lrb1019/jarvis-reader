import assert from "node:assert/strict";
import test from "node:test";
import { buildKnowledgeNoteBody, buildKnowledgeNoteContent, buildKnowledgeNotePath } from "../src/knowledge-note.ts";

test("builds an independent note that links to the original book block", () => {
  const content = buildKnowledgeNoteContent({ title: "延迟回报", body: "我的判断", sourceNotePath: "阅读/原子习惯", sourceBlockId: "abc", sourceBookTitle: "原子习惯" }, "2026-07-11");
  assert.doesNotMatch(content, /^# 延迟回报$/m);
  assert.match(content, /\[\[阅读\/原子习惯#\^abc\]\]/);
  assert.match(content, /我的判断/);
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
