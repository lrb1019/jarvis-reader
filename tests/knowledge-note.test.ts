import assert from "node:assert/strict";
import test from "node:test";
import { buildKnowledgeNoteBody, buildKnowledgeNoteContent, buildKnowledgeNotePath, hasKnowledgeNoteSource, knowledgeNoteTimeLines } from "../src/knowledge-note.ts";

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

test("单条知识笔记不重复标题，笔记优先且保留原文、时间与来源", () => {
  const body = buildKnowledgeNoteBody("原文第一行\n原文第二行", [{ label: "笔记", created: "2026-10-03 10:00", text: "我的判断\n\n- 保留列表" }]);
  assert.ok(body.indexOf("## 笔记") < body.indexOf("## 原文"));
  assert.doesNotMatch(body, /^### 笔记$/m);
  assert.ok(body.includes("我的判断\n\n- 保留列表"));
  assert.ok(body.includes("2026-10-03 10:00"));
  assert.ok(body.includes("> 原文第一行\n> 原文第二行"));
  const content = buildKnowledgeNoteContent({ title: "判断", body, sourceBookTitle: "书名", sourceNotePath: "Reading Notes/书.md", sourceBlockId: "ar-template" }, "2026-10-03");
  assert.doesNotMatch(content, /^author:/m);
  assert.equal(hasKnowledgeNoteSource(content, "Reading Notes/改名.md", "ar-template"), true);
});

test("无时间不伪造时间，单条自定义标签与多条笔记仍保留", () => {
  const body = buildKnowledgeNoteBody("引用", [
    { label: "笔记", text: "第一条", created: "2026-10-03 10:00" },
    { label: "笔记 2", text: "第二条" },
    { label: "笔记 3", text: " " },
  ]);
  assert.match(body, /### 笔记\n\n第一条/);
  assert.match(body, /### 笔记 2\n\n第二条/);
  assert.doesNotMatch(body, /笔记 3/);
  assert.equal((body.match(/记录于/g) || []).length, 1);
  assert.match(buildKnowledgeNoteBody("", [{ label: "疑问", text: "为什么" }]), /### 疑问\n\n为什么/);
  assert.equal(buildKnowledgeNoteBody("", []), "");
});


test("source properties link actual vault files and retain identity after link updates", () => {
  const content = buildKnowledgeNoteContent({title: "判断", body: "内容", sourceBookTitle: "书名", sourceBookPath: 'books/书名.epub', sourceNotePath: "Reading Notes/书名.md", sourceBlockId: "stable-link"}, "2026-10-03");
  assert.ok(content.includes('source_book: "[[书名.epub]]"'));
  assert.ok(content.includes('source_note: "[[Reading Notes/书名]]"'));
  const moved = content.replaceAll("Reading Notes/书名", "Other/新名字").replaceAll("[[书名.epub]]", "[[新名字.epub]]");
  assert.equal(hasKnowledgeNoteSource(moved, "Other/新名字.md", "stable-link"), true);
  assert.equal(hasKnowledgeNoteSource(moved, "Other/新名字.md", "another-block"), false);
});


test("knowledge record styling is limited to generated notes outside fenced content", () => {
  const source = ['---','source_note: "[[Book]]"','source_block: stable','---','','## 笔记','','*记录于 2026-10-03 17:47:07*','','```md','*记录于 2026-10-03 17:48:07*','```','','## 原文','','*记录于 2026-10-03 17:49:07*'].join("\n");
  assert.deepEqual(knowledgeNoteTimeLines(source), [8]);
  assert.deepEqual(knowledgeNoteTimeLines(source.replace('source_block: stable', 'other: stable')), []);
  assert.deepEqual(knowledgeNoteTimeLines(source.replace('*记录于 2026-10-03 17:47:07*', '*记录于 自定义内容*')), []);
  assert.deepEqual(knowledgeNoteTimeLines('## 笔记\n*记录于 2026-10-03 17:47:07*'), []);
});
