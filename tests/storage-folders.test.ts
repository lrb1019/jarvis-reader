import test from "node:test";
import assert from "node:assert/strict";
import { configureStorageFolders, DEFAULT_STORAGE_FOLDERS, ensureStorageFolders, isBookInFolder, validateFolderPath } from "../src/storage-folders.ts";
function fixture(entries: Record<string, string> = {}) {
  const files = new Map(Object.entries(entries));
  const created: string[] = [];
  return { files, created,
    stat: async (path: string) => files.has(path) ? { type: files.get(path)! } : null,
    mkdir: async (path: string) => { files.set(path, "folder"); created.push(path); }
  };
}
function defaultStorageFolders(bookFolder: string) {
  return { bookFolder, ...DEFAULT_STORAGE_FOLDERS };
}
test("default directory names are independent of the book root and book scope uses a folder boundary", () => {
  assert.deepEqual(DEFAULT_STORAGE_FOLDERS, {
    bookNoteFolder: "Reading Notes", knowledgeNoteFolder: "Knowledge Notes", customCoverFolder: "Cover"
  });
  assert.equal(isBookInFolder("Books/a.epub", "Books"), true);
  assert.equal(isBookInFolder("Books/nested/a.epub", "Books"), true);
  assert.equal(isBookInFolder("Bookshelf/a.epub", "Books"), false);
  assert.equal(isBookInFolder("elsewhere/a.epub"), true);
});
test("missing nested and custom directories are created without touching existing content; repeat is idempotent", async () => {
  const f = fixture({ Books: "folder", "Books/a.epub": "file" });
  await ensureStorageFolders(f, Object.values(defaultStorageFolders("Books")));
  await ensureStorageFolders(f, ["Books/My Notes/Quotes", "Elsewhere/Covers"]);
  const count = f.created.length;
  await ensureStorageFolders(f, Object.values(defaultStorageFolders("Books")));
  assert.equal(f.created.length, count);
  assert.equal(f.files.get("Books/a.epub"), "file");
  assert.equal(f.files.get("Books/My Notes/Quotes"), "folder");
});
test("file collisions and invalid paths fail before directory writes", async () => {
  const f = fixture({ "Cover": "file" });
  await assert.rejects(ensureStorageFolders(f, Object.values(defaultStorageFolders("Books"))), /占用/);
  assert.equal(f.created.length, 0);
  for (const path of ["../Books", "/tmp/Books", "Books/../x", "C:/Books", "Books/./Notes"]) {
    assert.throws(() => validateFolderPath(path));
  }
});
test("creation failure remains visible; retry reuses already created empty directories", async () => {
  const f = fixture(); let fail = true;
  const storage = { stat: f.stat, mkdir: async (path: string) => {
    if (path.endsWith("Cover") && fail) throw new Error("disk full");
    await f.mkdir(path);
  } };
  await assert.rejects(ensureStorageFolders(storage, Object.values(defaultStorageFolders("Books"))), /disk full/);
  fail = false;
  await ensureStorageFolders(storage, Object.values(defaultStorageFolders("Books")));
  assert.equal(f.created.filter(p => p === "Books").length, 1);
  assert.equal(f.files.get("Cover"), "folder");
});

test("settings save failure restores legacy paths; successful save reloads custom paths without rewriting user content", async () => {
  const f = fixture({ "Old/notes.md": "file" });
  const settings = { bookNoteFolder: "", knowledgeNoteFolder: "知识库/想法", customCoverFolder: "00-Attachment" };
  const before = structuredClone(settings);
  const draft = { ...defaultStorageFolders("Books"), knowledgeNoteFolder: "Books/Ideas" };
  await assert.rejects(configureStorageFolders(f, settings, draft, async () => { throw new Error("save failed"); }), /save failed/);
  assert.deepEqual(settings, before);
  let saved = "";
  await configureStorageFolders(f, settings, draft, async () => { saved = JSON.stringify(settings); });
  assert.deepEqual(JSON.parse(saved), draft);
  assert.equal(f.files.get("Old/notes.md"), "file");
});

test("changing only the book root preserves all three custom output paths", async () => {
  const f = fixture();
  const settings = { bookFolder: "Books", bookNoteFolder: "Notes/Reading", knowledgeNoteFolder: "Ideas", customCoverFolder: "Attachments/Covers" };
  await configureStorageFolders(f, settings, { ...settings, bookFolder: "Other Books" }, async () => {});
  assert.equal(settings.bookFolder, "Other Books");
  assert.equal(settings.bookNoteFolder, "Notes/Reading");
  assert.equal(settings.knowledgeNoteFolder, "Ideas");
  assert.equal(settings.customCoverFolder, "Attachments/Covers");
});
