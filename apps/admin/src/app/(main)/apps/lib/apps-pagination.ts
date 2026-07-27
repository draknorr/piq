export const DEFAULT_APPS_PAGE_SIZE = 50;
export const MAX_APPS_PAGE_SIZE = 100;

export interface AppsPagination {
  limit: number;
  offset: number;
}

export interface AppsPaginationState extends AppsPagination {
  currentPage: number;
  totalPages: number;
  rangeStart: number;
  rangeEnd: number;
  hasPrevious: boolean;
  hasNext: boolean;
  previousOffset: number;
  nextOffset: number;
}

export function normalizeAppsPagination(
  limit: number | undefined,
  offset: number | undefined,
): AppsPagination {
  const normalizedLimit = Number.isFinite(limit)
    ? Math.min(MAX_APPS_PAGE_SIZE, Math.max(1, Math.floor(limit as number)))
    : DEFAULT_APPS_PAGE_SIZE;
  const normalizedOffset = Number.isFinite(offset)
    ? Math.max(0, Math.floor(offset as number))
    : 0;

  return {
    limit: normalizedLimit,
    offset: normalizedOffset,
  };
}

export function getAppsPaginationState(
  totalItems: number,
  limit: number | undefined,
  offset: number | undefined,
  visibleItems: number,
): AppsPaginationState {
  const pagination = normalizeAppsPagination(limit, offset);
  const normalizedTotal = Number.isFinite(totalItems)
    ? Math.max(0, Math.floor(totalItems))
    : 0;
  const normalizedVisible = Number.isFinite(visibleItems)
    ? Math.max(0, Math.floor(visibleItems))
    : 0;
  const totalPages = Math.max(1, Math.ceil(normalizedTotal / pagination.limit));
  const requestedPage = Math.floor(pagination.offset / pagination.limit) + 1;

  return {
    ...pagination,
    currentPage: Math.min(totalPages, requestedPage),
    totalPages,
    rangeStart:
      normalizedVisible > 0
        ? Math.min(pagination.offset + 1, normalizedTotal)
        : 0,
    rangeEnd:
      normalizedVisible > 0
        ? Math.min(pagination.offset + normalizedVisible, normalizedTotal)
        : 0,
    hasPrevious: pagination.offset > 0,
    hasNext:
      normalizedVisible > 0 &&
      pagination.offset + normalizedVisible < normalizedTotal,
    previousOffset: Math.max(0, pagination.offset - pagination.limit),
    nextOffset: pagination.offset + pagination.limit,
  };
}

export function buildAppsPageUrl(
  currentParams: URLSearchParams,
  nextOffset: number,
): string {
  const params = new URLSearchParams(currentParams.toString());
  const { offset } = normalizeAppsPagination(undefined, nextOffset);

  if (offset === 0) {
    params.delete("offset");
  } else {
    params.set("offset", String(offset));
  }

  const queryString = params.toString();
  return queryString ? `/apps?${queryString}` : "/apps";
}
