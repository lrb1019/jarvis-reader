import assert from "node:assert/strict";
import test from "node:test";
import { buildKnowledgeNoteContent, buildKnowledgeNotePath } from "../src/knowledge-note.ts";

test("builds an independent note that links to the original book block", () => {
  const content = buildKnowledgeNoteContent({ title: "延迟回报", body: "我的判断", sourceNotePath: "阅读/原子习惯", sourceBlockId: "abc", sourceBookTitle: "原子习惯" }, "2026-07-11");
  assert.match(content, /# 延迟回报/);
  assert.match(content, /\[\[阅读\/原子习惯#\^abc\]\]/);
  assert.match(content, /我的判断/);
});

test("builds a vault-relative Markdown path", () => {
  assert.equal(buildKnowledgeNotePath("知识库/想法", "延迟:回报"), "知识库/想法/延迟-回报.md");
});
