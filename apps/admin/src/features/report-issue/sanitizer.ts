import type { JsonObject, JsonValue } from './types';

const DEFAULT_MAX_DEPTH = 6;
const DEFAULT_MAX_KEYS = 80;
const DEFAULT_MAX_ARRAY_LENGTH = 25;
const DEFAULT_MAX_STRING_LENGTH = 2_000;

const SENSITIVE_KEY_PATTERN =
  /(^|[_-])(authorization|auth|bearer|cookie|csrf|credential|jwt|password|secret|service[_-]?role|session|supabase|token|api[_-]?key|anon[_-]?key|access[_-]?token|refresh[_-]?token)([_-]|$)/i;

const SECRET_VALUE_PATTERNS = [
  /^Bearer\s+/i,
  /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/,
  /^sk-[A-Za-z0-9_-]{16,}/,
  /supabase\.(co|in)\//i,
];

interface SanitizeOptions {
  maxArrayLength?: number;
  maxDepth?: number;
  maxKeys?: number;
  maxStringLength?: number;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key);
}

function isSecretLikeString(value: string): boolean {
  return SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value.trim()));
}

export function truncateString(value: string, maxLength = DEFAULT_MAX_STRING_LENGTH): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}...[truncated ${value.length - maxLength} chars]`;
}

export function sanitizeValue(value: unknown, options: SanitizeOptions = {}, depth = 0): JsonValue {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxArrayLength = options.maxArrayLength ?? DEFAULT_MAX_ARRAY_LENGTH;
  const maxKeys = options.maxKeys ?? DEFAULT_MAX_KEYS;
  const maxStringLength = options.maxStringLength ?? DEFAULT_MAX_STRING_LENGTH;

  if (value === null || value === undefined) return null;

  if (typeof value === 'string') {
    if (isSecretLikeString(value)) return '[redacted]';
    return truncateString(value, maxStringLength);
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (depth >= maxDepth) {
    return '[max-depth]';
  }

  if (Array.isArray(value)) {
    const result = value
      .slice(0, maxArrayLength)
      .map((item) => sanitizeValue(item, options, depth + 1));
    if (value.length > maxArrayLength) {
      result.push(`[truncated ${value.length - maxArrayLength} items]`);
    }
    return result;
  }

  if (!isPlainObject(value)) {
    return String(value);
  }

  const result: JsonObject = {};
  const entries = Object.entries(value).slice(0, maxKeys);
  for (const [key, nestedValue] of entries) {
    if (isSensitiveKey(key)) {
      result[key] = '[redacted]';
      continue;
    }
    result[key] = sanitizeValue(nestedValue, options, depth + 1);
  }

  const keyCount = Object.keys(value).length;
  if (keyCount > maxKeys) {
    result.__truncated_keys = keyCount - maxKeys;
  }

  return result;
}

export function sanitizeObject(value: unknown, options?: SanitizeOptions): JsonObject {
  const sanitized = sanitizeValue(value, options);
  return isPlainObject(sanitized) ? sanitized : {};
}

export function sanitizeNote(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? truncateString(trimmed, 2_000) : null;
}

export function sanitizeShortText(value: unknown, maxLength = 512): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? truncateString(trimmed, maxLength) : null;
}

export function sanitizeSearchParams(params: URLSearchParams): JsonObject {
  const result: JsonObject = {};
  for (const [key, value] of params.entries()) {
    result[key] = isSensitiveKey(key) ? '[redacted]' : truncateString(value, 500);
  }
  return result;
}

export function sanitizeUrl(value: string | null | undefined): string | null {
  if (!value) return null;

  try {
    const url = new URL(value);
    for (const key of Array.from(url.searchParams.keys())) {
      if (isSensitiveKey(key)) {
        url.searchParams.set(key, '[redacted]');
      }
    }
    return truncateString(url.toString(), 2_000);
  } catch {
    return truncateString(value, 2_000);
  }
}

type SanitizableSentryEvent = {
  breadcrumbs?: Array<Record<string, unknown>>;
  contexts?: Record<string, unknown>;
  extra?: Record<string, unknown>;
  request?: Record<string, unknown>;
};

export function sanitizeSentryEvent<T>(event: T): T {
  const nextEvent = { ...(event as SanitizableSentryEvent) };

  if (nextEvent.contexts) {
    nextEvent.contexts = sanitizeObject(nextEvent.contexts);
  }

  if (nextEvent.extra) {
    nextEvent.extra = sanitizeObject(nextEvent.extra);
  }

  if (nextEvent.request) {
    nextEvent.request = sanitizeObject({
      ...nextEvent.request,
      cookies: nextEvent.request.cookies ? '[redacted]' : undefined,
      data: nextEvent.request.data ? '[redacted]' : undefined,
      headers: sanitizeObject(nextEvent.request.headers),
    });
  }

  if (nextEvent.breadcrumbs) {
    nextEvent.breadcrumbs = nextEvent.breadcrumbs.map((breadcrumb) => sanitizeObject(breadcrumb));
  }

  return nextEvent as T;
}
