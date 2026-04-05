'use client';

import Link from 'next/link';
import type { Alignment } from './parsers';

interface MarkdownTableProps {
  headers: string[];
  rows: string[][];
  alignments: Alignment[];
}

export function MarkdownTable({ headers, rows, alignments }: MarkdownTableProps) {
  const getAlignmentClass = (alignment: Alignment): string => {
    switch (alignment) {
      case 'center':
        return 'text-center';
      case 'right':
        return 'text-right';
      default:
        return 'text-left';
    }
  };

  return (
    <div className="my-3 overflow-hidden rounded-lg border border-border-subtle">
      <div className="overflow-x-auto scrollbar-thin">
        <table className="w-full text-body-sm">
          <thead>
            <tr className="bg-surface-overlay/50">
              {headers.map((header, idx) => (
                <th
                  key={idx}
                  className={`
                    px-4 py-2.5 font-medium text-text-secondary
                    border-b border-border-subtle
                    ${getAlignmentClass(alignments[idx] || 'left')}
                    first:pl-4 last:pr-4
                  `}
                >
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle/50">
            {rows.map((row, rowIdx) => (
              <tr
                key={rowIdx}
                className={`
                  transition-colors duration-150
                  hover:bg-surface-overlay/30
                  ${rowIdx % 2 === 0 ? 'bg-transparent' : 'bg-surface-elevated/30'}
                `}
              >
                {row.map((cell, cellIdx) => (
                  <td
                    key={cellIdx}
                    className={`
                      px-4 py-2.5 text-text-primary
                      ${getAlignmentClass(alignments[cellIdx] || 'left')}
                      first:pl-4 last:pr-4
                    `}
                  >
                    {formatCellContent(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && (
        <div className="px-4 py-6 text-center text-body-sm text-text-muted">No data</div>
      )}
    </div>
  );
}

/**
 * Format cell content - handle entity links, numbers, percentages, etc.
 */
function formatCellContent(content: string): React.ReactNode {
  // Check for game link pattern: [Game Name](game:12345)
  const gameLinkMatch = content.match(/^\[([^\]]+)\]\(game:(\d+)\)$/);
  if (gameLinkMatch) {
    return (
      <Link
        href={`/apps/${gameLinkMatch[2]}`}
        target="_blank"
        rel="noopener noreferrer"
        className="chat-accent-link"
      >
        {gameLinkMatch[1]}
      </Link>
    );
  }

  // Check for publisher link pattern: [Publisher Name](/publishers/123) or [Publisher Name](publishers/123)
  const publisherLinkMatch = content.match(/^\[([^\]]+)\]\(\/?publishers\/(\d+)\)$/);
  if (publisherLinkMatch) {
    return (
      <Link
        href={`/publishers/${publisherLinkMatch[2]}`}
        target="_blank"
        rel="noopener noreferrer"
        className="chat-accent-link"
      >
        {publisherLinkMatch[1]}
      </Link>
    );
  }

  // Check for developer link pattern: [Developer Name](/developers/123) or [Developer Name](developers/123)
  const developerLinkMatch = content.match(/^\[([^\]]+)\]\(\/?developers\/(\d+)\)$/);
  if (developerLinkMatch) {
    return (
      <Link
        href={`/developers/${developerLinkMatch[2]}`}
        target="_blank"
        rel="noopener noreferrer"
        className="chat-accent-link"
      >
        {developerLinkMatch[1]}
      </Link>
    );
  }

  // Check if it's a percentage
  if (/^\d+\.?\d*%$/.test(content.trim())) {
    return <span className="tabular-nums">{content}</span>;
  }

  // Check if it's a number
  if (/^-?\d+\.?\d*$/.test(content.trim())) {
    return <span className="tabular-nums">{content}</span>;
  }

  return content;
}
