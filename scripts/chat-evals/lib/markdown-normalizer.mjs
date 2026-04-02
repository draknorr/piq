const IMAGE_PATTERN = /!\[([^\]]*)\]\(([^)]+)\)/g;
const LINK_PATTERN = /(^|[^!])\[([^\]]+)\]\(([^)]+)\)/g;
const HEADING_PATTERN = /^\s{0,3}#{1,6}\s+/gm;
const LIST_ITEM_PATTERN = /^\s*(?:[-*+]|\d+\.)\s+/gm;

export function normalizeMarkdownForScoring(markdown) {
  const raw = String(markdown || '').replace(/\r/g, '');
  const renderedText = raw
    .replace(IMAGE_PATTERN, (_match, alt) => String(alt || '').trim())
    .replace(LINK_PATTERN, (_match, prefix, label) => `${prefix}${String(label || '').trim()}`)
    .replace(/^`{3,}[\w-]*\s*$/gm, '')
    .replace(/^~{3,}[\w-]*\s*$/gm, '')
    .split('\n')
    .map(normalizeMarkdownLine)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return {
    renderedMetrics: {
      headingCount: countPatternMatches(raw, HEADING_PATTERN),
      linkCount: countMarkdownLinks(raw),
      listItemCount: countPatternMatches(raw, LIST_ITEM_PATTERN),
      tableRowCount: countMarkdownTableRows(raw),
    },
    renderedText,
  };
}

function normalizeMarkdownLine(line) {
  const trimmed = String(line || '');

  if (isMarkdownTableSeparator(trimmed)) {
    return '';
  }

  if (looksLikeMarkdownTableRow(trimmed)) {
    return trimmed
      .split('|')
      .map((cell) => stripInlineMarkdown(cell.trim()))
      .filter(Boolean)
      .join(' | ');
  }

  return stripInlineMarkdown(
    trimmed
      .replace(/^\s{0,3}#{1,6}\s+/, '')
      .replace(/^\s*>\s?/, '')
      .replace(/^\s*(?:[-*+]|\d+\.)\s+/, '')
  );
}

function stripInlineMarkdown(value) {
  return String(value || '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function countPatternMatches(value, pattern) {
  return [...String(value || '').matchAll(pattern)].length;
}

function countMarkdownLinks(value) {
  return [...String(value || '').matchAll(LINK_PATTERN)].length;
}

function countMarkdownTableRows(value) {
  const lines = String(value || '').split('\n');
  let count = 0;
  let previousWasTableRow = false;
  let seenHeader = false;

  for (const line of lines) {
    if (!looksLikeMarkdownTableRow(line)) {
      previousWasTableRow = false;
      seenHeader = false;
      continue;
    }

    if (isMarkdownTableSeparator(line)) {
      previousWasTableRow = true;
      continue;
    }

    if (!previousWasTableRow) {
      previousWasTableRow = true;
      seenHeader = true;
      continue;
    }

    if (seenHeader) {
      count += 1;
    }
  }

  return count;
}

function looksLikeMarkdownTableRow(line) {
  const text = String(line || '').trim();
  if (!text.includes('|')) {
    return false;
  }
  return text.split('|').filter((part) => part.trim().length > 0).length >= 2;
}

function isMarkdownTableSeparator(line) {
  const text = String(line || '').trim();
  if (!looksLikeMarkdownTableRow(text)) {
    return false;
  }

  const compact = text.replace(/\|/g, '').replace(/:/g, '').replace(/\s+/g, '');
  return compact.length > 0 && /^-+$/.test(compact);
}
