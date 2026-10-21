// The daily Next Fest job rewrites only the payload inside atlas.html (see
// scripts/ops/export-next-fest-popularity.mjs). The explorer shell carries the
// page design separately so UI changes never collide with those data commits.
const ATLAS_PAYLOAD = /<script type="application\/octet-stream" id="nf-payload">([A-Za-z0-9+/=\s]+)<\/script>/;

export const EXPLORER_PAYLOAD_SLOT = "<!--nf-payload-->";

export function composeNextFestPage(atlas: string, explorer: string | null): string {
  const payload = atlas.match(ATLAS_PAYLOAD)?.[1]?.trim();
  if (!explorer || !payload || !explorer.includes(EXPLORER_PAYLOAD_SLOT)) return atlas;
  return explorer.replace(EXPLORER_PAYLOAD_SLOT, () => payload);
}
