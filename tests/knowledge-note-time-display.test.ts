import test from "node:test";
import assert from "node:assert/strict";
import { knowledgeNoteTimeLines } from "../src/knowledge-note.ts";
import { styleKnowledgeNoteTimes } from "../src/knowledge-note-time-display.ts";

const source = ["---", "source_note: stable", "source_block: stable", "---", "", "## 笔记", "", "*记录于 2026-10-03 17:47:07*", "", "### 笔记 2", "", "*记录于 2026-10-03 17:48:07*", "", "```md", "*记录于 2026-10-03 17:49:07*", "```", "", "## 原文", "", "*记录于 2026-10-03 17:50:07*"].join("\n");

function paragraph(tag = "EM", children = 1) {
  const classes = new Set<string>();
  const node = {
    firstElementChild: { tagName: tag }, childNodes: Array(children),
    classList: { toggle: (name: string, on: boolean) => on ? classes.add(name) : classes.delete(name) },
    matches: (selector: string) => selector === "p", querySelectorAll: () => [],
  } as unknown as HTMLParagraphElement;
  return { node, classes };
}

test("reading mode and live preview identify the same generated time lines", () => {
  const expected = knowledgeNoteTimeLines(source);
  assert.deepEqual(expected, [8, 12]);
  const paragraphs = source.split("\n").map(() => paragraph());
  const root = { matches: () => false, querySelectorAll: () => paragraphs.map(p => p.node) } as unknown as HTMLElement;
  styleKnowledgeNoteTimes(root, p => { const lineStart = paragraphs.findIndex(item => item.node === p); return { text: source, lineStart, lineEnd: lineStart }; });
  assert.deepEqual(paragraphs.flatMap((p, index) => p.classes.size ? [index + 1] : []), expected);
  assert.deepEqual(knowledgeNoteTimeLines(source.replaceAll("\n", "\r\n")), expected);
});

test("paragraph chunks require source identity and a standalone rendered time", () => {
  const p = paragraph();
  styleKnowledgeNoteTimes(p.node, () => ({ text: source, lineStart: 7, lineEnd: 7 }));
  assert.equal(p.classes.size, 1);
  styleKnowledgeNoteTimes(p.node, () => ({ text: source, lineStart: 19, lineEnd: 19 }));
  assert.equal(p.classes.size, 0);
  for (const section of [null, { text: source, lineStart: 7, lineEnd: 8 }, { text: source.replace("source_block: stable", "other: stable"), lineStart: 7, lineEnd: 7 }]) {
    const candidate = paragraph();
    styleKnowledgeNoteTimes(candidate.node, () => section);
    assert.equal(candidate.classes.size, 0);
  }
  for (const candidate of [paragraph("CODE"), paragraph("EM", 2)]) {
    styleKnowledgeNoteTimes(candidate.node, () => { throw Error("must not inspect non-time paragraph"); });
    assert.equal(candidate.classes.size, 0);
  }
});
