export function formatCompactNumber(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  if (n === 0) return '0';
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

export function formatPrice(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '—';
  if (cents === 0) return 'Free';
  const usd = cents / 100;
  return `$${usd.toFixed(2)}`;
}
