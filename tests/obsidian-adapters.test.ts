import assert from "node:assert/strict";
import test from "node:test";
import {
  createSettingsDataStore,
  createVaultTextFileStore,
} from "../src/storage/obsidian-adapters.ts";

test("plugin settings adapter forwards load and save", async () => {
  let saved: unknown;
  const store = createSettingsDataStore({
    loadData: async () => ({ value: 1 }),
    saveData: async (data) => {
      saved = data;
    },
  });
  assert.deepEqual(await store.loadData(), { value: 1 });
  await store.saveData({ value: 2 });
  assert.deepEqual(saved, { value: 2 });
});

test("vault adapter forwards text file operations", async () => {
  const calls: string[] = [];
  const adapter = {
    exists: async (path: string) => {
      calls.push(`exists:${path}`);
      return true;
    },
    read: async (path: string) => {
      calls.push(`read:${path}`);
      return "content";
    },
    write: async (path: string, content: string) => {
      calls.push(`write:${path}:${content}`);
    },
    mkdir: async (path: string) => {
      calls.push(`mkdir:${path}`);
    },
  };
  const store = createVaultTextFileStore(adapter as never);
  assert.equal(await store.exists("a"), true);
  assert.equal(await store.read("a"), "content");
  await store.write("a", "next");
  await store.mkdir("folder");
  assert.deepEqual(calls, [
    "exists:a",
    "read:a",
    "write:a:next",
    "mkdir:folder",
  ]);
});
