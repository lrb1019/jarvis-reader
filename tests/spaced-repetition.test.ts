import assert from "node:assert/strict";
import test from "node:test";
import { calculateNextReview } from "../src/word-book/SpacedRepetition.ts";

test("SM-2 spaced repetition calculation with default settings", () => {
  // Test new card (reviews = 0)
  const resultGood = calculateNextReview("Good", 0, 2.5, 0);
  assert.equal(resultGood.interval, 1);
  assert.equal(resultGood.reviews, 1);
  assert.equal(resultGood.ease, 2.5);

  const resultEasy = calculateNextReview("Easy", 0, 2.5, 0);
  assert.equal(resultEasy.interval, 4);
  assert.equal(resultEasy.ease, 2.65); // 2.5 + 0.15

  // Test subsequent cards (reviews > 1)
  const subsequentGood = calculateNextReview("Good", 3, 2.5, 2);
  assert.equal(subsequentGood.interval, 8); // Math.round(3 * 2.5) = 8
});

test("SM-2 spaced repetition calculation with custom startingEase", () => {
  // Option: startingEase = 3.0
  const opts = { startingEase: 3.0 };
  const resultGood = calculateNextReview("Good", 0, 2.5, 0, opts);
  assert.equal(resultGood.interval, 1);
  assert.equal(resultGood.ease, 3.0); // Starts at 3.0

  const subsequentGood = calculateNextReview("Good", 3, 3.0, 2, opts);
  assert.equal(subsequentGood.interval, 9); // Math.round(3 * 3.0) = 9
});

test("SM-2 spaced repetition calculation with custom easyBonus", () => {
  const opts = { easyBonus: 2.0 };
  // When reviews > 1 and rated Easy:
  const resultEasy = calculateNextReview("Easy", 3, 2.5, 2, opts);
  assert.equal(resultEasy.interval, 15); // Math.round(3 * 2.5 * 2.0) = 15
});

test("SM-2 spaced repetition calculation with custom lapseMultiplier", () => {
  const opts = { lapseMultiplier: 0.2 };
  // When rated Hard:
  const resultHard = calculateNextReview("Hard", 10, 2.5, 2, opts);
  assert.equal(resultHard.interval, 2); // Math.max(1, Math.floor(10 * 0.2)) = 2
});

test("SM-2 spaced repetition calculation with custom maxInterval", () => {
  const opts = { maxInterval: 10 };
  // Normal result would be 3 * 2.5 * 1.3 = 9.75 -> 10, capped at 10
  const result1 = calculateNextReview("Easy", 3, 2.5, 2, opts);
  assert.equal(result1.interval, 10);

  // Normal result would be 20 * 2.5 = 50, capped at 10
  const result2 = calculateNextReview("Good", 20, 2.5, 2, opts);
  assert.equal(result2.interval, 10);
});
