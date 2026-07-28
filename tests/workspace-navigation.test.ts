import assert from "node:assert/strict";
import test from "node:test";
import {
  openFileInActiveTab,
  openFileOnceInActiveTab,
  type FileLeaf,
  type FileWorkspace,
  type ReusableFileWorkspace,
} from "../src/workspace-navigation.ts";

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

test("focuses an existing tab when the same file is already open", async () => {
  const events: string[] = [];
  const file = { path: "09 Books/Who Moved My Cheese.epub" };
  const existingLeaf: FileLeaf<MemoryFile> = {
    view: { file },
    openFile: async () => {
      events.push("unexpected-open");
    },
  };
  const workspace: ReusableFileWorkspace<MemoryFile> = {
    getLeavesOfType: (viewType) => {
      assert.equal(viewType, "epub");
      events.push("find");
      return [existingLeaf];
    },
    getLeaf: () => {
      events.push("unexpected-leaf");
      return existingLeaf;
    },
    setActiveLeaf: (leaf, options) => {
      assert.equal(leaf, existingLeaf);
      assert.deepEqual(options, { focus: true });
      events.push("activate");
    },
  };

  const openedLeaf = await openFileOnceInActiveTab(workspace, file, "epub");

  assert.equal(openedLeaf, existingLeaf);
  assert.deepEqual(events, ["find", "activate"]);
});

test("opens a new tab when only different files are already open", async () => {
  const events: string[] = [];
  const file = { path: "09 Books/Who Moved My Cheese.epub" };
  const otherLeaf: FileLeaf<MemoryFile> = {
    view: { file: { path: "09 Books/Eat That Frog.epub" } },
    openFile: async () => {
      events.push("unexpected-other-open");
    },
  };
  const newLeaf: FileLeaf<MemoryFile> = {
    openFile: async (openedFile, options) => {
      assert.equal(openedFile, file);
      assert.deepEqual(options, { active: true });
      events.push("open");
    },
  };
  const workspace: ReusableFileWorkspace<MemoryFile> = {
    getLeavesOfType: () => {
      events.push("find");
      return [otherLeaf];
    },
    getLeaf: (newLeafType) => {
      assert.equal(newLeafType, "tab");
      events.push("leaf");
      return newLeaf;
    },
    setActiveLeaf: (leaf, options) => {
      assert.equal(leaf, newLeaf);
      assert.deepEqual(options, { focus: true });
      events.push("activate");
    },
  };

  const openedLeaf = await openFileOnceInActiveTab(workspace, file, "epub");

  assert.equal(openedLeaf, newLeaf);
  assert.deepEqual(events, ["find", "leaf", "open", "activate"]);
});
