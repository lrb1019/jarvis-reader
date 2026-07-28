import assert from "node:assert/strict";
import test from "node:test";
import { openFileInActiveTab, type FileLeaf, type FileWorkspace } from "../src/workspace-navigation.ts";

interface MemoryFile {
  path: string;
}

test("opens a file before activating and focusing its new tab", async () => {
  const events: string[] = [];
  const file = { path: "知识库/想法/读书笔记.md" };
  const leaf: FileLeaf<MemoryFile> = {
    openFile: async (openedFile, options) => {
      assert.equal(openedFile, file);
      assert.deepEqual(options, { active: true });
      events.push("open");
    },
  };
  const workspace: FileWorkspace<MemoryFile> = {
    getLeaf: (newLeaf) => {
      assert.equal(newLeaf, "tab");
      events.push("leaf");
      return leaf;
    },
    setActiveLeaf: (activeLeaf, options) => {
      assert.equal(activeLeaf, leaf);
      assert.deepEqual(options, { focus: true });
      events.push("activate");
    },
  };

  await openFileInActiveTab(workspace, file);

  assert.deepEqual(events, ["leaf", "open", "activate"]);
});

test("does not activate a tab when opening the file fails", async () => {
  let activated = false;
  const failure = new Error("open failed");
  const leaf: FileLeaf<MemoryFile> = {
    openFile: async () => { throw failure; },
  };
  const workspace: FileWorkspace<MemoryFile> = {
    getLeaf: () => leaf,
    setActiveLeaf: () => { activated = true; },
  };

  await assert.rejects(
    openFileInActiveTab(workspace, { path: "知识库/想法/读书笔记.md" }),
    failure,
  );
  assert.equal(activated, false);
});
