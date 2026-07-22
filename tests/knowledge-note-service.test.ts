import assert from "node:assert/strict";
import test from "node:test";
import { KnowledgeNoteService, type KnowledgeNoteStorage } from "../src/knowledge-note-service.ts";

interface MemoryFile {
  path: string;
  content: string;
}

function createStorage(existing: Array<string | MemoryFile> = []): KnowledgeNoteStorage<MemoryFile> & { folders: string[]; files: MemoryFile[] } {
  const paths = new Set(existing.map((item) => typeof item === "string" ? item : item.path));
  const existingFiles = existing.filter((item): item is MemoryFile => typeof item !== "string");
  const folders: string[] = [];
  const files: MemoryFile[] = [];
  return {
    folders,
    files,
    exists: (path) => paths.has(path),
    findBySource: async (sourceNotePath, sourceBlockId) => existingFiles.find((file) => file.content.includes(`[[${sourceNotePath}#^${sourceBlockId}]]`)) || null,
    createFolder: async (path) => { paths.add(path); folders.push(path); },
    createFile: async (path, content) => {
      paths.add(path);
      const file = { path, content };
      files.push(file);
      return file;
    },
  };
}

const request = {
  folder: "知识库/想法",
  title: "读书笔记",
  body: "我的判断",
  sourceNotePath: "阅读/原子习惯",
  sourceBlockId: "abc",
  sourceBookTitle: "原子习惯",
  createdAt: "2026-07-11",
};

test("knowledge note service creates missing folders and a linked Markdown note", async () => {
  const storage = createStorage();
  const file = await new KnowledgeNoteService(storage).create(request);

  assert.deepEqual(storage.folders, ["知识库", "知识库/想法"]);
  assert.equal(file.path, "知识库/想法/读书笔记.md");
  assert.match(file.content, /\[\[阅读\/原子习惯#\^abc\]\]/);
});

test("knowledge note service adds a suffix instead of overwriting an existing note", async () => {
  const storage = createStorage(["知识库", "知识库/想法", "知识库/想法/读书笔记.md"]);
  const file = await new KnowledgeNoteService(storage).create(request);

  assert.equal(file.path, "知识库/想法/读书笔记 2.md");
});

test("knowledge note service returns an existing note for the same source block", async () => {
  const existing = {
    path: "知识库/想法/旧标题.md",
    content: "## 来源\n\n[[阅读/原子习惯#^abc]]\n",
  };
  const storage = createStorage([existing]);
  const file = await new KnowledgeNoteService(storage).create(request);

  assert.equal(file, existing);
  assert.equal(storage.files.length, 0);
});

test("knowledge note service stops before writing when folder creation fails", async () => {
  const storage = createStorage();
  storage.createFolder = async () => { throw new Error("folder denied"); };
  const service = new KnowledgeNoteService(storage);

  await assert.rejects(service.create(request), /folder denied/);
  assert.equal(storage.files.length, 0);
});
