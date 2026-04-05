'use client';

import Link from 'next/link';
import { Children, isValidElement, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import { useEntityMappings } from './EntityLinkContext';

type AnchorProps = ComponentPropsWithoutRef<'a'>;

function extractText(children: ReactNode): string {
  let text = '';

  Children.forEach(children, (child) => {
    if (typeof child === 'string' || typeof child === 'number') {
      text += String(child);
      return;
    }

    if (Array.isArray(child)) {
      text += extractText(child);
      return;
    }

    if (isValidElement<{ children?: ReactNode }>(child)) {
      text += extractText(child.props.children);
    }
  });

  return text.trim();
}

export function EntityLinkRenderer({ href, children, ...props }: AnchorProps) {
  const mappings = useEntityMappings();

  if (!href) {
    return <span {...props}>{children}</span>;
  }

  // Game link: game:12345
  if (href.startsWith('game:')) {
    const appId = href.slice(5);
    return (
      <Link
        href={`/apps/${appId}`}
        target="_blank"
        rel="noopener noreferrer"
        className="chat-accent-link"
        data-entity-link
      >
        {children}
      </Link>
    );
  }

  // Publisher link: /publishers/123 or publishers/123
  const publisherMatch = href.match(/\/?publishers\/(\d+)/);
  if (publisherMatch) {
    return (
      <Link
        href={`/publishers/${publisherMatch[1]}`}
        target="_blank"
        rel="noopener noreferrer"
        className="chat-accent-link"
        data-entity-link
      >
        {children}
      </Link>
    );
  }

  // Developer link: /developers/123 or developers/123
  const developerMatch = href.match(/\/?developers\/(\d+)/);
  if (developerMatch) {
    return (
      <Link
        href={`/developers/${developerMatch[1]}`}
        target="_blank"
        rel="noopener noreferrer"
        className="chat-accent-link"
        data-entity-link
      >
        {children}
      </Link>
    );
  }

  const steamCompanyMatch = href.match(/^https?:\/\/store\.steampowered\.com\/(publisher|developer)\/[^/?#]+/i);
  if (steamCompanyMatch) {
    const label = extractText(children);
    const normalizedLabel = label.toLowerCase();
    const companyType = steamCompanyMatch[1].toLowerCase();
    const publisherId = companyType === 'publisher' ? mappings?.publishers.get(normalizedLabel) : undefined;
    const developerId = companyType === 'developer' ? mappings?.developers.get(normalizedLabel) : undefined;

    if (publisherId) {
      return (
        <Link
          href={`/publishers/${publisherId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="chat-accent-link"
          data-entity-link
        >
          {children}
        </Link>
      );
    }

    if (developerId) {
      return (
        <Link
          href={`/developers/${developerId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="chat-accent-link"
          data-entity-link
        >
          {children}
        </Link>
      );
    }
  }

  // Regular external link
  const isExternal = href.startsWith('http://') || href.startsWith('https://');

  if (isExternal) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="chat-accent-link"
        {...props}
      >
        {children}
      </a>
    );
  }

  // Internal link
  return (
    <Link href={href} className="chat-accent-link" {...props}>
      {children}
    </Link>
  );
}
