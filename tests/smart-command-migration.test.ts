import assert from "node:assert/strict";
import test from "node:test";
import { removeSmartCommandsWithBackup } from "../src/smart-command-migration.ts";

test("backs up and removes legacy smartCommands without changing other settings", async () => {
  const settings = { readerZoom: 1.2, smartCommands: [{ id: "smart-1" }], unknownFutureSetting: true };
  let backup = "";

  const result = await removeSmartCommandsWithBackup(settings, async (content) => { backup = content; });

  assert.equal(result.migrated, true);
  assert.deepEqual(result.settings, { readerZoom: 1.2, unknownFutureSetting: true });
  assert.deepEqual(JSON.parse(backup), { smartCommands: [{ id: "smart-1" }] });
});

test("does not write a backup when smartCommands is absent", async () => {
  const settings = { readerZoom: 1.2 };
  let backedUp = false;

  const result = await removeSmartCommandsWithBackup(settings, async () => { backedUp = true; });

  assert.equal(result.migrated, false);
  assert.equal(result.settings, settings);
  assert.equal(backedUp, false);
});
