import assert from "node:assert/strict";
import test from "node:test";
import { clampReaderLetterSpacing, clampReaderWordSpacing, DEFAULT_READER_PREFERENCES, resolveReaderPreferences } from "../src/reader-settings.ts";
import { applyReaderTextSpacing, getReaderTextSpacingCss, syncReaderTextSpacing } from "../src/reader-text-spacing.ts";

function documentFixture() {
  const styles = new Map<string, { id: string; textContent: string; remove(): void }>();
  return {
    getElementById(id: string) { return styles.get(id) || null; },
    createElement() { return { id: "", textContent: "", remove() { styles.delete(this.id); } }; },
    head: { appendChild(style: { id: string; textContent: string; remove(): void }) { styles.set(style.id, style); } },
    styles,
  };
}

test("间距范围、负值、步进及旧配置规范化，读取不改写原对象", () => {
  assert.equal(clampReaderLetterSpacing(-99), -5);
  assert.equal(clampReaderLetterSpacing(99), 20);
  assert.equal(clampReaderWordSpacing(-99), -20);
  assert.equal(clampReaderWordSpacing(99), 50);
  assert.equal(clampReaderWordSpacing("-6"), -6);
  for (const value of [undefined, null, "invalid", NaN, Infinity]) {
    assert.equal(clampReaderLetterSpacing(value), 0);
    assert.equal(clampReaderWordSpacing(value), 0);
  }
  const old = { ...DEFAULT_READER_PREFERENCES, readerLetterSpacing: undefined, readerWordSpacing: undefined };
  const before = JSON.stringify(old);
  const resolved = resolveReaderPreferences(old as unknown as typeof DEFAULT_READER_PREFERENCES, {});
  assert.equal(resolved.readerLetterSpacing, 0);
  assert.equal(resolved.readerWordSpacing, 0);
  assert.equal(JSON.stringify(old), before);
});

test("百分比转 em，两个间距独立，默认不覆盖原书规则", () => {
  assert.match(getReaderTextSpacingCss(8, -6), /letter-spacing: 0.08em/);
  assert.match(getReaderTextSpacingCss(8, -6), /word-spacing: -0.06em/);
  assert.equal(getReaderTextSpacingCss(0, 0), "");
  assert.doesNotMatch(getReaderTextSpacingCss(0, 10), /letter-spacing/);
  assert.doesNotMatch(getReaderTextSpacingCss(10, 0), /word-spacing/);
});

test("反复调整复用一个显示样式，恢复0移除覆盖而不触碰原书样式", () => {
  const fixture = documentFixture();
  const doc = fixture as unknown as Document;
  const original = { id: "book-style", textContent: "p { letter-spacing: 2px; }", remove() {} };
  fixture.styles.set(original.id, original);
  applyReaderTextSpacing(doc, 8, -6);
  const style = fixture.getElementById("jarvis-reader-text-spacing");
  applyReaderTextSpacing(doc, 10, 5);
  assert.equal(fixture.getElementById("jarvis-reader-text-spacing"), style);
  assert.match(style!.textContent, /0.1em/);
  applyReaderTextSpacing(doc, 0, 0);
  assert.equal(fixture.styles.size, 1);
  assert.equal(fixture.getElementById("book-style"), original);
});

test("章节钩子不重复，新章节应用最新偏好，恢复默认清除两项", () => {
  const fixture = documentFixture();
  const callbacks: Array<(content: { document: Document }) => void> = [];
  const rendition = { getContents: () => [{ document: fixture as unknown as Document }],
    hooks: { content: { register: (callback: (content: { document: Document }) => void) => callbacks.push(callback) } } };
  syncReaderTextSpacing(rendition, 4, -6);
  syncReaderTextSpacing(rendition, 8, 10);
  assert.equal(callbacks.length, 1);
  const next = documentFixture();
  callbacks[0]({ document: next as unknown as Document });
  assert.match(next.getElementById("jarvis-reader-text-spacing")!.textContent, /0.08em/);
  const reset = resolveReaderPreferences({ ...DEFAULT_READER_PREFERENCES, readerLetterSpacing: 8, readerWordSpacing: 10 }, DEFAULT_READER_PREFERENCES);
  syncReaderTextSpacing(rendition, reset.readerLetterSpacing, reset.readerWordSpacing);
  assert.equal(fixture.getElementById("jarvis-reader-text-spacing"), null);
});
