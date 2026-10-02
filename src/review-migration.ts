import type { WordAssetMap } from "./types.ts";

const REVIEW_ASSET_FIELDS = ["mastered", "nextReviewDate", "interval", "ease", "reviews", "reviewTimeMs"] as const;

function isLegacySentenceAsset(key: string, asset: RecordValue): boolean {
  return key.startsWith("sentence-") || asset.kind === "sentence" || asset.isWord === false;
}
const REVIEW_SETTING_FIELDS = ["autoPlayAudioOnReview", "wordReviewStats", "sm2StartingEase", "sm2EasyBonus", "sm2LapseMultiplier", "sm2MaxInterval"] as const;

type RecordValue = Record<string, unknown>;

function hasOwn(object: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function removeReviewFields<T extends RecordValue>(value: T, fields: readonly string[]): { value: T; removed: RecordValue } {
  const next = { ...value };
  const removed: RecordValue = {};
  for (const field of fields) {
    if (hasOwn(next, field)) {
      removed[field] = next[field];
      delete next[field];
    }
  }
  return { value: next as T, removed };
}

export function removeReviewData(
  wordAssets: WordAssetMap,
  settings: RecordValue,
): { wordAssets: WordAssetMap; settings: RecordValue; changed: boolean } {
  let changed = false;
  const nextAssets: WordAssetMap = {};
  for (const [key, asset] of Object.entries(wordAssets)) {
    const record = asset as unknown as RecordValue;
    if (isLegacySentenceAsset(key, record)) {
      changed = true;
      continue;
    }
    const result = removeReviewFields(record, REVIEW_ASSET_FIELDS);
    delete (result.value as RecordValue).isWord;
    nextAssets[key] = result.value as unknown as WordAssetMap[string];
    changed ||= Object.keys(result.removed).length > 0 || hasOwn(record, "isWord");
  }
  const settingsResult = removeReviewFields(settings, REVIEW_SETTING_FIELDS);
  const highlightColors = settingsResult.value.highlightColors;
  if (highlightColors && typeof highlightColors === "object" && hasOwn(highlightColors, "sentence")) {
    settingsResult.value.highlightColors = removeReviewFields(highlightColors as RecordValue, ["sentence"]).value;
    changed = true;
  }
  changed ||= Object.keys(settingsResult.removed).length > 0;
  return { wordAssets: changed ? nextAssets : wordAssets, settings: changed ? settingsResult.value : settings, changed };
}
