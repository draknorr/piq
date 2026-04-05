'use client';

import {
  Children,
  Fragment,
  cloneElement,
  isValidElement,
  memo,
  useMemo,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from 'react';
import Link from 'next/link';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Apple, Ban, Gamepad2, Minus, ShieldCheck, Terminal, TrendingDown, TrendingUp } from 'lucide-react';
import { EntityLinkRenderer } from './EntityLinkRenderer';
import { MermaidBlock } from './MermaidBlock';
import { CopyButton } from './CopyButton';
import { detectSql } from './parsers';
import { useEntityMappings } from './EntityLinkContext';

interface StreamingContentProps {
  content: string;
  isStreaming?: boolean;
}

type Density = 'normal' | 'dense';

type InlineRenderMode = 'text' | 'table';

interface InlineToken {
  labelLower: string;
  render: (displayLabel: string) => ReactNode;
}

interface TableCellProps extends ComponentPropsWithoutRef<'td'> {
  align?: 'left' | 'center' | 'right';
}

function transformMarkdownUrl(url: string): string {
  const normalized = url.trim();
  if (!normalized) {
    return '';
  }

  if (/^game:\d+$/i.test(normalized)) {
    return normalized;
  }

  if (normalized.startsWith('//')) {
    return '';
  }

  const schemeMatch = normalized.match(/^([a-z][a-z\d+.-]*):/i);
  if (!schemeMatch) {
    return normalized;
  }

  return /^(https?|mailto|tel)$/i.test(schemeMatch[1]) ? normalized : '';
}

function isWordChar(value: string | undefined): boolean {
  return Boolean(value && /[A-Za-z0-9_]/.test(value));
}

function isBoundary(text: string, start: number, end: number): boolean {
  const before = start > 0 ? text[start - 1] : undefined;
  const after = end < text.length ? text[end] : undefined;
  return !isWordChar(before) && !isWordChar(after);
}

function extractTextContent(children: ReactNode): string {
  if (typeof children === 'string') {
    return children;
  }

  if (typeof children === 'number') {
    return String(children);
  }

  if (Array.isArray(children)) {
    return children.map(extractTextContent).join('');
  }

  if (children && typeof children === 'object' && 'props' in children) {
    return extractTextContent((children as { props: { children?: ReactNode } }).props.children);
  }

  return '';
}

function WindowsGlyph({ className }: { className?: string }): ReactNode {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      className={className}
    >
      <path
        d="M3.5 5.75L11 4.5V11H3.5V5.75ZM12.5 4.25L20.5 3V11H12.5V4.25ZM3.5 13H11V19.5L3.5 18.25V13ZM12.5 13H20.5V21L12.5 19.75V13Z"
        fill="currentColor"
      />
    </svg>
  );
}

function PlatformGlyph({
  platform,
  className,
}: {
  platform: 'windows' | 'macos' | 'linux';
  className?: string;
}): ReactNode {
  if (platform === 'windows') {
    return <WindowsGlyph className={className} />;
  }

  if (platform === 'macos') {
    return <Apple className={className} aria-hidden="true" />;
  }

  return <Terminal className={className} aria-hidden="true" />;
}

function StatusGlyph({
  status,
  className,
}: {
  status: 'verified' | 'playable' | 'unsupported' | 'unknown';
  className?: string;
}): ReactNode {
  if (status === 'verified') {
    return <ShieldCheck className={className} aria-hidden="true" />;
  }

  if (status === 'playable') {
    return <Gamepad2 className={className} aria-hidden="true" />;
  }

  if (status === 'unsupported') {
    return <Ban className={className} aria-hidden="true" />;
  }

  return <Minus className={className} aria-hidden="true" />;
}

function PlatformToken({
  platform,
  dense = false,
}: {
  platform: 'windows' | 'macos' | 'linux';
  dense?: boolean;
}): ReactNode {
  const label = platform === 'windows' ? 'Windows' : platform === 'macos' ? 'macOS' : 'Linux';

  return (
    <span
      className={`inline-flex items-center gap-1.5 align-middle ${
        dense
          ? 'rounded-full border border-border-subtle bg-surface-base px-2 py-0.5 text-caption text-text-secondary'
          : 'rounded-full border border-border-subtle bg-surface-overlay/70 px-2 py-0.5 text-caption text-text-secondary'
      }`}
      title={label}
    >
      <PlatformGlyph platform={platform} className="h-3.5 w-3.5" />
      <span className="sr-only">{label}</span>
    </span>
  );
}

function StatusToken({
  status,
  dense = false,
}: {
  status: 'verified' | 'playable' | 'unsupported' | 'unknown';
  dense?: boolean;
}): ReactNode {
  const label =
    status === 'verified'
      ? 'Steam Deck Verified'
      : status === 'playable'
        ? 'Steam Deck Playable'
        : status === 'unsupported'
          ? 'Steam Deck Unsupported'
          : 'Steam Deck Unknown';

  return (
    <span
      className={`inline-flex items-center gap-1.5 align-middle ${
        dense
          ? 'rounded-full border border-border-subtle bg-surface-base px-2 py-0.5 text-caption text-text-secondary'
          : 'rounded-full border border-border-subtle bg-surface-overlay/70 px-2 py-0.5 text-caption text-text-secondary'
      }`}
      title={label}
    >
      <StatusGlyph status={status} className="h-3.5 w-3.5" />
      <span className="sr-only">{label}</span>
    </span>
  );
}

function TrendToken({
  direction,
  dense = false,
}: {
  direction: 'up' | 'down' | 'stable';
  dense?: boolean;
}): ReactNode {
  const label = direction === 'up' ? 'Trending up' : direction === 'down' ? 'Trending down' : 'Stable';
  const icon =
    direction === 'up' ? (
      <TrendingUp className="h-3.5 w-3.5" aria-hidden="true" />
    ) : direction === 'down' ? (
      <TrendingDown className="h-3.5 w-3.5" aria-hidden="true" />
    ) : (
      <Minus className="h-3.5 w-3.5" aria-hidden="true" />
    );

  return (
    <span
      className={`inline-flex items-center gap-1.5 align-middle ${
        dense
          ? 'rounded-full border border-border-subtle bg-surface-base px-2 py-0.5 text-caption text-text-secondary'
          : 'rounded-full border border-border-subtle bg-surface-overlay/70 px-2 py-0.5 text-caption text-text-secondary'
      }`}
      title={label}
    >
      {icon}
      <span className="sr-only">{label}</span>
    </span>
  );
}

function buildInlineTokens(
  mappings: ReturnType<typeof useEntityMappings>,
  density: Density,
  mode: InlineRenderMode
): InlineToken[] {
  const tokens: InlineToken[] = [];

  const pushEntityTokens = (
    entries: IterableIterator<[string, number]>,
    hrefBuilder: (id: number) => string
  ): void => {
    for (const [nameLower, id] of entries) {
      const href = hrefBuilder(id);
      tokens.push({
        labelLower: nameLower,
        render: (displayLabel: string) => (
          <Link
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent-blue transition-colors hover:text-accent-blue/80 hover:underline"
            data-entity-link
          >
            {displayLabel}
          </Link>
        ),
      });
    }
  };

  if (mappings) {
    pushEntityTokens(mappings.games.entries(), (id) => `/apps/${id}`);
    pushEntityTokens(mappings.developers.entries(), (id) => `/developers/${id}`);
    pushEntityTokens(mappings.publishers.entries(), (id) => `/publishers/${id}`);
  }

  if (mode === 'table') {
    tokens.push(
      {
        labelLower: 'steam deck verified',
        render: () => <StatusToken status="verified" dense={density === 'dense'} />,
      },
      {
        labelLower: 'steam deck playable',
        render: () => <StatusToken status="playable" dense={density === 'dense'} />,
      },
      {
        labelLower: 'steam deck unsupported',
        render: () => <StatusToken status="unsupported" dense={density === 'dense'} />,
      },
      {
        labelLower: 'steam deck unknown',
        render: () => <StatusToken status="unknown" dense={density === 'dense'} />,
      },
      {
        labelLower: 'verified',
        render: () => <StatusToken status="verified" dense={density === 'dense'} />,
      },
      {
        labelLower: 'playable',
        render: () => <StatusToken status="playable" dense={density === 'dense'} />,
      },
      {
        labelLower: 'unsupported',
        render: () => <StatusToken status="unsupported" dense={density === 'dense'} />,
      },
      {
        labelLower: 'stable',
        render: () => <TrendToken direction="stable" dense={density === 'dense'} />,
      },
      {
        labelLower: 'up',
        render: () => <TrendToken direction="up" dense={density === 'dense'} />,
      },
      {
        labelLower: 'down',
        render: () => <TrendToken direction="down" dense={density === 'dense'} />,
      },
      {
        labelLower: 'windows',
        render: () => <PlatformToken platform="windows" dense={density === 'dense'} />,
      },
      {
        labelLower: 'macos',
        render: () => <PlatformToken platform="macos" dense={density === 'dense'} />,
      },
      {
        labelLower: 'linux',
        render: () => <PlatformToken platform="linux" dense={density === 'dense'} />,
      }
    );
  }

  return tokens.sort((a, b) => b.labelLower.length - a.labelLower.length);
}

function normalizeInlineValue(content: string): string {
  return content.trim().toLowerCase().replace(/\s+/g, ' ');
}

function isCompactSemanticCell(content: string): boolean {
  const normalized = normalizeInlineValue(content);
  if (!normalized) {
    return false;
  }

  if (hasShortStatusShape(normalized)) {
    return true;
  }

  if (/^steam deck (verified|playable|unsupported|unknown)$/.test(normalized)) {
    return true;
  }

  return /^(windows|macos|linux)(,\s*(windows|macos|linux))*$/.test(normalized);
}

function tokenizeInlineText(text: string, tokens: InlineToken[], keyPrefix: string): ReactNode[] {
  if (!text) {
    return [];
  }

  const pieces: ReactNode[] = [];
  let index = 0;
  let cursor = 0;

  while (cursor < text.length) {
    let matchToken: InlineToken | null = null;
    let matchLength = 0;

    for (const token of tokens) {
      const candidate = text.slice(cursor, cursor + token.labelLower.length);
      if (
        candidate.toLowerCase() === token.labelLower &&
        isBoundary(text, cursor, cursor + token.labelLower.length)
      ) {
        matchToken = token;
        matchLength = token.labelLower.length;
        break;
      }
    }

    if (matchToken) {
      if (cursor > index) {
        pieces.push(
          <Fragment key={`${keyPrefix}-text-${index}`}>{text.slice(index, cursor)}</Fragment>
        );
      }

      pieces.push(
        <Fragment key={`${keyPrefix}-token-${cursor}`}>
          {matchToken.render(text.slice(cursor, cursor + matchLength))}
        </Fragment>
      );

      cursor += matchLength;
      index = cursor;
      continue;
    }

    cursor += 1;
  }

  if (index < text.length) {
    pieces.push(<Fragment key={`${keyPrefix}-tail`}>{text.slice(index)}</Fragment>);
  }

  return pieces;
}

function renderRichNode(
  node: ReactNode,
  tokens: InlineToken[],
  density: Density,
  keyPrefix: string
): ReactNode {
  if (typeof node === 'string' || typeof node === 'number') {
    return tokenizeInlineText(String(node), tokens, keyPrefix);
  }

  if (Array.isArray(node)) {
    return node.flatMap((child, index) =>
      Children.toArray(renderRichNode(child, tokens, density, `${keyPrefix}-${index}`))
    );
  }

  if (!isValidElement(node)) {
    return node;
  }

  if (typeof node.type !== 'string') {
    return node;
  }

  if (node.type === 'a' || node.type === 'code' || node.type === 'pre' || node.type === 'img') {
    return node;
  }

  const childProps = node.props as { children?: ReactNode };
  if (childProps.children == null) {
    return node;
  }

  return cloneElement(node, undefined, renderRichNode(childProps.children, tokens, density, keyPrefix));
}

function renderInline(children: ReactNode, tokens: InlineToken[], density: Density): ReactNode {
  return renderRichNode(children, tokens, density, 'inline');
}

function hasNumericShape(content: string): boolean {
  return /^-?\d[\d,]*(?:\.\d+)?%?$/.test(content.trim());
}

function hasShortStatusShape(content: string): boolean {
  return /^(n\/a|na|yes|no|true|false|unknown|stable|up|down|verified|playable|unsupported)$/i.test(
    content.trim()
  );
}

function isRightAlignedCell(content: string, align?: 'left' | 'center' | 'right'): boolean {
  return align === 'right' || hasNumericShape(content);
}

const CodeBlockRenderer = memo(function CodeBlockRenderer({
  children,
  className,
}: ComponentPropsWithoutRef<'code'>) {
  const match = /language-(\w+)/.exec(className || '');
  const language = match?.[1] || '';
  const code = String(children).replace(/\n$/, '');

  if (language === 'mermaid') {
    return <MermaidBlock chart={code} />;
  }

  if (!className && !code.includes('\n')) {
    return (
      <code className="rounded bg-surface-overlay px-1.5 py-0.5 font-mono text-[0.9em] text-accent-primary">
        {children}
      </code>
    );
  }

  const displayLanguage = language || (detectSql(code) ? 'sql' : 'text');

  return (
    <div className="my-4 overflow-hidden rounded-2xl border border-border-subtle bg-surface-raised shadow-card">
      <div className="flex items-center justify-between border-b border-border-subtle bg-surface-overlay/30 px-3 py-2">
        <span className="text-caption font-mono uppercase tracking-wider text-text-tertiary">
          {displayLanguage}
        </span>
        <CopyButton text={code} size="sm" />
      </div>
      <div className="overflow-x-auto scrollbar-thin">
        <pre className="m-0 p-4 font-mono text-body-sm text-text-primary !bg-transparent">
          <code>{code}</code>
        </pre>
      </div>
    </div>
  );
});

function TableCell({ children, align, className = '' }: TableCellProps): ReactNode {
  const mappings = useEntityMappings();
  const rawText = extractTextContent(children);
  const numeric = hasNumericShape(rawText);
  const status = !numeric && hasShortStatusShape(rawText);
  const cellKind = numeric ? 'numeric' : status ? 'status' : undefined;
  const tokens = useMemo(
    () => buildInlineTokens(mappings, 'dense', isCompactSemanticCell(rawText) ? 'table' : 'text'),
    [mappings, rawText]
  );

  return (
    <td
      data-align={isRightAlignedCell(rawText, align) ? 'right' : align || 'left'}
      data-cell-kind={cellKind}
      className={`text-text-primary ${className}`}
    >
      {renderInline(children, tokens, 'dense')}
    </td>
  );
}

function TableHeader({ children, align, className = '' }: TableCellProps): ReactNode {
  const mappings = useEntityMappings();
  const tokens = useMemo(() => buildInlineTokens(mappings, 'dense', 'text'), [mappings]);
  const rawText = extractTextContent(children);
  const numeric = hasNumericShape(rawText);

  return (
    <th
      data-align={isRightAlignedCell(rawText, align) ? 'right' : align || 'left'}
      data-cell-kind={numeric ? 'numeric' : undefined}
      className={`text-text-secondary ${className}`}
    >
      {renderInline(children, tokens, 'dense')}
    </th>
  );
}

function RichTextBlock({
  children,
  as: Component,
  className,
  density = 'normal',
}: {
  children?: ReactNode;
  as: 'p' | 'li' | 'blockquote' | 'h1' | 'h2' | 'h3' | 'h4';
  className: string;
  density?: Density;
}): ReactNode {
  const mappings = useEntityMappings();
  const tokens = useMemo(() => buildInlineTokens(mappings, density, 'text'), [density, mappings]);

  return <Component className={className}>{renderInline(children, tokens, density)}</Component>;
}

const components: Components = {
  a: EntityLinkRenderer as Components['a'],
  code: CodeBlockRenderer as Components['code'],
  table: ({ children }) => (
    <div className="chat-response-table-shell">
      <div className="chat-response-table-scroll">
        <table className="chat-response-table">{children}</table>
      </div>
    </div>
  ),
  thead: ({ children }) => <thead>{children}</thead>,
  tbody: ({ children }) => <tbody>{children}</tbody>,
  tr: ({ children }) => <tr>{children}</tr>,
  th: ({ children, align, className }) => (
    <TableHeader align={align as TableCellProps['align']} className={className}>
      {children}
    </TableHeader>
  ),
  td: ({ children, align, className }) => (
    <TableCell align={align as TableCellProps['align']} className={className}>
      {children}
    </TableCell>
  ),
  h1: ({ children }) => (
    <RichTextBlock
      as="h1"
      density="normal"
      className="mb-2 mt-5 text-heading font-semibold tracking-tight text-text-primary"
    >
      {children}
    </RichTextBlock>
  ),
  h2: ({ children }) => (
    <RichTextBlock
      as="h2"
      density="normal"
      className="mb-2 mt-5 text-subheading font-semibold tracking-tight text-text-primary"
    >
      {children}
    </RichTextBlock>
  ),
  h3: ({ children }) => (
    <RichTextBlock
      as="h3"
      density="normal"
      className="mb-1.5 mt-4 text-body font-semibold text-text-primary"
    >
      {children}
    </RichTextBlock>
  ),
  h4: ({ children }) => (
    <RichTextBlock
      as="h4"
      density="normal"
      className="mb-1 mt-3 text-body font-medium text-text-primary"
    >
      {children}
    </RichTextBlock>
  ),
  p: ({ children }) => (
    <RichTextBlock
      as="p"
      density="normal"
      className="mb-3 text-body leading-7 text-text-primary"
    >
      {children}
    </RichTextBlock>
  ),
  ul: ({ children }) => <ul className="my-2 ml-5 list-disc space-y-1 text-text-primary">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 ml-5 list-decimal space-y-1 text-text-primary">{children}</ol>,
  li: ({ children }) => (
    <RichTextBlock
      as="li"
      density="normal"
      className="pl-1 text-body leading-7 text-text-primary"
    >
      {children}
    </RichTextBlock>
  ),
  blockquote: ({ children }) => (
    <RichTextBlock
      as="blockquote"
      density="normal"
      className="my-3 border-l-2 border-accent-primary pl-4 italic text-text-secondary"
    >
      {children}
    </RichTextBlock>
  ),
  hr: () => <hr className="my-4 border-border-muted" />,
  strong: ({ children }) => <strong className="font-semibold text-text-primary">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  img: ({ src, alt }) => (
    <img
      src={src}
      alt={alt || ''}
      className="my-3 h-auto max-w-full rounded-xl border border-border-subtle"
      loading="lazy"
    />
  ),
};

export function StreamingContent({ content, isStreaming = false }: StreamingContentProps) {
  const memoizedContent = useMemo(() => content, [content]);

  return (
    <div className="prose-chat">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={components}
        urlTransform={transformMarkdownUrl}
      >
        {memoizedContent}
      </ReactMarkdown>
      {isStreaming && <StreamingCursor />}
    </div>
  );
}

function StreamingCursor() {
  return (
    <span
      className="inline-block h-4 w-0.5 align-middle bg-accent-primary ml-0.5 animate-pulse"
      aria-label="Streaming..."
    />
  );
}
