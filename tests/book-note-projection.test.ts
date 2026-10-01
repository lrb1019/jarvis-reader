import test from "node:test";
import assert from "node:assert/strict";
import { projectLibraryBookNotes } from "../src/library/book-note-projection.ts";
test("a missing remembered note cannot stop other books from appearing and the error stays visible", () => {
  const books = [{ path: "missing.epub" }, { path: "ok.epub" }, { path: "new.epub" }];
  const result = projectLibraryBookNotes(books, book => {
    if (book.path === "missing.epub") throw Error("associated note missing");
    return book.path === "ok.epub" ? { path: "Notes/ok.md" } : null;
  });
  assert.deepEqual(result.notes, { "ok.epub": { path: "Notes/ok.md" } });
  assert.deepEqual(result.issues, { "missing.epub": "associated note missing" });
  assert.equal(books.length, 3);
});
test("reloading after note restoration clears the issue; deletion and empty scope discard stale projections", () => {
  const book = { path: "a.epub" };
  assert.equal(Object.keys(projectLibraryBookNotes([book], () => { throw Error("missing"); }).issues).length, 1);
  assert.deepEqual(projectLibraryBookNotes([book], () => "Notes/a.md"), { notes: { "a.epub": "Notes/a.md" }, issues: {} });
  assert.deepEqual(projectLibraryBookNotes([book], () => null), { notes: {}, issues: {} });
  assert.deepEqual(projectLibraryBookNotes([], () => "Notes/a.md"), { notes: {}, issues: {} });
});
