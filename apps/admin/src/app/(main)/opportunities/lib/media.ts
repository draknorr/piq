import type { OpportunityMedia } from "./types";

export type OpportunityGalleryItem =
  | {
      fullUrl: string;
      id: string;
      kind: "header" | "screenshot";
      label: string;
      previewUrl: string;
    }
  | {
      hlsUrl: string | null;
      id: string;
      kind: "trailer";
      label: string;
      mediaId: number | null;
      mp4Url: string | null;
      previewUrl: string | null;
      webmUrl: string | null;
    };

export function buildOpportunityGallery(
  media: OpportunityMedia,
): OpportunityGalleryItem[] {
  const items: OpportunityGalleryItem[] = [];
  if (media.headerImageUrl) {
    items.push({
      fullUrl: media.headerImageUrl,
      id: "header",
      kind: "header",
      label: "Steam header art",
      previewUrl: media.headerImageUrl,
    });
  }
  media.trailers.forEach((trailer, index) => {
    if (
      !trailer.thumbnailUrl &&
      !trailer.mp4Url &&
      !trailer.webmUrl &&
      !trailer.hlsUrl
    ) {
      return;
    }
    items.push({
      hlsUrl: trailer.hlsUrl,
      id: `trailer:${trailer.id ?? index}`,
      kind: "trailer",
      label: trailer.name?.trim() || `Trailer ${index + 1}`,
      mediaId: trailer.id,
      mp4Url: trailer.mp4Url,
      previewUrl: trailer.thumbnailUrl,
      webmUrl: trailer.webmUrl,
    });
  });
  media.screenshots.forEach((screenshot, index) => {
    if (!screenshot.fullUrl) {
      return;
    }
    items.push({
      fullUrl: screenshot.fullUrl,
      id: `screenshot:${screenshot.id ?? index}`,
      kind: "screenshot",
      label: `Screenshot ${index + 1}`,
      previewUrl: screenshot.thumbnailUrl ?? screenshot.fullUrl,
    });
  });
  return items;
}

export function opportunityGalleryIndex(
  items: OpportunityGalleryItem[],
  itemId: string,
): number {
  const index = items.findIndex((item) => item.id === itemId);
  return index < 0 ? 0 : index;
}
