import {
  API_URLS,
  parseSteamTrailerManifests,
  type SteamTrailerManifest,
} from "@publisheriq/shared";

export type OpportunityTrailerManifestResolver = (
  appid: number,
) => Promise<SteamTrailerManifest[]>;

export async function resolveSteamTrailerManifests(
  appid: number,
  fetchImpl: typeof fetch = fetch,
): Promise<SteamTrailerManifest[]> {
  const response = await fetchImpl(
    `${API_URLS.STEAM_STORE}/app/${appid}/?l=english&cc=us`,
    {
      headers: {
        Accept: "text/html",
        Cookie: "birthtime=0; mature_content=1",
      },
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!response.ok) {
    throw new Error(`Steam trailer metadata returned HTTP ${response.status}.`);
  }
  return parseSteamTrailerManifests(await response.text());
}
