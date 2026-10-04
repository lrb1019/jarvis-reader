import test from "node:test";
import assert from "node:assert/strict";
import { matchesBookSearch } from "../src/library/book-search.ts";

test("renamed books remain searchable by EPUB title and author", () => {
  const fields = ["我的书", "Do It Today: Overcome Procrastination", "Darius Foroux"];
  for (const query of ["我的", "TODAY", "  darius  ", "Procrastination"]) {
    assert.equal(matchesBookSearch(query, fields), true);
  }
  assert.equal(matchesBookSearch("卡尼曼", fields), false);
  assert.equal(matchesBookSearch("卡尼曼", ["思考", undefined, "丹尼尔•卡尼曼"]), true);
});

test("missing metadata preserves filename search and clearing restores all books", () => {
  assert.equal(matchesBookSearch("today", ["Do It Today", undefined]), true);
  assert.equal(matchesBookSearch("darius", ["Do It Today", undefined]), false);
  assert.equal(matchesBookSearch("  ", []), true);
});
