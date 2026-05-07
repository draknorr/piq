import type { UnreleasedGame } from './unreleased-types';
import {
  DEFAULT_UNRELEASED_COLUMNS,
  UNRELEASED_COLUMN_DEFINITIONS,
  sanitizeUnreleasedColumns,
  type UnreleasedColumnExportField,
  type UnreleasedColumnId,
} from './unreleased-columns';

export function escapeCsvValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = Array.isArray(value) ? value.join(' | ') : String(value);
  if (text.includes(',') || text.includes('"') || text.includes('\n') || text.includes('\r')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function steamAppUrl(appid: number): string {
  return `https://store.steampowered.com/app/${appid}`;
}

export function publisheriqAppUrl(appid: number): string {
  return `/apps/${appid}`;
}

function uniqueExportFields(columns: readonly UnreleasedColumnId[]): UnreleasedColumnExportField[] {
  const fields: UnreleasedColumnExportField[] = [
    { header: 'appid', getValue: (game) => game.appid },
    { header: 'name', getValue: (game) => game.name },
    { header: 'steam_url', getValue: (game) => steamAppUrl(game.appid) },
    { header: 'publisheriq_url', getValue: (game) => publisheriqAppUrl(game.appid) },
  ];
  const seen = new Set(fields.map((field) => field.header));

  for (const columnId of sanitizeUnreleasedColumns(columns)) {
    const definition = UNRELEASED_COLUMN_DEFINITIONS[columnId];
    for (const field of definition.exportFields) {
      if (seen.has(field.header)) continue;
      seen.add(field.header);
      fields.push(field);
    }
  }

  return fields;
}

export function generateUnreleasedCsv(
  games: UnreleasedGame[],
  visibleColumns: readonly UnreleasedColumnId[] = DEFAULT_UNRELEASED_COLUMNS
): string {
  const fields = uniqueExportFields(visibleColumns);
  const headers = fields.map((field) => field.header);
  const rows = games.map((game) => fields.map((field) => field.getValue(game)));

  return [headers, ...rows]
    .map((row) => row.map(escapeCsvValue).join(','))
    .join('\n');
}

export function downloadCsv(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function unreleasedCsvFilename(scope: 'selected' | 'visible'): string {
  return `unreleased-games-${scope}-${new Date().toISOString().slice(0, 10)}.csv`;
}
