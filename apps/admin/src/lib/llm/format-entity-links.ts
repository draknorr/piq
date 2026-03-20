/**
 * Format tool results with entity links
 *
 * Pre-formats game, developer, and publisher names as markdown links
 * before sending to the LLM. This ensures consistent entity linking
 * regardless of LLM behavior.
 */

interface ResultWithData {
  success?: boolean;
  data?: Record<string, unknown>[];
  results?: Record<string, unknown>[];
  candidates?: Record<string, unknown>[];
  app?: Record<string, unknown>;
  detail?: Record<string, unknown>;
  entityType?: 'publisher' | 'developer';
  canonicalResult?: Record<string, unknown>;
  [key: string]: unknown;
}

function formatNestedTitleCollections(row: Record<string, unknown>): Record<string, unknown> {
  const formatted = { ...row };

  for (const key of ['representativeTitles', 'flagshipTitles']) {
    const titles = row[key];
    if (!Array.isArray(titles)) {
      continue;
    }

    formatted[key] = titles.map((title) => {
      if (!title || typeof title !== 'object') {
        return title;
      }

      const typedTitle = title as Record<string, unknown>;
      const appid = typedTitle.appid as number | undefined;
      const name = typedTitle.name as string | undefined;

      if (appid && name && !name.startsWith('[')) {
        return {
          ...typedTitle,
          name: `[${name}](game:${appid})`,
        };
      }

      return typedTitle;
    });
  }

  return formatted;
}

/**
 * Format a single data row with entity links
 */
function formatRowWithLinks(row: Record<string, unknown>): Record<string, unknown> {
  const formatted = formatNestedTitleCollections(row);

  // Format game links - check various field name patterns
  const appid = row.appid as number | undefined;
  if (appid) {
    // gameName field (from DeveloperGameMetrics, PublisherGameMetrics)
    if (row.gameName && typeof row.gameName === 'string') {
      formatted.gameName = `[${row.gameName}](game:${appid})`;
    }
    // name field (from Discovery, search_games)
    if (row.name && typeof row.name === 'string') {
      formatted.name = `[${row.name}](game:${appid})`;
    }
    // appName field (from change-intel activity/detail surfaces)
    if (row.appName && typeof row.appName === 'string') {
      formatted.appName = `[${row.appName}](game:${appid})`;
    }
  }

  // Format other game-name pairs like parentAppid/parentName or dlcAppid/dlcName.
  for (const [key, value] of Object.entries(row)) {
    if (!key.endsWith('Appid') || typeof value !== 'number') continue;

    const nameKey = `${key.slice(0, -5)}Name`;
    const rawName = row[nameKey];
    if (typeof rawName !== 'string' || rawName.startsWith('[')) continue;

    formatted[nameKey] = `[${rawName}](game:${value})`;
  }

  // Format developer links
  const developerId = row.developerId as number | undefined;
  if (developerId && row.developerName && typeof row.developerName === 'string') {
    formatted.developerName = `[${row.developerName}](/developers/${developerId})`;
  }

  // Format publisher links
  const publisherId = row.publisherId as number | undefined;
  if (publisherId && row.publisherName && typeof row.publisherName === 'string') {
    formatted.publisherName = `[${row.publisherName}](/publishers/${publisherId})`;
  }

  return formatted;
}

/**
 * Format find_similar results with entity links
 * These have a different structure with 'results' array and 'type' field
 */
function formatSimilarityResults(
  results: Record<string, unknown>[]
): Record<string, unknown>[] {
  return results.map((item) => {
    const formatted = formatNestedTitleCollections(item);
    const id = item.id as number | undefined;
    const name = item.name as string | undefined;
    const type = item.type as string | undefined;

    if (id && name) {
      if (type === 'game') {
        formatted.name = `[${name}](game:${id})`;
      } else if (type === 'developer') {
        formatted.name = `[${name}](/developers/${id})`;
      } else if (type === 'publisher') {
        formatted.name = `[${name}](/publishers/${id})`;
      }
    }

    return formatted;
  });
}

function formatEntityResults(
  entityType: 'publisher' | 'developer',
  results: Record<string, unknown>[]
): Record<string, unknown>[] {
  return results.map((item) => {
    const formatted = { ...item };
    const id = item.id as number | undefined;
    const name = item.name as string | undefined;

    if (id && name) {
      formatted.name = entityType === 'publisher'
        ? `[${name}](/publishers/${id})`
        : `[${name}](/developers/${id})`;
    }

    return formatted;
  });
}

/**
 * Format tool result with entity links before sending to LLM
 *
 * Transforms raw tool results to include markdown entity links,
 * ensuring the LLM can pass them through directly without needing
 * to construct links itself.
 */
export function formatResultWithEntityLinks(result: unknown): string {
  if (!result || typeof result !== 'object') {
    return JSON.stringify(result);
  }

  const typedResult = result as ResultWithData;

  if (Array.isArray(typedResult.candidates) && typedResult.candidates.length > 0) {
    const formattedCandidates =
      typedResult.entityType === 'publisher' || typedResult.entityType === 'developer'
        ? formatEntityResults(typedResult.entityType, typedResult.candidates as Record<string, unknown>[])
        : typedResult.candidates.map((row) => formatRowWithLinks(row as Record<string, unknown>));
    const formattedCanonical =
      typedResult.canonicalResult &&
      (typedResult.entityType === 'publisher' || typedResult.entityType === 'developer')
        ? formatEntityResults(typedResult.entityType, [typedResult.canonicalResult])[0]
        : typedResult.canonicalResult;
    return JSON.stringify({ ...typedResult, candidates: formattedCandidates, canonicalResult: formattedCanonical });
  }

  // Handle query_analytics and search_games results (have 'data' array)
  if (Array.isArray(typedResult.data) && typedResult.data.length > 0) {
    const formattedData = typedResult.data.map((row) =>
      formatRowWithLinks(row as Record<string, unknown>)
    );

    return JSON.stringify({ ...typedResult, data: formattedData });
  }

  if (typedResult.app && typeof typedResult.app === 'object') {
    const formattedApp = formatRowWithLinks(typedResult.app);
    return JSON.stringify({ ...typedResult, app: formattedApp });
  }

  if (typedResult.detail && typeof typedResult.detail === 'object') {
    const formattedDetail = formatRowWithLinks(typedResult.detail);
    return JSON.stringify({ ...typedResult, detail: formattedDetail });
  }

  // Handle find_similar results (have 'results' array with 'type' field)
  if (Array.isArray(typedResult.results) && typedResult.results.length > 0) {
    const results = typedResult.results as Record<string, unknown>[];
    const hasTypedSimilarityResults = results.some((item) => typeof item.type === 'string');
    const formattedResults =
      hasTypedSimilarityResults
        ? formatSimilarityResults(results)
        : typedResult.entityType === 'publisher' || typedResult.entityType === 'developer'
          ? formatEntityResults(typedResult.entityType, results)
          : results.map((row) => formatRowWithLinks(row));
    const formattedCanonical =
      typedResult.canonicalResult &&
      (typedResult.entityType === 'publisher' || typedResult.entityType === 'developer')
        ? formatEntityResults(typedResult.entityType, [typedResult.canonicalResult])[0]
        : typedResult.canonicalResult;
    return JSON.stringify({ ...typedResult, results: formattedResults, canonicalResult: formattedCanonical });
  }

  // Handle unsuccessful results - return as-is
  if (typedResult.success === false) {
    return JSON.stringify(result);
  }

  // No data to format - return as-is
  return JSON.stringify(result);
}
