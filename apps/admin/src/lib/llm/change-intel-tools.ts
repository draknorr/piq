import type { Tool } from './types';

export const QUERY_CHANGE_ACTIVITY_TOOL: Tool = {
  type: 'function',
  function: {
    name: 'query_change_activity',
    description: `Query recent Steam change activity across many games using the structured change-intelligence data.

Use this for:
- "Show me the biggest store-page changes in the last 30 days"
- "Which upcoming games changed release timing recently?"
- "Find games that refreshed art but did not post an announcement"

This is the primary cross-game change-discovery tool.
It supports natural-language variations through broad filters, not exact prompt wording.`,
    parameters: {
      type: 'object',
      properties: {
        days: {
          type: 'number',
          description: 'Lookback window in days. Defaults to 30 and is capped server-side.',
        },
        view: {
          type: 'string',
          enum: ['overview', 'launch-watch', 'commercial-moves', 'store-refreshes', 'all-activity'],
          description: 'High-level activity lens. Use "all-activity" for broad searches.',
        },
        mode: {
          type: 'string',
          enum: ['all', 'changes', 'announcements'],
          description: 'Whether to include change cards, announcement cards, or both.',
        },
        sort: {
          type: 'string',
          enum: ['relevant', 'newest', 'biggest-change', 'most-commercial', 'most-launch-relevant'],
          description: 'How to sort the activity results.',
        },
        app_types: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional app types to include, usually ["game"].',
        },
        signal_families: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['announcement', 'release', 'pricing', 'store-page', 'media', 'taxonomy', 'platform', 'build'],
          },
          description: 'Optional signal families to narrow the activity stream.',
        },
        search: {
          type: 'string',
          description: 'Optional app-name text filter when the user mentions a known title or narrow text search.',
        },
        limit: {
          type: 'number',
          description: 'Maximum rows to return. Defaults to 10 and is capped server-side.',
        },
      },
      required: [],
    },
  },
};

export const GET_GAME_CHANGE_TIMELINE_TOOL: Tool = {
  type: 'function',
  function: {
    name: 'get_game_change_timeline',
    description: `Get a structured timeline of Steam change events for one game.

Use this for:
- "What changed on Hades II in the last 90 days?"
- "Show me all recent Steam page changes for No Rest for the Wicked"
- "What changed before the last update?"

Provide app_name unless you already have a trusted appid from lookup_games.`,
    parameters: {
      type: 'object',
      properties: {
        app_name: {
          type: 'string',
          description: 'Steam game name to resolve with fuzzy matching.',
        },
        appid: {
          type: 'number',
          description: 'Optional Steam appid if already resolved.',
        },
        days: {
          type: 'number',
          description: 'Lookback window in days. Defaults to 90 and is capped server-side.',
        },
        signal_families: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['announcement', 'release', 'pricing', 'store-page', 'media', 'taxonomy', 'platform', 'build'],
          },
          description: 'Optional signal families to filter the timeline.',
        },
        limit: {
          type: 'number',
          description: 'Maximum events to return. Defaults to 20 and is capped server-side.',
        },
      },
      required: [],
    },
  },
};

export const GET_RECENT_NEWS_DIGEST_TOOL: Tool = {
  type: 'function',
  function: {
    name: 'get_recent_news_digest',
    description: `Get a bounded digest of recent Steam news bodies for one game or a small known set of games.

Use this for:
- "What actually changed in the latest Steam news for Hades II?"
- "Summarize the most important recent Steam news updates for ARC Raiders"
- "Summarize the most meaningful recent Steam news across these 3 titles"

Prefer this over query_change_activity when the user explicitly wants the recent news itself summarized, not the broader change timeline.`,
    parameters: {
      type: 'object',
      properties: {
        app_name: {
          type: 'string',
          description: 'Single Steam game name to resolve when summarizing one title.',
        },
        appid: {
          type: 'number',
          description: 'Optional Steam appid for a single known title.',
        },
        app_names: {
          type: 'array',
          items: { type: 'string' },
          description: 'Small explicit set of Steam game names when summarizing recent news across multiple known titles.',
        },
        appids: {
          type: 'array',
          items: { type: 'number' },
          description: 'Optional small set of known Steam appids when summarizing recent news across multiple titles.',
        },
        days: {
          type: 'number',
          description: 'Lookback window in days. Defaults to 14 and is capped server-side.',
        },
        limit: {
          type: 'number',
          description: 'Maximum news items to read. Defaults to 4 for one title or 6 for multiple titles and is capped server-side.',
        },
      },
      required: [],
    },
  },
};

export const GET_CHANGE_ACTIVITY_DETAIL_TOOL: Tool = {
  type: 'function',
  function: {
    name: 'get_change_activity_detail',
    description: `Get the full detail for one change-activity card or announcement card, including before/after diffs and related announcements.

Use this after query_change_activity when you need the exact details behind one result.`,
    parameters: {
      type: 'object',
      properties: {
        activity_id: {
          type: 'string',
          description: 'The activityId returned by query_change_activity.',
        },
      },
      required: ['activity_id'],
    },
  },
};

export const COMPARE_CHANGE_BEFORE_AFTER_TOOL: Tool = {
  type: 'function',
  function: {
    name: 'compare_change_before_after',
    description: `Compare the before/after state around a significant recent change burst for one game.

Use this for:
- "What changed before and after its last major update?"
- "Compare the latest Steam-page refresh for Hades II"

If you already have a change activity id, pass activity_id. Otherwise pass app_name.`,
    parameters: {
      type: 'object',
      properties: {
        activity_id: {
          type: 'string',
          description: 'Optional change activity id from query_change_activity.',
        },
        app_name: {
          type: 'string',
          description: 'Game name to resolve with fuzzy matching if no activity_id is available.',
        },
        appid: {
          type: 'number',
          description: 'Optional Steam appid if already resolved.',
        },
        days: {
          type: 'number',
          description: 'How far back to search for a recent relevant burst when activity_id is not supplied.',
        },
      },
      required: [],
    },
  },
};

export const FIND_CHANGE_PATTERNS_TOOL: Tool = {
  type: 'function',
  function: {
    name: 'find_change_patterns',
    description: `Find games that match a higher-level change-intelligence pattern using deterministic evidence rules.

Use this for:
- "Games starting a new marketing push"
- "Likely relaunch patterns"
- "Games teasing a big update"
- "Major Steam announcements with weak downstream response"
- "Under-marketed games"
- "Signable candidates"
- "Rescue candidates"
- "Changes with sustained response"`,
    parameters: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          enum: [
            'marketing_push',
            'relaunch_pattern',
            'update_tease',
            'under_marketed',
            'signable_candidate',
            'rescue_candidate',
            'sustained_response',
            'announcement_weak_response',
          ],
          description: 'The pattern to search for.',
        },
        days: {
          type: 'number',
          description: 'Lookback window in days. Defaults to 30 and is capped server-side.',
        },
        search: {
          type: 'string',
          description: 'Optional text filter when the user mentions a title or narrow subset.',
        },
        app_types: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional app types to include, usually ["game"].',
        },
        limit: {
          type: 'number',
          description: 'Maximum pattern matches to return. Defaults to 10 and is capped server-side.',
        },
      },
      required: ['pattern'],
    },
  },
};
