const REPORTS_BASE_PATH = "/reports";
const REPORTS_ACCESS_PATH = "/reports/access";

export function sanitizeReportsNextPath(value: FormDataEntryValue | string | string[] | null | undefined): string {
  const candidate = Array.isArray(value) ? value[0] : value;

  if (typeof candidate !== "string" || !candidate.trim()) {
    return REPORTS_BASE_PATH;
  }

  try {
    const url = new URL(candidate, "https://publisheriq.local");

    if (url.origin !== "https://publisheriq.local") {
      return REPORTS_BASE_PATH;
    }

    if (!url.pathname.startsWith(REPORTS_BASE_PATH) || url.pathname.startsWith(REPORTS_ACCESS_PATH)) {
      return REPORTS_BASE_PATH;
    }

    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return REPORTS_BASE_PATH;
  }
}

export function buildReportsGateUrl(requestUrl: string, error: string | null, nextPath: string): URL {
  const url = new URL(REPORTS_BASE_PATH, requestUrl);

  if (error) {
    url.searchParams.set("error", error);
  }

  if (nextPath !== REPORTS_BASE_PATH) {
    url.searchParams.set("next", nextPath);
  }

  return url;
}
