import assert from "node:assert/strict";
import test from "node:test";
import { clampReaderWidth, READER_WIDTH_LIMITS, clampReaderZoom, clampReaderLineHeight, READER_ZOOM_LIMITS, READER_LINE_HEIGHT_LIMITS } from "../src/reader-settings.ts";

for (const [name, limits, normalize] of [
  ["正文宽度", READER_WIDTH_LIMITS, clampReaderWidth],
  ["字号", READER_ZOOM_LIMITS, clampReaderZoom],
  ["行距", READER_LINE_HEIGHT_LIMITS, clampReaderLineHeight],
] as const) {
  test(`${name}控件提供的每一个步进值在阅读器中完整生效`, () => {
    const steps = Math.round((limits.max - limits.min) / limits.step);
    for (let i = 0; i <= steps; i++) {
      const controlValue = Number((limits.min + i * limits.step).toFixed(2));
      assert.equal(normalize(controlValue), controlValue);
    }
    assert.equal(normalize(limits.min - limits.step), limits.min);
    assert.equal(normalize(limits.max + limits.step), limits.max);
  });

  test(`${name}缺失、无效值使用默认值；历史字符串值与有效值保持兼容`, () => {
    for (const value of [undefined, null, "", "invalid", NaN, Infinity, -Infinity, {}, []]) {
      assert.equal(normalize(value), limits.defaultValue);
    }
    assert.equal(normalize(String(limits.defaultValue)), limits.defaultValue);
    assert.equal(normalize(String(limits.max + limits.step)), limits.max);
    assert.equal(normalize(String(limits.min - limits.step)), limits.min);
    assert.equal(normalize(normalize(1.123)), normalize(1.123));
  });
}

test("旧超范围设置只规范化显示，不改写读取对象或无关阅读数据", () => {
  const loaded = { readerZoom: 3, readerLineHeight: 3, bookInitLocations: { book: "cfi" }, bookBookmarks: { book: ["bookmark"] } };
  const before = JSON.stringify(loaded);
  assert.deepEqual({ zoom: clampReaderZoom(loaded.readerZoom), lineHeight: clampReaderLineHeight(loaded.readerLineHeight) }, { zoom: 2, lineHeight: 2.4 });
  assert.equal(JSON.stringify(loaded), before);
});

test("双页强制分页，回到单页不擅自开启滚动", async () => {
  const { resolveReaderPreferences, DEFAULT_READER_PREFERENCES } = await import("../src/reader-settings.ts");
  const scroll = { ...DEFAULT_READER_PREFERENCES, singlePageView: true, scrolledView: true };
  const dual = resolveReaderPreferences(scroll, { singlePageView: false });
  assert.equal(dual.scrolledView, false);
  assert.equal(resolveReaderPreferences(dual, { scrolledView: true }).scrolledView, false);
  assert.equal(resolveReaderPreferences(dual, { singlePageView: true }).scrolledView, false);
  assert.equal(scroll.scrolledView, true);
});

test("恢复默认只包含八个阅读字段，不携带位置、书签或笔记", async () => {
  const { resolveReaderPreferences, DEFAULT_READER_PREFERENCES } = await import("../src/reader-settings.ts");
  const current = { readerLetterSpacing: 8, readerWordSpacing: -6, readerParagraphIndent: "two-chars" as const, readerWidth: 1200, readerZoom: 2, readerLineHeight: 2.4, singlePageView: true, scrolledView: true, bookInitLocations: { book: "cfi" } };
  assert.deepEqual(resolveReaderPreferences(current, { ...DEFAULT_READER_PREFERENCES }), DEFAULT_READER_PREFERENCES);
  assert.deepEqual(current.bookInitLocations, { book: "cfi" });
  assert.deepEqual(resolveReaderPreferences(current, { readerZoom: 3, readerLineHeight: 0 }).readerZoom, 2);
});

test("快捷入口兼容旧配置、空列表及未知项，并按固定顺序去重", async () => {
  const { normalizeReaderQuickActions } = await import("../src/reader-settings.ts");
  assert.deepEqual(normalizeReaderQuickActions(undefined), ["bookmark", "note"]);
  assert.deepEqual(normalizeReaderQuickActions(null), ["bookmark", "note"]);
  assert.deepEqual(normalizeReaderQuickActions([]), []);
  assert.deepEqual(normalizeReaderQuickActions(["layout", "zoom", "lineHeight", "flow", "unknown", "note", "note", "bookmark"]), ["bookmark", "note"]);
  const input = ["layout", "note"];
  normalizeReaderQuickActions(input);
  assert.deepEqual(input, ["layout", "note"]);
});

 test("栏数与阅读方式切换保留同一正文宽度，旧配置缺失宽度时用960", async () => {
  const { resolveReaderPreferences, DEFAULT_READER_PREFERENCES } = await import("../src/reader-settings.ts");
  for (const readerWidth of [480, 760, 1120, 1600]) {
    const current = { ...DEFAULT_READER_PREFERENCES, readerWidth };
    const single = resolveReaderPreferences(current, { singlePageView: true });
    const scroll = resolveReaderPreferences(single, { scrolledView: true });
    const dual = resolveReaderPreferences(scroll, { singlePageView: false });
    assert.equal(single.readerWidth, readerWidth);
    assert.equal(scroll.readerWidth, readerWidth);
    assert.equal(dual.readerWidth, readerWidth);
    assert.equal(dual.scrolledView, false);
  }
  assert.equal(clampReaderWidth(undefined), 960);
});

test("首行缩进旧配置与无效值默认遵循原书，切换不改变布局字段", async () => {
  const { normalizeReaderParagraphIndent, resolveReaderPreferences, DEFAULT_READER_PREFERENCES } = await import("../src/reader-settings.ts");
  for (const value of [undefined, null, "", "invalid", 2, {}]) assert.equal(normalizeReaderParagraphIndent(value), "original");
  for (const value of ["original", "two-chars", "none"] as const) {
    assert.equal(normalizeReaderParagraphIndent(value), value);
    assert.deepEqual(resolveReaderPreferences(DEFAULT_READER_PREFERENCES, { readerParagraphIndent: value }), { ...DEFAULT_READER_PREFERENCES, readerParagraphIndent: value });
  }
});
