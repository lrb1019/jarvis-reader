import assert from "node:assert/strict";
import test from "node:test";

import { moveFloatingCardRect } from "../src/floating-card-core.ts";

test("moves a temporary translation card without applying note-window bounds", () => {
  const moved = moveFloatingCardRect(
    { x: 320, y: 180, width: 480, height: 420 },
    { x: 500, y: 260 },
    { x: 520, y: 900 },
  );

  assert.deepEqual(moved, {
    x: 340,
    y: 820,
    width: 480,
    height: 420,
  });
});
