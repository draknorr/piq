/**
 * Format large numbers compactly (e.g., 1.2M, 5.6K)
 */
export function formatCompactNumber(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  if (n === 0) return '0';
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

/**
 * Format revenue in cents to USD string (e.g., $1.2M)
 */
export function formatRevenue(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '—';
  if (cents === 0) return '$0';
  const usd = cents / 100;
  if (usd >= 1_000_000_000) return `$${(usd / 1_000_000_000).toFixed(1)}B`;
  if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(1)}M`;
  if (usd >= 1_000) return `$${(usd / 1_000).toFixed(0)}K`;
  return `$${usd.toLocaleString()}`;
}

/**
 * Format hours (e.g., 15.2M hrs)
 */
export function formatHours(hours: number | null | undefined): string {
  if (hours === null || hours === undefined) return '—';
  if (hours === 0) return '0 hrs';
  if (hours >= 1_000_000) return `${(hours / 1_000_000).toFixed(1)}M hrs`;
  if (hours >= 1_000) return `${(hours / 1_000).toFixed(1)}K hrs`;
  return `${hours.toLocaleString()} hrs`;
}

/**
 * Calculate review percentage
 */
export function getReviewPercentage(
  positive: number | null | undefined,
  total: number | null | undefined
): number | null {
  if (positive === null || positive === undefined ||
      total === null || total === undefined || total === 0) return null;
  return Math.round((positive / total) * 100);
}
