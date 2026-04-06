const NON_WORD_PATTERN = /[^a-z0-9]+/g;

export function normalizeText(value: string | null | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(NON_WORD_PATTERN, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function containsWholePhrase(
  haystack: string,
  phrase: string
): boolean {
  const normalizedHaystack = normalizeText(haystack);
  const normalizedPhrase = normalizeText(phrase);

  if (!normalizedHaystack || !normalizedPhrase) {
    return false;
  }

  const pattern = new RegExp(`(^| )${escapeRegex(normalizedPhrase)}( |$)`);
  return pattern.test(normalizedHaystack);
}

export function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = normalizeText(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    result.push(value.trim());
  }

  return result;
}
