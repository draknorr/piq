export interface SteamTrailerManifest {
  hlsUrl: string;
  mediaId: number;
  posterUrl: string | null;
  title: string | null;
}

function decodeHtmlAttribute(value: string): string {
  return value
    .replaceAll(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16))
    )
    .replaceAll(/&#([0-9]+);/g, (_, decimal: string) =>
      String.fromCodePoint(Number.parseInt(decimal, 10))
    )
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

function steamMediaId(value: unknown): number | null {
  if (typeof value !== 'string') {
    return null;
  }
  const match = value.match(/\/steam\/apps\/(\d+)\//i);
  const id = Number(match?.[1]);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function isAllowedSteamHlsUrl(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false;
  }
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      (url.hostname === 'steamstatic.com' || url.hostname.endsWith('.steamstatic.com')) &&
      url.pathname.toLowerCase().endsWith('.m3u8')
    );
  } catch {
    return false;
  }
}

export function parseSteamTrailerManifests(html: string): SteamTrailerManifest[] {
  const manifests = new Map<number, SteamTrailerManifest>();
  const attributePattern = /data-props="([^"]+)"/g;

  for (const match of html.matchAll(attributePattern)) {
    const encoded = match[1];
    if (!encoded?.includes('trailers')) {
      continue;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(decodeHtmlAttribute(encoded));
    } catch {
      continue;
    }
    if (!payload || typeof payload !== 'object') {
      continue;
    }
    const trailers = (payload as { trailers?: unknown }).trailers;
    if (!Array.isArray(trailers)) {
      continue;
    }

    for (const value of trailers) {
      if (!value || typeof value !== 'object') {
        continue;
      }
      const trailer = value as Record<string, unknown>;
      const mediaId = steamMediaId(trailer.poster ?? trailer.thumbnail);
      if (mediaId === null || !isAllowedSteamHlsUrl(trailer.hlsManifest)) {
        continue;
      }
      manifests.set(mediaId, {
        hlsUrl: trailer.hlsManifest,
        mediaId,
        posterUrl:
          typeof trailer.poster === 'string'
            ? trailer.poster
            : typeof trailer.thumbnail === 'string'
              ? trailer.thumbnail
              : null,
        title: typeof trailer.title === 'string' ? trailer.title : null,
      });
    }
  }

  return Array.from(manifests.values());
}
