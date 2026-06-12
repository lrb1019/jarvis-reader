import assert from "node:assert/strict";
import test from "node:test";
import {
  loadSettings,
  normalizeSettings,
  saveSettings,
  toPersistedSettings,
} from "../src/storage/settings.ts";
import {
  createSettings,
  createWordAsset,
  MemorySettingsStore,
} from "./storage-fixtures.ts";

test("normalizes settings and refuses to restore legacy wordAssets", async () => {
  const defaults = createSettings();
  const loaded = {
    scrolledView: true,
    wordAssets: { legacy: createWordAsset("legacy") },
    wordNoteFolder: "\\09 Books\\Words\\",
    autoHighlightFolders: ["\\09 Books\\", ""],
    translationApi: {
      provider: "custom",
      baseUrl: "https://api.anthropic.test",
      apiKey: 123,
      model: null,
    },
    experimentalInstantTranslation: {
      enabled: true,
      localDictionaryPath: "obsolete.json",
    },
    sidebarPaneSplit: 99,
    localDictionary: { obsolete: true },
  };

  const settings = normalizeSettings(loaded, defaults);
  assert.equal(settings.scrolledView, true);
  assert.deepEqual(settings.wordAssets, {});
  assert.equal(settings.wordNoteFolder, "09 Books/Words");
  assert.deepEqual(settings.autoHighlightFolders, ["09 Books"]);
  assert.deepEqual(settings.translationApi, {
    provider: "anthropic",
    baseUrl: "https://api.anthropic.test",
    apiKey: "123",
    model: "",
  });
  assert.deepEqual(settings.experimentalInstantTranslation, { enabled: true });
  assert.equal(settings.sidebarPaneSplit, 75);

  const store = new MemorySettingsStore(loaded);
  assert.deepEqual(await loadSettings(store, defaults), settings);
});

test("persisted settings never contain wordAssets", async () => {
  const settings = createSettings();
  settings.wordAssets.compound = createWordAsset();
  const persisted = toPersistedSettings(settings) as Record<string, unknown>;
  assert.equal("wordAssets" in persisted, false);

  const store = new MemorySettingsStore({});
  await saveSettings(store, settings);
  assert.equal("wordAssets" in (store.saved as Record<string, unknown>), false);
});
