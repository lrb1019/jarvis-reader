import assert from "node:assert/strict";
import test from "node:test";
import {
  INDEX_PATHS,
  IndexDataError,
  IndexRepository,
} from "../src/storage/index-repository.ts";
import {
  createSettings,
  createWordAsset,
  MemoryTextFileStore,
} from "./storage-fixtures.ts";

const now = () => "2026-06-12T12:00:00.000Z";

test("missing word sidecar initializes an empty version 2 authority", async () => {
  const store = new MemoryTextFileStore();
  const settings = createSettings();
  settings.wordAssets.legacy = createWordAsset("legacy");

  const result = await new IndexRepository(store, now).restore(settings);
  assert.deepEqual(result, {
    restoredHighlightBooks: 0,
    initializedWordAssetSidecar: true,
  });
  assert.deepEqual(settings.wordAssets, {});
  assert.deepEqual(JSON.parse(await store.read(INDEX_PATHS.wordAssets)), {
    version: 2,
    updated: now(),
    wordAssets: {},
  });
});

test("restore replaces words but only fills empty highlight lists", async () => {
  const store = new MemoryTextFileStore();
  store.files.set(
    INDEX_PATHS.highlights,
    JSON.stringify({
      version: 1,
      updated: now(),
      bookHighlights: {
        "empty.epub": [
          {
            id: "ar-1",
            bookPath: "empty.epub",
            bookTitle: "Empty",
            chapterTitle: "One",
            cfiRange: "epubcfi(1)",
            quote: "quote",
            comment: "",
            notePath: "Empty.md",
            blockId: "ar-1",
            created: now(),
            updated: "",
          },
        ],
        "kept.epub": [{ id: "sidecar" }],
      },
    }),
  );
  store.files.set(
    INDEX_PATHS.wordAssets,
    JSON.stringify({
      version: 2,
      updated: now(),
      wordAssets: { Compound: createWordAsset("Compound") },
    }),
  );
  const settings = createSettings();
  settings.bookHighlights["empty.epub"] = [];
  settings.bookHighlights["kept.epub"] = [
    {
      id: "current",
      bookPath: "kept.epub",
      bookTitle: "Kept",
      chapterTitle: "Now",
      cfiRange: "epubcfi(current)",
      quote: "current",
      comment: "",
      notePath: "Kept.md",
      blockId: "current",
      created: now(),
    },
  ];
  settings.wordAssets.old = createWordAsset("old");

  const result = await new IndexRepository(store, now).restore(settings);
  assert.equal(result.restoredHighlightBooks, 1);
  assert.equal(settings.bookHighlights["empty.epub"]?.[0]?.id, "ar-1");
  assert.equal(settings.bookHighlights["kept.epub"]?.[0]?.id, "current");
  assert.deepEqual(Object.keys(settings.wordAssets), ["compound"]);
});

test("corrupt word sidecar fails loudly and clears in-memory words", async () => {
  const store = new MemoryTextFileStore();
  store.files.set(INDEX_PATHS.wordAssets, "{not-json");
  const settings = createSettings();
  settings.wordAssets.compound = createWordAsset();

  await assert.rejects(
    () => new IndexRepository(store, now).restore(settings),
    IndexDataError,
  );
  assert.deepEqual(settings.wordAssets, {});
});

test("wrong word sidecar schema also fails without data.json fallback", async () => {
  const store = new MemoryTextFileStore();
  store.files.set(
    INDEX_PATHS.wordAssets,
    JSON.stringify({ version: 2, updated: now(), entries: {} }),
  );
  const settings = createSettings();
  settings.wordAssets.legacy = createWordAsset("legacy");

  await assert.rejects(
    () => new IndexRepository(store, now).restore(settings),
    /version 2 schema/,
  );
  assert.deepEqual(settings.wordAssets, {});
});

test("persisted deletion stays deleted after reload", async () => {
  const store = new MemoryTextFileStore();
  const settings = createSettings();
  settings.wordAssets.compound = createWordAsset();
  const repository = new IndexRepository(store, now);
  await repository.persist(settings, "save");

  delete settings.wordAssets.compound;
  await repository.persist(settings, "delete");

  const reloaded = createSettings();
  reloaded.wordAssets.compound = createWordAsset();
  await new IndexRepository(store, now).restore(reloaded);
  assert.deepEqual(reloaded.wordAssets, {});
});

test("persist writes normalized highlight metadata", async () => {
  const store = new MemoryTextFileStore();
  const settings = createSettings();
  settings.bookHighlights["Book.epub"] = [
    {
      id: "ar-1",
      bookPath: "Book.epub",
      bookTitle: "Book",
      chapterTitle: "Chapter",
      cfiRange: "epubcfi(1)",
      quote: "Quote",
      comment: "Thought",
      notePath: "Book.md",
      blockId: "ar-1",
      created: now(),
    },
  ];

  await new IndexRepository(store, now).persist(settings, "save-highlight");
  const payload = JSON.parse(await store.read(INDEX_PATHS.highlights));
  assert.deepEqual(payload, {
    version: 1,
    updated: now(),
    bookHighlights: {
      "Book.epub": [
        {
          ...settings.bookHighlights["Book.epub"]?.[0],
          updated: "",
        },
      ],
    },
  });
});

test("write failures reject instead of reporting success", async () => {
  const store = new MemoryTextFileStore();
  store.failWritePath = INDEX_PATHS.wordAssets;
  await assert.rejects(
    () => new IndexRepository(store, now).persist(createSettings(), "save"),
    /Write failed/,
  );
});

test("index log appends only when counts change", async () => {
  const store = new MemoryTextFileStore();
  const settings = createSettings();
  const repository = new IndexRepository(store, now);
  await repository.persist(settings, "save");
  await repository.persist(settings, "save-again");
  settings.wordAssets.compound = createWordAsset();
  await repository.persist(settings, "save-word");

  const lines = (await store.read(INDEX_PATHS.log)).trim().split("\n");
  assert.equal(lines.length, 2);
  assert.deepEqual(lines.map((line) => JSON.parse(line).reason), ["save", "save-word"]);
});
