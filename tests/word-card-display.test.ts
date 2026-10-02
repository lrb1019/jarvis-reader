import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { getWordCardDisplayLineMeta, renderWordCardDisplayText } from "../src/word-card-display.ts";

test("word card bold formatting preserves surrounding text, element keys and literal HTML", () => {
  const result = renderWordCardDisplayText("before **first** / __second__ <script>literal</script>");
  assert.ok(Array.isArray(result));
  assert.equal(result[0], "before ");
  assert.equal(result[2], " / ");
  assert.equal(result[4], " <script>literal</script>");
  for (const [index, text, key] of [[1, "first", "bold-1"], [3, "second", "bold-3"]] as const) {
    const element = result[index];
    assert.ok(React.isValidElement<{ children: string }>(element));
    assert.equal(element.type, "strong");
    assert.equal(element.key, key);
    assert.equal(element.props.children, text);
  }
});

test("word card formatting keeps unmatched markers, empty input and multiline bold", () => {
  for (const text of ["", "plain text", "**unfinished", "__", "**mixed__", "<b>literal</b>"]) {
    assert.deepEqual(renderWordCardDisplayText(text), text ? [text] : "");
  }
  const result = renderWordCardDisplayText("**first\nsecond**");
  assert.ok(Array.isArray(result));
  assert.equal(result.length, 1);
  assert.ok(React.isValidElement<{ children: string }>(result[0]));
  assert.equal(result[0].props.children, "first\nsecond");
});

test("word card lines retain heading, quote, list and ordinary whitespace behavior", () => {
  for (const [line, kind, text] of [
    ["  ## heading  ", "heading", "heading"],
    ["###### six", "heading", "six"],
    ["> quote", "quote", "quote"],
    [">", "quote", ""],
    [" - item ", "list", "item"],
    ["* item", "list", "item"],
    ["12. item", "list", "item"],
    ["2) item", "list", "item"],
    ["  ordinary  ", "line", "  ordinary  "],
    ["#nospace", "line", "#nospace"],
    ["####### seven", "line", "####### seven"],
    ["-nospace", "line", "-nospace"],
    ["", "line", ""],
  ] as const) {
    assert.deepEqual(getWordCardDisplayLineMeta(line), {
      className: `jarvis-reader-word-card-display-${kind}`,
      text,
    });
  }
});
