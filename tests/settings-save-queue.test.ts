import assert from "node:assert/strict";
import test from "node:test";
import { SettingsSaveQueue } from "../src/settings-save-queue.ts";

test("settings queue coalesces rapid requests into one latest snapshot", async () => {
  let state = 1;
  const writes: number[] = [];
  const queue = new SettingsSaveQueue(() => state, async (value) => { writes.push(value); }, 5);
  const first = queue.request();
  state = 2;
  const second = queue.request();
  state = 3;
  const third = queue.request();

  await Promise.all([first, second, third]);
  assert.deepEqual(writes, [3]);
});

test("settings queue serializes a request that arrives during an active write", async () => {
  let state = 1;
  const writes: number[] = [];
  let releaseFirst: (() => void) | null = null;
  const firstBlocked = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const queue = new SettingsSaveQueue(() => state, async (value) => {
    writes.push(value);
    if (writes.length === 1) await firstBlocked;
  }, 0);

  const first = queue.request();
  await new Promise((resolve) => setTimeout(resolve, 5));
  state = 2;
  const second = queue.request();
  releaseFirst?.();
  await Promise.all([first, second]);
  assert.deepEqual(writes, [1, 2]);
});

test("a failed write rejects its callers and a later request can retry the latest state", async () => {
  let state = 1;
  let fail = true;
  const writes: number[] = [];
  const queue = new SettingsSaveQueue(() => state, async (value) => {
    writes.push(value);
    if (fail) throw new Error("write failed");
  }, 0);

  await assert.rejects(queue.request(), /write failed/);
  state = 2;
  fail = false;
  await queue.flushNow();
  assert.deepEqual(writes, [1, 2]);
});
