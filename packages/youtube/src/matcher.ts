import { containsWholePhrase, normalizeText } from './normalize.js';
import type { MatchDecision } from './types.js';

export const MATCHER_VERSION = 'youtube-matcher-v1-2026-04-06';

interface MatchVideoParams {
  title: string | null | undefined;
  description: string | null | undefined;
  aliases: string[];
  monitoredChannelIds?: string[];
  channelId: string | null | undefined;
}

export function matchVideoToGame(params: MatchVideoParams): MatchDecision {
  const title = params.title ?? '';
  const description = params.description ?? '';
  const aliases = params.aliases.filter(Boolean);

  for (const alias of aliases) {
    if (containsWholePhrase(title, alias)) {
      return {
        matchState: 'matched_primary',
        confidenceBucket: 'high',
        matchedAlias: alias,
        decisionSource: 'title_alias_match',
        evidenceSummary: {
          alias,
          matchedIn: 'title',
          matcherVersion: MATCHER_VERSION,
        },
      };
    }
  }

  const isMonitoredChannel = Boolean(
    params.channelId
    && params.monitoredChannelIds?.includes(params.channelId)
  );

  for (const alias of aliases) {
    if (containsWholePhrase(description, alias)) {
      return {
        matchState: isMonitoredChannel ? 'matched_primary' : 'ambiguous',
        confidenceBucket: isMonitoredChannel ? 'medium' : 'low',
        matchedAlias: alias,
        decisionSource: isMonitoredChannel ? 'monitored_channel_description_match' : 'description_alias_match',
        evidenceSummary: {
          alias,
          matchedIn: 'description',
          monitoredChannel: isMonitoredChannel,
          matcherVersion: MATCHER_VERSION,
        },
      };
    }
  }

  return {
    matchState: 'rejected',
    confidenceBucket: 'low',
    matchedAlias: null,
    decisionSource: 'no_alias_match',
    evidenceSummary: {
      normalizedTitle: normalizeText(title).slice(0, 200),
      matcherVersion: MATCHER_VERSION,
    },
  };
}
