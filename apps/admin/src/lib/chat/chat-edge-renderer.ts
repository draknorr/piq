import type { ToolCall } from '@/lib/llm/types';
import type { ToolAnswerContractSummary } from '@/lib/chat/chat-context-types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asArrayOfRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => isRecord(item))
    : [];
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function formatGameLink(row: Record<string, unknown>): string {
  const appid = typeof row.appid === 'number' ? row.appid : null;
  const name =
    typeof row.name === 'string'
      ? row.name
      : typeof row.appName === 'string'
        ? row.appName
        : 'Unknown';

  if (name.startsWith('[')) {
    return name;
  }

  return appid ? `[${name}](game:${appid})` : name;
}

function formatDate(value: unknown): string {
  if (typeof value !== 'string') {
    return 'Unknown';
  }

  return value.slice(0, 10);
}

function formatNumber(value: unknown): string {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 'n/a';
  }

  if (!Number.isInteger(value)) {
    return value.toFixed(2);
  }

  return value.toLocaleString();
}

function formatPercent(value: unknown): string {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 'n/a';
  }

  return `${value.toFixed(value % 1 === 0 ? 0 : 1)}%`;
}

function formatCurrencyDollars(value: unknown): string {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 'n/a';
  }

  return `$${value.toFixed(2)}`;
}

function formatCurrencyCents(value: unknown): string {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 'n/a';
  }

  return `$${(value / 100).toFixed(2)}`;
}

function formatRowValue(row: Record<string, unknown>, column: string): string {
  switch (column) {
    case 'Game':
      return formatGameLink(row);
    case 'Peak CCU':
      return formatNumber(row.ccuPeak);
    case 'Momentum Score':
      return formatNumber(row.momentumScore);
    case 'Review Velocity (7d)':
      return formatNumber(row.velocity7d);
    case 'Review Velocity (30d)':
      return formatNumber(row.velocity30d);
    case 'Reviews Added (7d)':
      return formatNumber(row.reviewsAdded7d);
    case 'Reviews Added (30d)':
      return formatNumber(row.reviewsAdded30d);
    case 'Total Reviews':
      return formatNumber(row.totalReviews);
    case 'Review %':
    case 'Review Percentage':
      return formatPercent(row.reviewPercentage ?? row.reviewScore);
    case 'Price':
      return row.priceDollars != null ? formatCurrencyDollars(row.priceDollars) : formatCurrencyCents(row.priceCents);
    case 'Discount':
      return formatPercent(row.discountPercent);
    default: {
      const value = row[column];
      if (typeof value === 'number') {
        return formatNumber(value);
      }
      if (typeof value === 'string') {
        return value;
      }
      return 'n/a';
    }
  }
}

function buildMarkdownTable(columns: string[], rows: Record<string, unknown>[]): string {
  const header = `| ${columns.join(' | ')} |`;
  const divider = `| ${columns.map(() => '---').join(' | ')} |`;
  const body = rows.map((row) => `| ${columns.map((column) => formatRowValue(row, column)).join(' | ')} |`);
  return [header, divider, ...body].join('\n');
}

function renderTrendResult(result: Record<string, unknown>): string | null {
  const rows = asArrayOfRecords(result.results);
  if (rows.length === 0) {
    return null;
  }

  const rankingLabel = typeof result.ranking_label === 'string' ? result.ranking_label : 'Ranking';
  const timeframeLabel =
    typeof result.timeframe_label === 'string' ? result.timeframe_label : 'the requested window';
  const rankingDefinition =
    typeof result.ranking_definition === 'string' ? result.ranking_definition : null;
  const recommendedColumns = asStringArray(result.recommended_columns);
  const columns = recommendedColumns.length > 0
    ? recommendedColumns
    : ['Game', rankingLabel, 'Total Reviews', 'Review %'];

  const intro = `Here are the top results by **${rankingLabel}** for **${timeframeLabel}**.`;
  const definition = rankingDefinition ? `\n\n${rankingDefinition}` : '';

  return `${intro}${definition}\n\n${buildMarkdownTable(columns, rows.slice(0, 10))}`;
}

function renderTimelineEventDetail(event: Record<string, unknown>): string {
  if (typeof event.beforeText === 'string' || typeof event.afterText === 'string') {
    const beforeText = typeof event.beforeText === 'string' ? event.beforeText : 'n/a';
    const afterText = typeof event.afterText === 'string' ? event.afterText : 'n/a';
    return `${beforeText} -> ${afterText}`;
  }

  const added = asStringArray(event.added);
  if (added.length > 0) {
    return `Added: ${added.join(', ')}`;
  }

  const removed = asStringArray(event.removed);
  if (removed.length > 0) {
    return `Removed: ${removed.join(', ')}`;
  }

  if (typeof event.note === 'string' && event.note.trim().length > 0) {
    return event.note;
  }

  return 'Structured change detected';
}

function renderGameTimelineResult(result: Record<string, unknown>): string | null {
  const app = isRecord(result.app) ? result.app : null;
  const events = asArrayOfRecords(result.events);

  if (!app || events.length === 0) {
    return null;
  }

  const title = formatGameLink(app);
  const intro = `Here are the recent Steam changes for **${title}**.`;
  const rows = events.slice(0, 8).map((event) => ({
    appid: app.appid,
    name: app.name,
    Date: formatDate(event.occurredAt),
    Change: typeof event.label === 'string' ? event.label : typeof event.changeType === 'string' ? event.changeType : 'Change',
    Details: renderTimelineEventDetail(event),
  }));

  return `${intro}\n\n${buildMarkdownTable(['Date', 'Change', 'Details'], rows)}`;
}

function formatWindowSummary(window: Record<string, unknown> | null): string[] {
  if (!window) {
    return [];
  }

  const parts: string[] = [];
  if (window.priceCents != null) {
    parts.push(`Price: ${formatCurrencyCents(window.priceCents)}`);
  }
  if (window.discountPercent != null) {
    parts.push(`Discount: ${formatPercent(window.discountPercent)}`);
  }
  if (window.totalReviews != null) {
    parts.push(`Total Reviews: ${formatNumber(window.totalReviews)}`);
  }
  if (window.reviewScore != null) {
    parts.push(`Review Score: ${formatNumber(window.reviewScore)}/10`);
  }
  if (window.ccuPeak != null) {
    parts.push(`Peak CCU: ${formatNumber(window.ccuPeak)}`);
  }
  return parts;
}

function renderBeforeAfterResult(result: Record<string, unknown>): string | null {
  const app = isRecord(result.app) ? result.app : null;
  const selectedActivity = isRecord(result.selectedActivity) ? result.selectedActivity : null;
  const windows = isRecord(result.windows) ? result.windows : null;
  const diffs = asArrayOfRecords(result.diffs);

  if (!app || !selectedActivity || !windows) {
    return null;
  }

  const baseline = isRecord(windows.baseline30d) ? windows.baseline30d : null;
  const response = isRecord(windows.response30d) ? windows.response30d : null;
  const whatChanged = diffs
    .slice(0, 3)
    .map((diff) => {
      const label = typeof diff.label === 'string' ? diff.label : 'Change';
      const detail = renderTimelineEventDetail(diff);
      return `- ${label}: ${detail}`;
    })
    .join('\n');

  return [
    `### What Changed`,
    selectedActivity.headline ? `${selectedActivity.headline}` : `A major Steam page update landed for **${formatGameLink(app)}**.`,
    whatChanged || '- Structured change set detected.',
    '',
    '### Before',
    ...formatWindowSummary(baseline).map((line) => `- ${line}`),
    '',
    '### After',
    ...formatWindowSummary(response).map((line) => `- ${line}`),
  ].join('\n');
}

function renderRecentNewsDigestResult(result: Record<string, unknown>): string | null {
  const items = asArrayOfRecords(result.items);
  if (items.length === 0) {
    return null;
  }

  const rows = items.slice(0, 6).map((item) => ({
    appid: item.appid,
    name:
      typeof item.appName === 'string'
        ? item.appName
        : typeof item.name === 'string'
          ? item.name
          : 'Unknown',
    Date: formatDate(item.publishedAt ?? item.firstSeenAt),
    Headline: typeof item.title === 'string' && item.title.trim().length > 0 ? item.title : 'Steam news update',
    Summary:
      typeof item.excerpt === 'string' && item.excerpt.trim().length > 0
        ? item.excerpt
        : typeof item.bodyPreview === 'string' && item.bodyPreview.trim().length > 0
          ? item.bodyPreview
          : 'News body available in the digest.',
  }));

  return `Here are the most recent Steam news updates.\n\n${buildMarkdownTable(['Game', 'Date', 'Headline', 'Summary'], rows)}`;
}

export function renderToolResultForChat(
  toolCall: ToolCall,
  result: Record<string, unknown>,
  contract: ToolAnswerContractSummary | null
): string | null {
  if (!contract?.sufficientToAnswer || contract.needsClarification || contract.noMatch) {
    return null;
  }

  switch (toolCall.name) {
    case 'screen_games':
    case 'discover_trending':
      return renderTrendResult(result);
    case 'get_game_change_timeline':
      return renderGameTimelineResult(result);
    case 'get_recent_news_digest':
      return renderRecentNewsDigestResult(result);
    case 'compare_change_before_after':
      return renderBeforeAfterResult(result);
    default:
      return null;
  }
}
