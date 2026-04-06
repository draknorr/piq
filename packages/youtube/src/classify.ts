import type { ContentClass, YoutubeVideo } from './types.js';

export const CONTENT_CLASSIFICATION_VERSION = 'youtube-content-v1-2026-04-06';

export function parseIso8601DurationToSeconds(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const match = value.match(/^P(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)$/);
  if (!match) {
    return null;
  }

  const [, hours, minutes, seconds] = match;
  return (
    Number(hours ?? 0) * 3600
    + Number(minutes ?? 0) * 60
    + Number(seconds ?? 0)
  );
}

export function classifyVideo(video: YoutubeVideo): ContentClass {
  const hasLiveContext = Boolean(
    video.liveStreamingDetails?.actualStartTime
    || video.liveStreamingDetails?.scheduledStartTime
    || (video.snippet?.liveBroadcastContent && video.snippet.liveBroadcastContent !== 'none')
  );

  if (hasLiveContext) {
    return 'live_or_recent_live';
  }

  const durationSeconds = parseIso8601DurationToSeconds(video.contentDetails?.duration);
  if (durationSeconds !== null && durationSeconds <= 180) {
    return 'short';
  }

  return 'standard_video';
}
