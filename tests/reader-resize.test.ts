import assert from "node:assert/strict";
import test from "node:test";
import { bindReaderContainerResize } from "../src/reader-resize.ts";

function fixture() {
  const host = { clientWidth: 500, clientHeight: 600 };
  let attached: (() => void) | undefined;
  let observed: (() => void) | undefined;
  let pending: (() => void) | undefined;
  let disconnected = false;
  let selected = false;
  const sizes: number[][] = [];
  const cleanup = bindReaderContainerResize(host, {
    on(_event, callback) { attached = callback; },
    off(_event, callback) { if (attached === callback) attached = undefined; },
    hasActiveSelection() { return selected; },
    resize() { sizes.push([host.clientWidth, host.clientHeight]); },
  }, {
    observe(_host, callback) { observed = callback; return () => { disconnected = true; }; },
    delay(callback) { pending = callback; return () => { if (pending === callback) pending = undefined; }; },
  });
  return { host, sizes, cleanup, select: (value: boolean) => { selected = value; }, attach: () => attached?.(), change: () => observed?.(),
    flush: () => { const callback = pending; pending = undefined; callback?.(); },
    disconnected: () => disconnected, bound: () => !!attached };
}

test("侧栏尺寸变化无需 window resize，等待挂载且连续变动只使用最终尺寸", () => {
  const f = fixture();
  f.change(); f.flush();
  assert.deepEqual(f.sizes, []);
  f.attach(); f.flush();
  f.host.clientWidth = 400; f.change();
  f.host.clientWidth = 850; f.change();
  f.host.clientHeight = 700; f.change(); f.flush();
  assert.deepEqual(f.sizes, [[500, 600], [850, 700]]);
});

test("隐藏容器不重排，重新显示后测量最新尺寸", () => {
  const f = fixture(); f.attach(); f.flush();
  f.host.clientWidth = 0; f.change(); f.flush();
  assert.equal(f.sizes.length, 1);
  f.host.clientWidth = 900; f.change(); f.flush();
  assert.deepEqual(f.sizes[1], [900, 600]);
});

test("关闭或替换阅读器取消待处理重排并移除监听，旧回调不访问已销毁引擎", () => {
  const f = fixture(); f.attach(); f.change(); f.cleanup(); f.flush(); f.change(); f.flush();
  assert.deepEqual(f.sizes, []);
  assert.equal(f.disconnected(), true);
  assert.equal(f.bound(), false);
});


test("选区存在时底部输入框扩展不重排，清除后使用最终尺寸", () => {
  const f = fixture(); f.attach(); f.flush();
  f.select(true); f.host.clientHeight = 568; f.change(); f.flush(); f.flush();
  assert.deepEqual(f.sizes, [[500, 600]]);
  f.select(false); f.flush();
  assert.deepEqual(f.sizes, [[500, 600], [500, 568]]);
});

test("选词标签消失后尺寸回到原值，不执行破坏选区的冗余重排", () => {
  const f = fixture(); f.attach(); f.flush();
  f.select(true); f.host.clientHeight = 568; f.change(); f.flush();
  f.host.clientHeight = 600; f.change(); f.select(false); f.flush();
  assert.deepEqual(f.sizes, [[500, 600]]);
  f.select(true); f.host.clientHeight = 568; f.change(); f.flush();
  f.cleanup(); f.select(false); f.flush();
  assert.deepEqual(f.sizes, [[500, 600]]);
});


test("分页边界在挂载时记录，选区延期期间保留，实际重排后才更新", () => {
  const host = { clientWidth: 500, clientHeight: 600 };
  let attached: (() => void) | undefined;
  let observed: (() => void) | undefined;
  let pending: (() => void) | undefined;
  let selected = false;
  let viewport = 0;
  const events: string[] = [];
  const cleanup = bindReaderContainerResize(host, {
    on(_event, callback) { attached = callback; },
    off() { attached = undefined; },
    hasActiveSelection() { return selected; },
    resize() { events.push("resize"); },
    commitViewport() { viewport = host.clientWidth; events.push("viewport"); },
  }, {
    observe(_host, callback) { observed = callback; return () => {}; },
    delay(callback) { pending = callback; return () => { pending = undefined; }; },
  });
  const flush = () => { const callback = pending; pending = undefined; callback?.(); };
  attached?.(); flush();
  assert.equal(viewport, 500);
  selected = true; host.clientWidth = 800; observed?.(); flush();
  assert.equal(viewport, 500);
  selected = false; flush();
  assert.equal(viewport, 800);
  assert.deepEqual(events, ["viewport", "resize", "viewport", "resize", "viewport"]);
  host.clientWidth = 1000; observed?.(); cleanup(); flush();
  assert.equal(viewport, 800);
});
