import type { WordAsset } from "../types";

export type ReviewResponse = "Hard" | "Good" | "Easy";

/**
 * SM-2 style Spaced Repetition Algorithm
 */
export function calculateNextReview(
  quality: ReviewResponse,
  currentInterval: number = 0,
  currentEase: number = 2.5,
  currentReviews: number = 0,
  options?: {
    startingEase?: number;
    easyBonus?: number;
    lapseMultiplier?: number;
    maxInterval?: number;
  }
): { nextReviewDate: string; interval: number; ease: number; reviews: number } {
  const startingEase = options?.startingEase ?? 2.5;
  const easyBonus = options?.easyBonus ?? 1.3;
  const lapseMultiplier = options?.lapseMultiplier ?? 0.5;
  const maxInterval = options?.maxInterval ?? 365;

  let nextInterval: number;
  let nextEase = currentReviews === 0 ? startingEase : currentEase;
  let nextReviews = currentReviews + 1;

  if (quality === "Hard") {
    // Hard: Interval resets or grows very slightly. Ease drops.
    nextInterval = Math.max(1, Math.floor(currentInterval * lapseMultiplier));
    nextEase = Math.max(1.3, nextEase - 0.15);
  } else if (quality === "Good") {
    // Good: Normal progression
    if (currentReviews === 0) {
      nextInterval = 1;
    } else if (currentReviews === 1) {
      nextInterval = 3;
    } else {
      nextInterval = Math.round(currentInterval * nextEase);
    }
  } else {
    // Easy: Large progression. Ease increases.
    if (currentReviews === 0) {
      nextInterval = 4;
    } else if (currentReviews === 1) {
      nextInterval = 7;
    } else {
      nextInterval = Math.round(currentInterval * nextEase * easyBonus);
    }
    nextEase = nextEase + 0.15;
  }

  // Ensure interval is at least 1 day
  nextInterval = Math.max(1, nextInterval);

  // Cap at maxInterval
  nextInterval = Math.min(maxInterval, nextInterval);

  // Calculate next review date
  const now = new Date();
  now.setDate(now.getDate() + nextInterval);
  const nextReviewDate = now.toISOString().split("T")[0]; // YYYY-MM-DD

  return {
    nextReviewDate,
    interval: nextInterval,
    ease: nextEase,
    reviews: nextReviews,
  };
}

export function getDueCards(assets: WordAsset[], bookFilter?: string | null): WordAsset[] {
  const today = new Date().toISOString().split("T")[0];
  
  return assets.filter(asset => {
    // Skip mastered words
    if (asset.mastered) return false;

    // Filter by book if specified
    if (bookFilter && bookFilter !== "all") {
      const isInBook = asset.sources?.some(source => source.bookPath === bookFilter);
      if (!isInBook) return false;
    }

    // Due if no review date set (new word) or review date is today or in the past
    if (!asset.nextReviewDate || asset.nextReviewDate <= today) {
      return true;
    }

    return false;
  });
}
