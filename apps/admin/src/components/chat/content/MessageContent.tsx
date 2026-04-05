'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { parseMessageContent, type ContentBlock } from './parsers';
import { MarkdownTable } from './MarkdownTable';
import { CodeBlock } from './CodeBlock';
import { CollapsibleSection } from './CollapsibleSection';

interface MessageContentProps {
  content: string;
  enableCollapse?: boolean;
}

export function MessageContent({ content, enableCollapse = true }: MessageContentProps) {
  const blocks = useMemo(() => parseMessageContent(content), [content]);

  const renderedBlocks = (
    <div className="space-y-2">
      {blocks.map((block, idx) => (
        <ContentBlockRenderer key={idx} block={block} />
      ))}
    </div>
  );

  if (enableCollapse) {
    return (
      <CollapsibleSection content={content}>
        {renderedBlocks}
      </CollapsibleSection>
    );
  }

  return renderedBlocks;
}

interface ContentBlockRendererProps {
  block: ContentBlock;
}

function ContentBlockRenderer({ block }: ContentBlockRendererProps) {
  switch (block.type) {
    case 'table':
      return (
        <MarkdownTable
          headers={block.headers}
          rows={block.rows}
          alignments={block.alignments}
        />
      );

    case 'code':
      return <CodeBlock code={block.content} language={block.language} />;

    case 'text':
      return <TextBlock content={block.content} />;

    default:
      return null;
  }
}

interface TextBlockProps {
  content: string;
}

function TextBlock({ content }: TextBlockProps) {
  // Split by double newlines for paragraphs
  const paragraphs = content.split(/\n\n+/);

  return (
    <div className="space-y-3">
      {paragraphs.map((paragraph, idx) => (
        <p key={idx} className="text-body text-text-primary whitespace-pre-wrap leading-relaxed">
          {formatTextContent(paragraph)}
        </p>
      ))}
    </div>
  );
}

/**
 * Format inline text elements (bold, inline code, game links, publisher/developer links, etc.)
 */
function formatTextContent(text: string): React.ReactNode {
  // Combined pattern for: entity links, bold **text**, inline code `code`
  type Segment =
    | { type: 'text'; content: string }
    | { type: 'bold'; content: string }
    | { type: 'code'; content: string }
    | { type: 'gameLink'; name: string; appId: string }
    | { type: 'publisherLink'; name: string; id: string }
    | { type: 'developerLink'; name: string; id: string };

  const segments: Segment[] = [];
  let lastIndex = 0;

  // Pattern matches: [Name](game:ID), [Name](/publishers/ID), [Name](/developers/ID), **bold**, `code`
  // Note: Also handles missing leading slash (publishers/ID, developers/ID)
  const combinedPattern = /(\[([^\]]+)\]\(game:(\d+)\)|\[([^\]]+)\]\(\/?publishers\/(\d+)\)|\[([^\]]+)\]\(\/?developers\/(\d+)\)|\*\*(.+?)\*\*|`([^`]+)`)/g;
  let match;

  while ((match = combinedPattern.exec(text)) !== null) {
    // Add text before match
    if (match.index > lastIndex) {
      segments.push({ type: 'text', content: text.slice(lastIndex, match.index) });
    }

    // Determine match type
    if (match[0].startsWith('[') && match[0].includes('](game:')) {
      // Game link: [Name](game:ID)
      segments.push({ type: 'gameLink', name: match[2], appId: match[3] });
    } else if (match[0].startsWith('[') && match[0].includes('publishers/')) {
      // Publisher link: [Name](/publishers/ID) or [Name](publishers/ID)
      segments.push({ type: 'publisherLink', name: match[4], id: match[5] });
    } else if (match[0].startsWith('[') && match[0].includes('developers/')) {
      // Developer link: [Name](/developers/ID) or [Name](developers/ID)
      segments.push({ type: 'developerLink', name: match[6], id: match[7] });
    } else if (match[0].startsWith('**')) {
      // Bold text
      segments.push({ type: 'bold', content: match[8] });
    } else if (match[0].startsWith('`')) {
      // Inline code
      segments.push({ type: 'code', content: match[9] });
    }

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    segments.push({ type: 'text', content: text.slice(lastIndex) });
  }

  // If no special formatting found, return plain text
  if (segments.length === 0) {
    return text;
  }

  return segments.map((segment, idx) => {
    switch (segment.type) {
      case 'gameLink':
        return (
          <Link
            key={idx}
            href={`/apps/${segment.appId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="chat-accent-link"
          >
            {segment.name}
          </Link>
        );
      case 'publisherLink':
        return (
          <Link
            key={idx}
            href={`/publishers/${segment.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="chat-accent-link"
          >
            {segment.name}
          </Link>
        );
      case 'developerLink':
        return (
          <Link
            key={idx}
            href={`/developers/${segment.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="chat-accent-link"
          >
            {segment.name}
          </Link>
        );
      case 'bold':
        return (
          <strong key={idx} className="font-semibold text-text-primary">
            {segment.content}
          </strong>
        );
      case 'code':
        return (
          <code
            key={idx}
            className="px-1.5 py-0.5 rounded bg-surface-overlay text-accent-primary font-mono text-[0.9em]"
          >
            {segment.content}
          </code>
        );
      default:
        return <span key={idx}>{segment.content}</span>;
    }
  });
}

/**
 * Export formatTextContent for use in other components (like MarkdownTable)
 */
export { formatTextContent };
