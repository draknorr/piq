function replaceInvalidSurrogates(value: string): string {
  let result = '';

  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        result += value[index] ?? '';
        result += value[index + 1] ?? '';
        index += 1;
      } else {
        result += '\uFFFD';
      }
      continue;
    }

    if (code >= 0xdc00 && code <= 0xdfff) {
      result += '\uFFFD';
      continue;
    }

    result += value[index] ?? '';
  }

  return result;
}

export function sanitizeJsonValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return replaceInvalidSurrogates(value);
  }

  if (value === null || typeof value !== 'object') {
    return value;
  }

  if (value instanceof Date) {
    return value.toJSON();
  }

  if (Array.isArray(value)) {
    return value.map(sanitizeJsonValue);
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    sanitized[replaceInvalidSurrogates(key)] = sanitizeJsonValue(entry);
  }

  return sanitized;
}

export function stringifyJsonValue(value: unknown): string {
  return JSON.stringify(sanitizeJsonValue(value));
}
