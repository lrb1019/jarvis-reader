import assert from "node:assert/strict";
import test from "node:test";

import { clampReaderLineHeight, clampReaderZoom } from "../src/theme.ts";

test("clamps reader display settings to supported ranges", () => {
  assert.equal(clampReaderZoom(0), 0.6);
  assert.equal(clampReaderZoom(4), 2);
  assert.equal(clampReaderLineHeight(0), 1.1);
  assert.equal(clampReaderLineHeight(5), 2.4);
});

test("normalizes reader display settings to stable increments", () => {
  assert.equal(clampReaderZoom("1.234"), 1.25);
  assert.equal(clampReaderLineHeight("1.67"), 1.65);
  assert.equal(clampReaderZoom("invalid"), 1);
  assert.equal(clampReaderLineHeight(undefined), 1.6);
});
