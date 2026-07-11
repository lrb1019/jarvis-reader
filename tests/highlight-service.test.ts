import assert from "node:assert/strict";
import test from "node:test";
import { HighlightService } from "../src/highlight-service.ts";

const highlight = { id: "h", bookPath: "b", bookTitle: "b", chapterTitle: "c", cfiRange: "cfi", quote: "q", comment: "", notePath: "b.md", blockId: "h", created: "now" };

test("highlight service restores the prior index when persistence fails", async () => {
  const previous = { b: [highlight] };
  const host = { settings: { bookHighlights: previous }, persistHighlightSidecar: async () => { throw new Error("write failed"); } };
  const service = new HighlightService(host);
  await assert.rejects(service.replaceBookHighlights("b", [], "delete-highlight"));
  assert.equal(host.settings.bookHighlights, previous);
  assert.deepEqual(host.settings.bookHighlights.b, [highlight]);
});

test("highlight service restores the complete prior map when bulk persistence fails", async () => {
  const previous = { b: [highlight] };
  const host = { settings: { bookHighlights: previous }, persistHighlightSidecar: async () => { throw new Error("write failed"); } };
  const service = new HighlightService(host);

  await assert.rejects(service.replaceAll({ b: [], other: [highlight] }, "auto-conflict-resolve"));
  assert.equal(host.settings.bookHighlights, previous);
});

test("highlight service notifies only after a successful index write", async () => {
  let notifications = 0;
  const host = {
    settings: { bookHighlights: { b: [highlight] } },
    persistHighlightSidecar: async () => {},
    onHighlightsChanged: () => { notifications += 1; },
  };
  const service = new HighlightService(host);

  await service.replaceBookHighlights("b", [], "delete-highlight");
  assert.equal(notifications, 1);
});
