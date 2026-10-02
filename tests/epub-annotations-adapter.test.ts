import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { removeEpubAnnotation, refreshHighlightPanes } from "../src/epub-annotations-adapter.ts";
const require = createRequire(import.meta.url);
const Annotations = require("epubjs/lib/annotations.js").default;
const cfi = "epubcfi(/6/26!/4/2/36/2,/1:0,/1:132)";
function fixture() {
  return new Annotations({ views: () => [], hooks: {
    render: { register() {} }, unloaded: { register() {} },
  } });
}

test("真实 epub.js 在无视图时删除标记，会留下导致 attach 异常的编号", () => {
  const store = fixture();
  store.highlight(cfi, {});
  store.remove(cfi, "highlight");
  assert.throws(() => store.inject({ index: 12 }), /attach/);
});

test("适配清理后，连续跨章清除及重新注入不再访问已删除标记", () => {
  const store = fixture();
  for (let i = 0; i < 5; i++) {
    store.highlight(cfi, {});
    store.underline(cfi, {});
    removeEpubAnnotation(store, cfi, "highlight");
    removeEpubAnnotation(store, cfi, "underline");
    assert.doesNotThrow(() => store.inject({ index: 12 }));
    assert.doesNotThrow(() => store.clear({ index: 12 }));
  }
});

test("保留有效标记，去除历史残留和重复编号", () => {
  const store = fixture();
  store.highlight(cfi, {});
  store.highlight(cfi, {});
  store._annotationsBySectionIndex[12].push("missing");
  removeEpubAnnotation(store, cfi, "underline");
  let attached = 0;
  store.inject({ index: 12, highlight: () => { attached++; } });
  assert.equal(attached, 1);
});


test("pane refresh waits 80ms then one frame and renders only available visible panes", (t) => {
  let timeout!: () => void;
  let frame!: () => void;
  let calls = 0;
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  t.after(() => {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  });
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    setTimeout(callback: () => void, delay: number) { assert.equal(delay, 80); timeout = callback; },
    requestAnimationFrame(callback: () => void) { frame = callback; }
  } });
  const pane = { render() { assert.equal(this, pane); calls++; } };
  refreshHighlightPanes({ manager: { stage: {}, visible: () => [null, {}, { pane }, { pane: {} }] } });
  assert.equal(calls, 0);
  timeout();
  assert.equal(calls, 0);
  frame();
  assert.equal(calls, 1);
});

test("pane refresh guards unloaded stages and contains private engine errors", (t) => {
  let timeout!: () => void;
  let frame!: () => void;
  const warnings = t.mock.method(console, "warn", () => {});
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  t.after(() => {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  });
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    setTimeout(callback: () => void) { timeout = callback; },
    requestAnimationFrame(callback: () => void) { frame = callback; }
  } });
  const manager = { stage: {} as unknown, visible() { throw new Error("engine disposed"); } };
  refreshHighlightPanes({ manager });
  manager.stage = null;
  timeout(); frame();
  assert.equal(warnings.mock.callCount(), 0);
  manager.stage = {};
  refreshHighlightPanes({ manager }); timeout();
  assert.doesNotThrow(frame);
  assert.equal(warnings.mock.callCount(), 1);
  assert.equal(warnings.mock.calls[0].arguments[0], "Jarvis Reader highlight refresh failed.");
});
