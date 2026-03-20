import type { ChatToolCall } from '@/lib/llm/types';
import { classifyCompanyIntent } from '@/lib/chat/company-answer-policy';

type CompanyLinkType = 'publisher' | 'developer';

interface CompanyLinkTarget {
  id: number;
  label: string;
  type: CompanyLinkType;
}

interface ToolResultLike {
  data?: Record<string, unknown>[];
  results?: Record<string, unknown>[];
  entityType?: CompanyLinkType;
  canonicalResult?: Record<string, unknown>;
  reference?: Record<string, unknown>;
  [key: string]: unknown;
}

function extractPlainName(value: string): string {
  const match = value.match(/^\[([^\]]+)\]\([^)]+\)$/);
  return match ? match[1] : value;
}

function normalizeLabel(value: string): string {
  return extractPlainName(value).trim().toLowerCase();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function addCompanyTarget(
  targets: Map<string, CompanyLinkTarget>,
  target: CompanyLinkTarget | null
): void {
  if (!target) {
    return;
  }

  const key = normalizeLabel(target.label);
  if (!key) {
    return;
  }

  const existing = targets.get(key);
  if (existing && (existing.id !== target.id || existing.type !== target.type)) {
    return;
  }

  targets.set(key, target);
}

function extractTargetsFromRow(
  row: Record<string, unknown>,
  resultEntityType?: CompanyLinkType
): CompanyLinkTarget[] {
  const targets: CompanyLinkTarget[] = [];

  const publisherId = Number(row.publisherId ?? 0);
  if (publisherId > 0 && typeof row.publisherName === 'string') {
    targets.push({ id: publisherId, label: row.publisherName, type: 'publisher' });
  }

  const developerId = Number(row.developerId ?? 0);
  if (developerId > 0 && typeof row.developerName === 'string') {
    targets.push({ id: developerId, label: row.developerName, type: 'developer' });
  }

  const id = Number(row.id ?? 0);
  if (id > 0 && typeof row.name === 'string') {
    const typedType = row.type === 'publisher' || row.type === 'developer'
      ? row.type
      : resultEntityType;

    if (typedType === 'publisher' || typedType === 'developer') {
      targets.push({ id, label: row.name, type: typedType });
    }
  }

  return targets;
}

function extractCompanyTargets(toolCalls?: ChatToolCall[]): Map<string, CompanyLinkTarget> {
  const targets = new Map<string, CompanyLinkTarget>();

  for (const toolCall of toolCalls ?? []) {
    const result = toolCall.result as ToolResultLike | undefined;
    if (!result || typeof result !== 'object') {
      continue;
    }

    const rows = Array.isArray(result.data)
      ? result.data
      : Array.isArray(result.results)
        ? result.results
        : [];

    for (const row of rows) {
      if (!row || typeof row !== 'object') {
        continue;
      }

      for (const target of extractTargetsFromRow(row as Record<string, unknown>, result.entityType)) {
        addCompanyTarget(targets, target);
      }
    }

    if (result.canonicalResult && typeof result.canonicalResult === 'object' && result.entityType) {
      const canonicalId = Number(result.canonicalResult.id ?? 0);
      const canonicalName = typeof result.canonicalResult.name === 'string'
        ? result.canonicalResult.name
        : null;
      if (canonicalId > 0 && canonicalName) {
        addCompanyTarget(targets, {
          id: canonicalId,
          label: canonicalName,
          type: result.entityType,
        });
      }
    }

    if (result.reference && typeof result.reference === 'object') {
      const referenceId = Number(result.reference.id ?? 0);
      const referenceName = typeof result.reference.name === 'string' ? result.reference.name : null;
      const referenceType =
        result.reference.type === 'publisher' || result.reference.type === 'developer'
          ? result.reference.type
          : null;
      if (referenceId > 0 && referenceName && referenceType) {
        addCompanyTarget(targets, {
          id: referenceId,
          label: referenceName,
          type: referenceType,
        });
      }
    }
  }

  return targets;
}

function normalizeMalformedInternalCompanyLinks(text: string): string {
  return text.replace(/\]\((publishers|developers)\/(\d+)\)/g, '](/$1/$2)');
}

function rewriteExternalCompanyLinks(
  text: string,
  targets: Map<string, CompanyLinkTarget>
): string {
  return text.replace(
    /\[([^\]]+)\]\(https?:\/\/store\.steampowered\.com\/(publisher|developer)\/[^)]+\)/gi,
    (match, label, companyType) => {
      const target = targets.get(normalizeLabel(label));
      if (!target || target.type !== companyType.toLowerCase()) {
        return match;
      }

      return `[${label}](/${target.type}s/${target.id})`;
    }
  );
}

function linkPlainCompanyMentions(
  text: string,
  targets: Map<string, CompanyLinkTarget>
): string {
  const markdownParts = text.split(/(\[[^\]]+\]\([^)]+\))/g);
  const orderedTargets = [...targets.values()].sort((left, right) => right.label.length - left.label.length);

  return markdownParts
    .map((part) => {
      if (part.startsWith('[') && /\]\([^)]+\)$/.test(part)) {
        return part;
      }

      let nextPart = part;
      for (const target of orderedTargets) {
        const escaped = escapeRegex(target.label);
        const pattern = new RegExp(`(^|[^\\w])(${escaped})(?=$|[^\\w])`, 'gi');
        nextPart = nextPart.replace(pattern, (match, prefix, label) => {
          return `${prefix}[${label}](/${target.type}s/${target.id})`;
        });
      }

      return nextPart;
    })
    .join('');
}

function sanitizeOutsideCode(
  content: string,
  transform: (segment: string) => string
): string {
  return content
    .split(/(```[\s\S]*?```|`[^`\n]+`)/g)
    .map((segment) => {
      if (segment.startsWith('```') || (segment.startsWith('`') && segment.endsWith('`'))) {
        return segment;
      }

      return transform(segment);
    })
    .join('');
}

export function sanitizeCompanyAssistantResponse(
  userPrompt: string,
  content: string,
  toolCalls?: ChatToolCall[]
): string {
  if (!content) {
    return content;
  }

  if (!classifyCompanyIntent(userPrompt)) {
    return content;
  }

  const targets = extractCompanyTargets(toolCalls);

  return sanitizeOutsideCode(content, (segment) => {
    let next = normalizeMalformedInternalCompanyLinks(segment);
    next = rewriteExternalCompanyLinks(next, targets);
    next = linkPlainCompanyMentions(next, targets);
    return next;
  });
}
