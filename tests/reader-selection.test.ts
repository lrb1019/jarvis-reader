import assert from "node:assert/strict";
import test from "node:test";
import { getSelectionTranslationOptions, clampSelectionMenuPosition } from "../src/reader-selection.ts";

test("离线入口永远只查本地，AI入口显式跳过离线优先流程", () => {
  assert.deepEqual(getSelectionTranslationOptions("offline"), { localOnly: true });
  assert.deepEqual(getSelectionTranslationOptions("ai"), { forceAi: true });
});

test("选文菜单在右边和底部仍保持在阅读区域内", () => {
  assert.deepEqual(clampSelectionMenuPosition(700, 700, 400, 40, 760, 720), { left: 352, top: 672 });
  assert.deepEqual(clampSelectionMenuPosition(-20, -30, 400, 40, 760, 720), { left: 8, top: 8 });
  assert.deepEqual(clampSelectionMenuPosition(100, 80, 280, 40, 300, 720), { left: 12, top: 80 });
});

test("窄阅读区域菜单宽度受CSS限制时仍能安全定位", () => {
  for (const width of [160, 320, 760]) {
    const menuWidth = width - 16;
    const result = clampSelectionMenuPosition(width, 40, menuWidth, 40, width, 600);
    assert.equal(result.left, 8);
    assert.equal(result.left + menuWidth, width - 8);
  }
});
