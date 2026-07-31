import assert from "node:assert/strict";
import test from "node:test";

import { isReaderPageTurnKey } from "../src/editor-keyboard-core.ts";

test("identifies only the keys that the EPUB reader uses for page turns", () => {
  assert.equal(isReaderPageTurnKey("ArrowLeft"), true);
  assert.equal(isReaderPageTurnKey("ArrowRight"), true);
  assert.equal(isReaderPageTurnKey("ArrowUp"), false);
  assert.equal(isReaderPageTurnKey("ArrowDown"), false);
  assert.equal(isReaderPageTurnKey("Enter"), false);
});
