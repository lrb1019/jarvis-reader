import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";

// Exercise the real host adapter with in-memory Obsidian file/storage substitutes.
const compiled = await build({
  stdin: { contents: 'export { createBookNoteOperations } from "./src/book-note-operations.ts"; export { TFile } from "obsidian";', resolveDir: process.cwd() },
  bundle: true, write: false, platform: "node", format: "esm",
  plugins: [{ name: "memory-obsidian", setup(builder) {
    builder.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "memory" }));
    builder.onLoad({ filter: /.*/, namespace: "memory" }, () => ({ contents: 'export class TFile { constructor(path) { this.path=path; const name=path.split("/").pop(); this.extension=name.split(".").pop(); this.basename=name.slice(0,-this.extension.length-1); this.parent={path:path.split("/").slice(0,-1).join("/")}; } } export class Notice {} export class Modal {} export class Setting {} export function loadPdfJs() {}' }));
  } }],
});
const { createBookNoteOperations, TFile } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`);

function storage() {
  const files = new Map();
  const content = new Map();
  const frontmatter = { reading_time: "旧值", custom: "保留" };
  let created = 0;
  let written = 0;
  const app = {
    vault: {
      getAbstractFileByPath: (path: string) => files.get(path) || null,
      getMarkdownFiles: () => [...files.values()].filter(f => f.extension === "md"),
      create: async (path: string, text: string) => { created++; const file = new TFile(path); files.set(path, file); content.set(path, text); return file; },
    },
    metadataCache: { getFileCache: () => ({ frontmatter: {} }) },
    fileManager: { processFrontMatter: async (_file: unknown, update: (metadata: typeof frontmatter) => void) => { written++; update(frontmatter); } },
  };
  return { app, files, content, frontmatter, counts: () => ({ created, written }) };
}

test("reading time adapter uses the remembered note and preserves other metadata", async () => {
  const memory = storage();
  const book = new TFile("books/A.epub");
  memory.files.set("notes/Renamed.md", new TFile("notes/Renamed.md"));
  await createBookNoteOperations(memory.app).projectReadingTime(book, 3660, { bookNotePaths: { [book.path]: "notes/Renamed.md" } });
  assert.deepEqual(memory.frontmatter, { reading_time: "1小时1分钟", custom: "保留" });
  assert.deepEqual(memory.counts(), { created: 0, written: 1 });
});

test("missing remembered note stops projection instead of creating a replacement", async () => {
  const memory = storage();
  const book = new TFile("books/A.epub");
  await assert.rejects(createBookNoteOperations(memory.app).projectReadingTime(book, 60, { bookNotePaths: { [book.path]: "notes/Missing.md" } }), /关联的读书笔记不存在/);
  assert.deepEqual(memory.counts(), { created: 0, written: 0 });
  assert.equal(memory.frontmatter.reading_time, "旧值");
});

test("unassociated book still creates the usual note before projecting duration", async () => {
  const memory = storage();
  await createBookNoteOperations(memory.app).projectReadingTime(new TFile("books/A.epub"), 65, {});
  assert.ok(memory.content.has("books/A.md"));
  assert.equal(memory.frontmatter.reading_time, "1分钟");
  assert.deepEqual(memory.counts(), { created: 1, written: 1 });
});

test("metadata write failure propagates without overwriting the stored projection", async () => {
  const memory = storage();
  const book = new TFile("books/A.epub");
  memory.files.set("books/A.md", new TFile("books/A.md"));
  memory.app.fileManager.processFrontMatter = async () => { throw Error("write failed"); };
  await assert.rejects(createBookNoteOperations(memory.app).projectReadingTime(book, 65, {}), /write failed/);
  assert.equal(memory.frontmatter.reading_time, "旧值");
  assert.equal(memory.counts().created, 0);
});
