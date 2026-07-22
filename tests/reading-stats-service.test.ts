import assert from "node:assert/strict";
import test from "node:test";
import { ReadingStatsService } from "../src/reading-stats-service.ts";

test("reading stats persist pending seconds and clear them only after success", async () => {
  const service = new ReadingStatsService();
  const stats: Record<string, Record<string, number>> = {};
  service.add("a.epub", 12);

  assert.equal(await service.flush("a.epub", "2026-07-22", stats, async () => {}), 12);
  assert.deepEqual(stats, { "2026-07-22": { "a.epub": 12 } });
  assert.equal(service.pending("a.epub"), 0);
});

test("reading stats restore memory and retain pending seconds when persistence fails", async () => {
  const service = new ReadingStatsService();
  const stats = { "2026-07-22": { "a.epub": 20 } };
  service.add("a.epub", 8);

  await assert.rejects(service.flush("a.epub", "2026-07-22", stats, async () => {
    throw new Error("write failed");
  }), /write failed/);
  assert.deepEqual(stats, { "2026-07-22": { "a.epub": 20 } });
  assert.equal(service.pending("a.epub"), 8);
});

test("reading seconds added during an active save remain pending for the next flush", async () => {
  const service = new ReadingStatsService();
  const stats: Record<string, Record<string, number>> = {};
  let release: (() => void) | null = null;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  service.add("a.epub", 5);
  const first = service.flush("a.epub", "2026-07-22", stats, async () => { await blocked; });
  service.add("a.epub", 3);
  release?.();
  assert.equal(await first, 5);
  assert.equal(service.pending("a.epub"), 3);
  await service.flush("a.epub", "2026-07-22", stats, async () => {});
  assert.deepEqual(stats, { "2026-07-22": { "a.epub": 8 } });
});

test("reading stats keep pending time isolated per book during switches", async () => {
  const service = new ReadingStatsService();
  const stats: Record<string, Record<string, number>> = {};
  service.add("a.epub", 4);
  service.add("b.epub", 7);
  await service.flush("a.epub", "2026-07-22", stats, async () => {});

  assert.equal(service.pending("a.epub"), 0);
  assert.equal(service.pending("b.epub"), 7);
  assert.deepEqual(stats, { "2026-07-22": { "a.epub": 4 } });
});
