import assert from "node:assert/strict";
import test from "node:test";

import { WordAssetService } from "../src/word-asset-service.ts";
import type { WordAssetMap } from "../src/types.ts";

const asset = {
  lemma: "fracture", title: "Fracture", kind: "word" as const, isWord: true,
  surfaceForms: ["fracture"], translation: "破裂", display: "破裂", phonetic: "", partOfSpeech: "", example: "",
  mastered: false, sources: [], created: "2026-07-11T00:00:00.000Z", updated: "2026-07-11T00:00:00.000Z",
};

test("word asset service commits once and notifies after a successful save", async () => {
  let saves = 0;
  let notifications = 0;
  const host = { settings: { wordAssets: {} as WordAssetMap }, persistWordAssetSidecar: async () => { saves += 1; }, onWordAssetsChanged: () => { notifications += 1; } };
  const service = new WordAssetService(host);

  await service.save(asset);
  assert.equal(host.settings.wordAssets.fracture?.translation, "破裂");
  assert.equal(saves, 1);
  assert.equal(notifications, 1);
});

test("word asset service restores memory when sidecar persistence fails", async () => {
  const existing = { fracture: asset };
  const host = { settings: { wordAssets: existing }, persistWordAssetSidecar: async () => { throw new Error("write failed"); } };
  const service = new WordAssetService(host);

  await assert.rejects(service.setMastered("fracture", true));
  assert.equal(host.settings.wordAssets, existing);
  assert.equal(host.settings.wordAssets.fracture?.mastered, false);
});

test("word asset service replaces the complete map with one persisted write", async () => {
  let saves = 0;
  const host = { settings: { wordAssets: {} as WordAssetMap }, persistWordAssetSidecar: async () => { saves += 1; } };
  const service = new WordAssetService(host);

  await service.replaceAll({ fracture: asset }, "auto-conflict-resolve");
  assert.equal(host.settings.wordAssets.fracture?.translation, "破裂");
  assert.equal(saves, 1);
});
