import assert from "node:assert/strict";
import test from "node:test";
import { buildWordAudioUrl } from "../src/core/word-audio.ts";

test("builds word and phrase audio URLs with the selected accent", () => {
  const template = "https://example.test/audio={{word}}&type={{type}}&accent={{accent}}";
  assert.equal(
    buildWordAudioUrl(template, "compound", "us"),
    "https://example.test/audio=compound&type=2&accent=us",
  );
  assert.equal(
    buildWordAudioUrl(template, "atomic habits", "uk"),
    "https://example.test/audio=atomic%20habits&type=1&accent=uk",
  );
});
