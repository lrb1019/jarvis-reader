import assert from "node:assert/strict";
import test from "node:test";
import { BookNoteService, type BookNoteOperations } from "../src/book-note-service.ts";
import type { BookHighlight } from "../src/types.ts";

const highlight = { id: "h", blockId: "h", bookPath: "b", bookTitle: "b", chapterTitle: "c", cfiRange: "cfi", quote: "q", comment: "", notePath: "b.md", created: "now" } as BookHighlight;

test("book note service delegates every Markdown lifecycle operation to one adapter", async () => {
  const calls: string[] = [];
  const operations: BookNoteOperations = {
    appendHighlight: async () => { calls.push("append"); },
    appendReflection: async () => { calls.push("reflect"); },
    replaceHighlight: async () => { calls.push("replace"); },
    deleteHighlight: async () => { calls.push("delete"); },
    readHighlightDetails: async () => { calls.push("read"); return { quote: "q", comment: "", commentEntries: [], aiSections: [] }; },
  };
  const service = new BookNoteService(operations);

  await service.appendHighlight({}, highlight);
  await service.appendReflection({}, highlight, "note");
  await service.replaceHighlight({}, highlight);
  await service.readHighlightDetails({}, highlight);
  await service.deleteHighlight({}, highlight);
  assert.deepEqual(calls, ["append", "reflect", "replace", "read", "delete"]);
});
