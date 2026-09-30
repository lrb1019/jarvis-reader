import assert from "node:assert/strict";
import test from "node:test";
import { applyReaderParagraphIndent, syncReaderParagraphIndent } from "../src/reader-paragraphs.ts";

function fixture(indent = "", priority = "", excluded = false) {
  const attributes = new Map<string, string>();
  const properties = new Map<string, { value: string; priority: string }>();
  if (indent) { attributes.set("style", "original"); properties.set("text-indent", { value: indent, priority }); }
  const style = {
    get length() { return properties.size; },
    getPropertyValue: (key: string) => properties.get(key)?.value || "",
    getPropertyPriority: (key: string) => properties.get(key)?.priority || "",
    setProperty: (key: string, value: string, priority = "") => { properties.set(key, { value, priority }); attributes.set("style", "present"); },
    removeProperty: (key: string) => { const value = properties.get(key)?.value || ""; properties.delete(key); return value; },
  };
  const paragraph = {
    localName: "p", textContent: "正文", parentElement: null, style,
    closest: () => excluded ? {} : null,
    querySelector: () => null,
    getAttribute: (key: string) => attributes.get(key) ?? null,
    hasAttribute: (key: string) => attributes.has(key),
    setAttribute: (key: string, value: string) => { attributes.set(key, value); },
    removeAttribute: (key: string) => { attributes.delete(key); },
    ownerDocument: {} as Document,
  };
  const doc = {
    defaultView: { getComputedStyle: () => ({ textAlign: "left" }) },
    querySelectorAll: (selector: string) => selector === "p" || attributes.has("data-jarvis-reader-paragraph") ? [paragraph] : [],
  } as unknown as Document;
  paragraph.ownerDocument = doc;
  return { doc, paragraph, style };
}

for (const priority of ["", "important"]) {
  test(`反复切换缩进恢复原行内值及优先级（${priority || "普通"}）`, () => {
    const { doc, style } = fixture("3em", priority);
    style.setProperty("margin-left", "12px");
    for (let i = 0; i < 3; i++) {
      applyReaderParagraphIndent(doc, "two-chars");
      assert.equal(style.getPropertyValue("text-indent"), "2em");
      assert.equal(style.getPropertyPriority("text-indent"), "important");
      applyReaderParagraphIndent(doc, "none");
      assert.equal(style.getPropertyValue("text-indent"), "0");
      applyReaderParagraphIndent(doc, "original");
      assert.equal(style.getPropertyValue("text-indent"), "3em");
      assert.equal(style.getPropertyPriority("text-indent"), priority);
      assert.equal(style.getPropertyValue("margin-left"), "12px");
    }
  });
}

test("遵循原书移除新增行内缩进，使原书样式表重新生效", () => {
  const { doc, paragraph, style } = fixture();
  applyReaderParagraphIndent(doc, "two-chars");
  applyReaderParagraphIndent(doc, "original");
  assert.equal(style.getPropertyValue("text-indent"), "");
  assert.equal(paragraph.hasAttribute("style"), false);
  assert.equal(paragraph.hasAttribute("data-jarvis-reader-paragraph"), false);
});

test("特殊上下文的段落不被覆盖或记录为正文", () => {
  const { doc, paragraph, style } = fixture("3em", "important", true);
  applyReaderParagraphIndent(doc, "two-chars");
  assert.equal(style.getPropertyValue("text-indent"), "3em");
  assert.equal(paragraph.hasAttribute("data-jarvis-reader-paragraph"), false);
});

test("章节钩子只注册一次，新章节使用当前模式而非最初模式", () => {
  const first = fixture(), next = fixture("3em", "important");
  const hooks: Array<(contents: { document: Document }) => void> = [];
  const rendition = { getContents: () => [{ document: first.doc }], hooks: { content: { register: (callback: (contents: { document: Document }) => void) => hooks.push(callback) } } };
  syncReaderParagraphIndent(rendition, "two-chars");
  syncReaderParagraphIndent(rendition, "none");
  assert.equal(hooks.length, 1);
  hooks[0]!({ document: next.doc });
  assert.equal(next.style.getPropertyValue("text-indent"), "0");
  syncReaderParagraphIndent(rendition, "invalid");
  hooks[0]!({ document: next.doc });
  assert.equal(next.style.getPropertyValue("text-indent"), "3em");
  assert.equal(next.style.getPropertyPriority("text-indent"), "important");
});
