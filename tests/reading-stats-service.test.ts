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

test("manual reading time persists date and book, rejects invalid input, and rolls back failures", async () => {
  const service = new ReadingStatsService();
  const stats: Record<string, Record<string, number>> = {};
  await service.recordManual("a.epub", "2026-09-30", 30, stats, async () => {});
  assert.deepEqual(stats, { "2026-09-30": { "a.epub": 1800 } });
  const reloaded = JSON.parse(JSON.stringify(stats));
  assert.deepEqual(reloaded, stats);
  await assert.rejects(service.recordManual("b.epub", "2026-09-30", 10, stats, async () => { throw new Error("save failed"); }), /save failed/);
  assert.deepEqual(stats, reloaded);
  for (const [date, minutes] of [["2026-02-30", 1], ["2026-09-30", 0], ["2026-09-30", 1.5], ["2026-09-30", 1441]] as const) {
    await assert.rejects(service.recordManual("a.epub", date, minutes, stats, async () => {}));
  }
  assert.deepEqual(stats, reloaded);
});

test("manual additions serialize with automatic recording and preserve failed-save rollback", async () => {
  const automatic = new ReadingStatsService();
  const manual = new ReadingStatsService();
  const stats: Record<string, Record<string, number>> = {};
  automatic.add("a.epub", 5);
  const failed = manual.recordManual("a.epub", "2026-09-30", 10, stats, async () => { throw new Error("failed"); });
  const flush = automatic.flush("a.epub", "2026-09-30", stats, async () => {});
  await assert.rejects(failed, /failed/);
  assert.equal(await flush, 5);
  await manual.recordManual("a.epub", "2026-09-30", 1, stats, async () => {});
  assert.equal(stats["2026-09-30"]["a.epub"], 65);
});

test("manual reading time refuses corrupt existing totals without overwriting them", async () => {
  const service = new ReadingStatsService();
  const stats = { "2026-09-30": { "a.epub": -10 } };
  let saved = false;
  await assert.rejects(service.recordManual("a.epub", "2026-09-30", 10, stats, async () => { saved = true; }), /数据异常/);
  assert.equal(stats["2026-09-30"]["a.epub"], -10);
  assert.equal(saved, false);
});
