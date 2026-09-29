import assert from "node:assert/strict";
import test from "node:test";
import { displayReadingSource, type NavigationRendition } from "../src/reader-navigation.ts";

// 模拟 epub.js moveTo：目标超过 iframe 已知宽度时被截到最后一页。
function paginatedReader(initialPages: number) {
  let pages = initialPages;
  let page = 1;
  const targets: string[] = [];
  const rendition: NavigationRendition = {
    display: async (target) => {
      targets.push(target);
      page = Math.min(Number(target), pages);
    },
    getContents: () => [{ document: { fonts: { ready: Promise.resolve() } } }],
    views: () => ({ all: () => [{ expand: () => { pages = 14; } }] }),
  };
  return { rendition, targets, page: () => page };
}

for (const [name, initialPages] of [["主题使章节从 8 页扩展到 14 页", 8], ["隐藏标签使宽度收缩到 1 页", 1]] as const) {
  test(`原文定位重新测量正文：${name}`, async () => {
    const reader = paginatedReader(initialPages);
    await reader.rendition.display("11");
    assert.equal(reader.page(), initialPages);
    assert.equal(await displayReadingSource(reader.rendition, "11", () => true, async () => {}), true);
    assert.equal(reader.page(), 11);
  });
}

test("字体加载完成前不确认最终位置", async () => {
  const reader = paginatedReader(8);
  let finishFonts!: () => void;
  const ready = new Promise<void>((resolve) => { finishFonts = resolve; });
  reader.rendition.getContents = () => [{ document: { fonts: { ready } } }];
  const jump = displayReadingSource(reader.rendition, "11", () => true, async () => {});
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(reader.page(), 8);
  finishFonts();
  await jump;
  assert.equal(reader.page(), 11);
});

test("隐藏标签创建的零高度视图在定位前恢复当前布局尺寸", async () => {
  let height = 0;
  const sizes: Array<[number, number]> = [];
  const reader = paginatedReader(8);
  reader.rendition.manager = { viewSettings: { width: 607, height: 582 } };
  reader.rendition.views = () => ({ all: () => [{
    size: (width, nextHeight) => { sizes.push([width, nextHeight]); height = nextHeight; },
    expand: () => { assert.equal(height, 582); },
  }] });
  assert.equal(await displayReadingSource(reader.rendition, "3", () => true, async () => {}), true);
  assert.deepEqual(sizes, [[607, 582]]);
});

test("较晚的跳转取代旧请求，旧请求不能再次定位", async () => {
  const reader = paginatedReader(8);
  let current = true;
  let frames = 0;
  const result = await displayReadingSource(reader.rendition, "11", () => current, async () => {
    if (++frames === 2) current = false;
  });
  assert.equal(result, false);
  assert.deepEqual(reader.targets, ["11"]);
});

test("已关闭的阅读器不执行跳转；定位失败向调用方报告", async () => {
  const reader = paginatedReader(8);
  assert.equal(await displayReadingSource(reader.rendition, "11", () => false, async () => {}), false);
  assert.deepEqual(reader.targets, []);
  reader.rendition.display = async () => { throw new Error("定位无效"); };
  await assert.rejects(displayReadingSource(reader.rendition, "bad", () => true, async () => {}), /定位无效/);
});
