export const CHARACTER_CLASS_SUMMARY_LIMIT = 56;

/**
 * Staff characters can accumulate enough classes to make an account card
 * several rows taller than its neighbours. Keep the useful beginning of the
 * server summary while bounding the card's text.
 */
export function truncateClassSummary(
  summary: string | undefined,
  limit = CHARACTER_CLASS_SUMMARY_LIMIT,
) {
  if (!summary || summary.length <= limit) {
    return summary;
  }

  return `${summary.slice(0, Math.max(0, limit - 3)).trimEnd()}...`;
}
