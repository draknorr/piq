/**
 * Chat LLM tools.
 *
 * The remaining tool surface is system-backed or a system-backed compatibility
 * alias. Legacy Cube/Supabase answer-path tools are not exposed here.
 */

import type { Tool } from './types';
import {
  COMPARE_CHANGE_BEFORE_AFTER_TOOL,
  FIND_CHANGE_PATTERNS_TOOL,
  GET_CHANGE_ACTIVITY_DETAIL_TOOL,
  GET_GAME_CHANGE_TIMELINE_TOOL,
  GET_RECENT_NEWS_DETAIL_TOOL,
  GET_RECENT_NEWS_DIGEST_TOOL,
  QUERY_CHANGE_ACTIVITY_TOOL,
  SEARCH_RECENT_NEWS_TOPICS_TOOL,
} from './change-intel-tools';

export const QUERY_ANALYTICS_TOOL: Tool = {
  type: 'function',
  function: {
    name: 'query_analytics',
    description: `Query game, publisher, and developer analytics through PublisherIQ compatibility models.

CUBES:
- Discovery: Games with discovery, trend, and metacritic metrics
- GameCatalog: One-row-per-game catalog for specific lookups and generalized price/review discovery
- DlcRelations: Parent-to-DLC relationship lookup with metadata completeness flags
- PublisherMetrics: Publisher ALL-TIME aggregations
- PublisherYearMetrics: Publisher stats by release year
- PublisherGameMetrics: Games by publisher with rolling periods (lastYear, last6Months, etc.)
- PublisherRelationshipMetrics: Publisher relationship and self-published signals
- PublisherChatScreenMetrics: Chat-only publisher relationship screen with indie/hit/review context
- PublisherChatWindowMetrics: Chat-only publisher rolling-window release metrics with meaningful-release context
- DeveloperMetrics: Developer ALL-TIME aggregations
- DeveloperYearMetrics: Developer stats by release year
- DeveloperGameMetrics: Games by developer with rolling periods (lastYear, last6Months, etc.)
- DeveloperRelationshipMetrics: Developer relationship and self-published signals
- DeveloperChatScreenMetrics: Chat-only developer relationship screen with indie/hit/review context
- DeveloperChatWindowMetrics: Chat-only developer rolling-window release metrics with meaningful-release context
- DailyMetrics: Historical time-series data
- LatestMetrics: Current snapshot of metrics
- MonthlyGameMetrics: Monthly estimated played hours per game (use for "top games by playtime last month")
- MonthlyPublisherMetrics: Monthly estimated played hours per publisher

DIMENSION PREFIXING REQUIRED: Always prefix dimensions with cube name.
Example: "MonthlyGameMetrics.appid", "Discovery.name", NOT just "appid" or "name".

IMPORTANT - USE SEGMENTS FOR COMMON FILTERS:
- Trending games → segment "Discovery.trending" (NOT filter on isTrendingUp)
- Good reviews → segment "Discovery.highlyRated" (80%+) or "Discovery.veryPositive" (90%+)
- Popular games → segment "Discovery.popular" (1000+ reviews)
- Steam Deck → segment "Discovery.steamDeckVerified" or "Discovery.steamDeckPlayable"
- Free games → segment "Discovery.free"
- Monthly data → segments like "MonthlyGameMetrics.lastMonth", "MonthlyGameMetrics.last3Months"
- Rolling periods → segments like "DeveloperGameMetrics.lastYear", "PublisherGameMetrics.last6Months"

Only use filters for custom thresholds not covered by segments.

ALWAYS include appid and name dimensions for game lists (e.g., Discovery.appid + Discovery.name or GameCatalog.appid + GameCatalog.name).

When the tool result includes sufficient_to_answer: true, respond from those rows instead of issuing another adjacent broad discovery query.

If a company query result includes companyAnswerHints, follow those hints exactly for ranking semantics, proof metrics, required columns, sparse/low-signal labeling, and narrative framing.

For publisher/developer/company queries, prefer filtering by publisherId/developerId from lookup results instead of filtering by name strings.`,
    parameters: {
      type: 'object',
      properties: {
        cube: {
          type: 'string',
          enum: [
            'Discovery',
            'GameCatalog',
            'DlcRelations',
            'PublisherMetrics',
            'PublisherYearMetrics',
            'PublisherGameMetrics',
            'PublisherRelationshipMetrics',
            'PublisherChatScreenMetrics',
            'PublisherChatWindowMetrics',
            'DeveloperMetrics',
            'DeveloperYearMetrics',
            'DeveloperGameMetrics',
            'DeveloperRelationshipMetrics',
            'DeveloperChatScreenMetrics',
            'DeveloperChatWindowMetrics',
            'DailyMetrics',
            'LatestMetrics',
            'MonthlyGameMetrics',
            'MonthlyPublisherMetrics',
          ],
          description: 'The cube to query. Use GameCatalog for specific game lookups and broad price/review discovery; use Discovery for discovery/trend/metacritic queries.',
        },
        dimensions: {
          type: 'array',
          items: { type: 'string' },
          description: 'Dimensions to include (e.g., ["Discovery.name", "Discovery.appid"])',
        },
        measures: {
          type: 'array',
          items: { type: 'string' },
          description: 'Measures to aggregate (e.g., ["Discovery.count", "PublisherMetrics.sumOwners"])',
        },
        filters: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              member: { type: 'string', description: 'Dimension or measure to filter on' },
              operator: {
                type: 'string',
                enum: ['equals', 'notEquals', 'contains', 'notContains', 'gt', 'gte', 'lt', 'lte', 'set', 'notSet', 'notIn', 'inDateRange', 'beforeDate', 'afterDate'],
              },
              values: {
                type: 'array',
                items: { type: 'string' },
                description: 'Filter values. For numbers, pass as strings (e.g., ["2025"] for year filters)',
              },
            },
            required: ['member', 'operator'],
          },
          description: 'Filters to apply',
        },
        segments: {
          type: 'array',
          items: { type: 'string' },
          description: 'Pre-defined segments to apply (e.g., ["Discovery.highlyRated", "Discovery.steamDeckVerified"])',
        },
        order: {
          type: 'object',
          additionalProperties: { type: 'string', enum: ['asc', 'desc'] },
          description: 'Sort order (e.g., {"Discovery.totalReviews": "desc"})',
        },
        limit: {
          type: 'number',
          description: 'Maximum results (default 50, max 100)',
        },
        reasoning: {
          type: 'string',
          description: 'Brief explanation of why this query answers the user question',
        },
      },
      required: ['cube', 'reasoning'],
    },
  },
};

export const FIND_SIMILAR_TOOL: Tool = {
  type: 'function',
  function: {
    name: 'find_similar',
    description: `Find games, publishers, or developers similar to a reference entity using semantic similarity search.

Use this tool for questions like:
- "Games like Hades" / "Similar to Stardew Valley"
- "Hidden gems like Dead Cells" (less popular alternatives)
- "Publishers similar to Devolver Digital"
- "Better reviewed alternatives to [game]"
- "Cheaper games similar to [game]"
- "Games in the same series as Dark Souls"

Returns semantically similar entities based on genres, tags, features, and other characteristics.
For publishers/developers, the tool may fall back to heuristic portfolio similarity when semantic search is unavailable.
For company similarity, prefer a smaller precise peer set over padding with weak lexical matches.

For game similarity:
- Put game-side constraints inside \`filters\`
- Use \`same_franchise_only: true\` for exact "same series" / "same franchise" prompts
- Use \`max_reviews\`, \`review_percentage\`, and \`review_comparison\` when the user specifies review-count or review-quality constraints
- Prefer a smaller high-signal result set over padding with title-word collisions
- For reference-game prompts, \`find_similar\` is the primary tool. Do not chain \`search_by_concept\` after it just to get more rows

For publisher/developer peer prompts:
- Call find_similar directly. Do NOT call lookup_publishers or lookup_developers first.
- If the result includes sufficient_to_answer: true, respond directly from it.
- If the result is sparse, label it as limited or heuristic instead of padding with weak peers.
- If the result is empty or failed, stay constrained and say strong comparable peers were not found right now. Do NOT follow with query_analytics or generic company rankings.`,
    parameters: {
      type: 'object',
      properties: {
        entity_type: {
          type: 'string',
          enum: ['game', 'publisher', 'developer'],
          description: 'Type of entity to search for',
        },
        reference_name: {
          type: 'string',
          description: 'Name of the game/publisher/developer to find similar matches for',
        },
        filters: {
          type: 'object',
          description: 'Optional filters to narrow results',
          properties: {
            popularity_comparison: {
              type: 'string',
              enum: ['any', 'less_popular', 'similar', 'more_popular'],
              description: 'Filter by relative popularity. Use "less_popular" for hidden gems.',
            },
            review_comparison: {
              type: 'string',
              enum: ['any', 'similar_or_better', 'better_only'],
              description: 'Filter by relative review scores',
            },
            max_price_cents: {
              type: 'number',
              description: 'Maximum price in cents (e.g., 1999 for $19.99)',
            },
            is_free: {
              type: 'boolean',
              description: 'Only show free-to-play games',
            },
            platforms: {
              type: 'array',
              items: { type: 'string', enum: ['windows', 'macos', 'linux'] },
              description: 'Required platform support',
            },
            steam_deck: {
              type: 'array',
              items: { type: 'string', enum: ['verified', 'playable'] },
              description: 'Steam Deck compatibility requirement',
            },
            genres: {
              type: 'array',
              items: { type: 'string' },
              description: 'Required genres (e.g., ["Action", "RPG"])',
            },
            tags: {
              type: 'array',
              items: { type: 'string' },
              description: 'Required tags (e.g., ["Roguelike", "Indie"])',
            },
            min_reviews: {
              type: 'number',
              description: 'Minimum number of reviews',
            },
            max_reviews: {
              type: 'number',
              description: 'Maximum number of reviews',
            },
            review_percentage: {
              type: 'object',
              properties: {
                gte: { type: 'number', description: 'Minimum positive review percentage (0-100)' },
                lte: { type: 'number', description: 'Maximum positive review percentage (0-100)' },
              },
              description: 'Absolute review percentage bounds',
            },
            release_year: {
              type: 'object',
              properties: {
                gte: { type: 'number', description: 'Released in or after this year' },
                lte: { type: 'number', description: 'Released in or before this year' },
              },
            },
            same_franchise_only: {
              type: 'boolean',
              description: 'Require exact same franchise/series membership instead of broader similarity',
            },
            // Entity-specific filters (for publisher/developer searches)
            game_count: {
              type: 'object',
              properties: {
                gte: { type: 'number', description: 'Minimum games published/developed' },
                lte: { type: 'number', description: 'Maximum games published/developed' },
              },
              description: 'Filter publishers/developers by game count',
            },
            avg_review_percentage: {
              type: 'object',
              properties: {
                gte: { type: 'number', description: 'Minimum average review % (0-100)' },
                lte: { type: 'number', description: 'Maximum average review % (0-100)' },
              },
              description: 'Filter by average review score across portfolio',
            },
            is_major: {
              type: 'boolean',
              description: 'Filter for major publishers (10+ games)',
            },
            is_indie: {
              type: 'boolean',
              description: 'Filter for indie developers (self-published)',
            },
            top_genres: {
              type: 'array',
              items: { type: 'string' },
              description: 'Filter by primary genres in portfolio',
            },
            top_tags: {
              type: 'array',
              items: { type: 'string' },
              description: 'Filter by common tags in portfolio',
            },
          },
        },
        limit: {
          type: 'number',
          description: 'Maximum results to return (1-20, default 10)',
        },
      },
      required: ['entity_type', 'reference_name'],
    },
  },
};

export const SEARCH_GAMES_TOOL: Tool = {
  type: 'function',
  function: {
    name: 'search_games',
    description: `Search for games by tags, genres, categories, platforms, and other criteria.

Use this tool when users ask for games with specific characteristics like:
- "CRPG games for Mac"
- "Cozy games released in 2019"
- "Souls-like games with full controller support"
- "Metroidvania games on Steam Deck"
- "Games with Workshop support"

Supports fuzzy tag matching - you don't need exact tag names.

When the tool result includes sufficient_to_answer: true, respond from those rows instead of issuing another adjacent discovery query.`,
    parameters: {
      type: 'object',
      properties: {
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Steam tags to filter by (fuzzy match). Examples: "CRPG", "Cozy", "Souls-like", "Metroidvania", "Pixel Graphics"',
        },
        genres: {
          type: 'array',
          items: { type: 'string' },
          description: 'Genres to filter by (fuzzy match). Examples: "RPG", "Action", "Adventure", "Indie", "Strategy"',
        },
        categories: {
          type: 'array',
          items: { type: 'string' },
          description: 'Steam feature categories (fuzzy match). Examples: "Achievements", "Cloud Saves", "Co-op", "Workshop", "VR"',
        },
        platforms: {
          type: 'array',
          items: { type: 'string', enum: ['windows', 'macos', 'linux'] },
          description: 'Required platform support',
        },
        controller_support: {
          type: 'string',
          enum: ['full', 'partial', 'any'],
          description: 'Controller support level required',
        },
        steam_deck: {
          type: 'array',
          items: { type: 'string', enum: ['verified', 'playable'] },
          description: 'Steam Deck compatibility requirement',
        },
        release_year: {
          type: 'object',
          properties: {
            gte: { type: 'number', description: 'Released in or after this year' },
            lte: { type: 'number', description: 'Released in or before this year' },
          },
          description: 'Release year range filter',
        },
        review_percentage: {
          type: 'object',
          properties: {
            gte: { type: 'number', description: 'Minimum positive review percentage (0-100)' },
          },
          description: 'Review score filter',
        },
        min_reviews: {
          type: 'number',
          description: 'Minimum total review count',
        },
        metacritic_score: {
          type: 'object',
          properties: {
            gte: { type: 'number', description: 'Minimum Metacritic score (0-100)' },
          },
          description: 'Metacritic score filter',
        },
        min_price_cents: {
          type: 'number',
          description: 'Minimum price in cents (e.g., 4000 for $40.00)',
        },
        max_price_cents: {
          type: 'number',
          description: 'Maximum price in cents (e.g., 999 for $9.99)',
        },
        is_free: {
          type: 'boolean',
          description: 'Filter by free-to-play status',
        },
        on_sale: {
          type: 'boolean',
          description: 'Filter to games currently on sale (has active discount)',
        },
        min_discount_percent: {
          type: 'number',
          description: 'Minimum active discount percentage (0-100)',
        },
        limit: {
          type: 'number',
          description: 'Maximum results to return (default 20, max 50)',
        },
        order_by: {
          type: 'string',
          enum: ['reviews', 'score', 'release_date', 'owners'],
          description: 'Sort order: reviews (default), score, release_date, or owners',
        },
      },
      required: [],
    },
  },
};

export const LOOKUP_TAGS_TOOL: Tool = {
  type: 'function',
  function: {
    name: 'lookup_tags',
    description: `Search for available Steam tags, genres, or categories.

Use this tool when you need to:
- Find the correct tag name for a concept (e.g., "rogue" → "Roguelike", "Roguelite")
- Discover what tags/genres/categories exist
- Verify a tag exists before using it in search_games

When a canonical tag exists, the result may also include adjacent related tags that are useful follow-up filters.`,
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query to find matching tags/genres/categories',
        },
        type: {
          type: 'string',
          enum: ['tags', 'genres', 'categories', 'all'],
          description: 'Type to search: tags, genres, categories, or all (default)',
        },
        limit: {
          type: 'number',
          description: 'Maximum results per type (default 10, max 20)',
        },
      },
      required: ['query'],
    },
  },
};

export const LOOKUP_PUBLISHERS_TOOL: Tool = {
  type: 'function',
  function: {
    name: 'lookup_publishers',
    description: `Search for available publisher names in the database.

Use this tool BEFORE querying for games by publisher to find the exact name:
- User says "Krafton" → lookup finds "Krafton Inc." → use exact name in query
- User says "Devolver" → lookup finds "Devolver Digital" → use exact name in query

Returns ranked publisher candidates, a canonicalResult when resolution is confident, a compact summary object, and a needsDisambiguation flag when the name is ambiguous.

Use lookup only for identity resolution. If the user then asks for company counts, rankings, comparisons, or top titles, use the relevant system-backed search, compare, or trend tool rather than answering from lookup alone.`,
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Publisher name to search for (partial match)',
        },
        limit: {
          type: 'number',
          description: 'Maximum results (default 10, max 20)',
        },
      },
      required: ['query'],
    },
  },
};

export const LOOKUP_DEVELOPERS_TOOL: Tool = {
  type: 'function',
  function: {
    name: 'lookup_developers',
    description: `Search for available developer names in the database.

Use this tool BEFORE querying for games by developer to find the exact name:
- User says "FromSoftware" → lookup finds "FromSoftware, Inc." → use exact name in query
- User says "Respawn" → lookup finds "Respawn Entertainment" → use exact name in query

Returns ranked developer candidates, a canonicalResult when resolution is confident, a compact summary object, and a needsDisambiguation flag when the name is ambiguous.

Use lookup only for identity resolution. If the user then asks for company counts, rankings, comparisons, or top titles, use the relevant system-backed search, compare, or trend tool rather than answering from lookup alone.`,
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Developer name to search for (partial match)',
        },
        limit: {
          type: 'number',
          description: 'Maximum results (default 10, max 20)',
        },
      },
      required: ['query'],
    },
  },
};

export const SEARCH_BY_CONCEPT_TOOL: Tool = {
  type: 'function',
  function: {
    name: 'search_by_concept',
    description: `Search for games matching a natural language description using semantic similarity.

Use this tool for concept-based queries WITHOUT a reference game:
- "tactical roguelikes with deck building"
- "cozy farming games with crafting"
- "horror games with investigation elements"
- "fast-paced action games with pixel art"

This searches the game database using semantic understanding of the description.
For "games like X", use find_similar instead.

Use this for taste and concept prompts, but keep quality high:
- favor supported, reviewed games over literal title-word collisions
- use \`min_reviews\` and \`review_percentage\` when the prompt implies curation or taste
- prefer a smaller strong set over a padded low-signal list
- if the result includes \`sufficient_to_answer: true\`, respond directly instead of issuing a second concept search.`,
    parameters: {
      type: 'object',
      properties: {
        description: {
          type: 'string',
          description: 'Natural language description of the type of game to find',
        },
        filters: {
          type: 'object',
          description: 'Optional filters to narrow results',
          properties: {
            max_price_cents: {
              type: 'number',
              description: 'Maximum price in cents (e.g., 1999 for $19.99)',
            },
            is_free: {
              type: 'boolean',
              description: 'Only show free-to-play games',
            },
            platforms: {
              type: 'array',
              items: { type: 'string', enum: ['windows', 'macos', 'linux'] },
              description: 'Required platform support',
            },
            steam_deck: {
              type: 'array',
              items: { type: 'string', enum: ['verified', 'playable'] },
              description: 'Steam Deck compatibility requirement',
            },
            genres: {
              type: 'array',
              items: { type: 'string' },
              description: 'Required genres (e.g., ["Action", "RPG"])',
            },
            tags: {
              type: 'array',
              items: { type: 'string' },
              description: 'Required tags (e.g., ["Roguelike", "Indie"])',
            },
            min_reviews: {
              type: 'number',
              description: 'Minimum number of reviews',
            },
            max_reviews: {
              type: 'number',
              description: 'Maximum number of reviews',
            },
            release_year: {
              type: 'object',
              properties: {
                gte: { type: 'number', description: 'Released in or after this year' },
                lte: { type: 'number', description: 'Released in or before this year' },
              },
            },
            review_percentage: {
              type: 'object',
              properties: {
                gte: { type: 'number', description: 'Minimum positive review percentage (0-100)' },
                lte: { type: 'number', description: 'Maximum positive review percentage (0-100)' },
              },
            },
          },
        },
        limit: {
          type: 'number',
          description: 'Maximum results to return (1-20, default 10)',
        },
      },
      required: ['description'],
    },
  },
};

export const DISCOVER_TRENDING_TOOL: Tool = {
  type: 'function',
  function: {
    name: 'discover_trending',
    description: `Discover games with trend momentum based on review activity.

Use for:
- "Games gaining traction this week"
- "What's breaking out right now?"
- "Games with accelerating reviews"
- "Declining games" / "Games losing momentum"

Trend types:
- review_momentum: Highest review activity (most reviews/day)
- accelerating: Games where review rate is increasing
- breaking_out: Hidden gems gaining sudden attention (accelerating + not mainstream)
- declining: Games where review velocity is dropping`,
    parameters: {
      type: 'object',
      properties: {
        trend_type: {
          type: 'string',
          enum: ['review_momentum', 'accelerating', 'breaking_out', 'declining'],
          description: 'Type of trend to discover',
        },
        timeframe: {
          type: 'string',
          enum: ['7d', '30d'],
          description: 'Timeframe for analysis (default: 7d)',
        },
        filters: {
          type: 'object',
          description: 'Optional filters to narrow results',
          properties: {
            tags: {
              type: 'array',
              items: { type: 'string' },
              description: 'Required tags (e.g., ["Roguelike", "Indie"])',
            },
            genres: {
              type: 'array',
              items: { type: 'string' },
              description: 'Required genres (e.g., ["Action", "RPG"])',
            },
            platforms: {
              type: 'array',
              items: { type: 'string', enum: ['windows', 'macos', 'linux'] },
              description: 'Required platform support',
            },
            steam_deck: {
              type: 'array',
              items: { type: 'string', enum: ['verified', 'playable'] },
              description: 'Steam Deck compatibility requirement',
            },
            min_reviews: {
              type: 'number',
              description: 'Minimum total reviews',
            },
            max_reviews: {
              type: 'number',
              description: 'Maximum total reviews (for hidden gems)',
            },
            is_free: {
              type: 'boolean',
              description: 'Filter by free-to-play status',
            },
            release_year: {
              type: 'object',
              properties: {
                gte: { type: 'number', description: 'Released in or after this year' },
                lte: { type: 'number', description: 'Released in or before this year' },
              },
            },
          },
        },
        limit: {
          type: 'number',
          description: 'Maximum results (1-20, default 10)',
        },
      },
      required: ['trend_type'],
    },
  },
};

export const SCREEN_GAMES_TOOL: Tool = {
  type: 'function',
  function: {
    name: 'screen_games',
    description: `Screen and rank games using the same filter surface as the Games page, plus trend and sentiment metrics.

Use this when the user needs strict filtering plus the right ranking metric:
- "What free-to-play games have the most players right now?"
- "What horror games are gaining momentum?"
- "What games are trending right now?"
- "What games are trending up in reviews right now?"
- "Show me games with improving sentiment"
- "Breaking out indie games this month"
- "Compare top roguelites by review velocity and CCU"

Use this instead of discover_trending when the prompt depends on:
- current players / CCU (NOT owners)
- review-trend leaderboards with an exact recent window
- sentiment change
- strict tags or genres like horror
- strict hard filters like 95%+ reviews
- indie heuristics
- same-population comparisons`,
    parameters: {
      type: 'object',
      properties: {
        sort_by: {
          type: 'string',
          enum: [
            'ccu_peak',
            'momentum_score',
            'velocity_7d',
            'velocity_acceleration',
            'reviews_added_7d',
            'reviews_added_30d',
            'sentiment_delta',
            'total_reviews',
            'review_score',
          ],
          description: 'Primary ranking metric for the screen',
        },
        sort_order: {
          type: 'string',
          enum: ['asc', 'desc'],
          description: 'Sort direction (default: desc)',
        },
        timeframe: {
          type: 'string',
          enum: ['current', '7d', '30d'],
          description: 'Timeframe label to use for the answer (default: 7d)',
        },
        trend_profile: {
          type: 'string',
          enum: ['market_leaders', 'breakout_watchlist'],
          description: 'Broad trend interpretation. Use "market_leaders" for prompts like "what games are trending right now?" when the answer should read like scaled current leaders rather than tiny breakout spikes.',
        },
        indie_heuristic: {
          type: 'boolean',
          description: 'Apply the indie heuristic: prefer mostly self-published studios with small catalogs, using the Steam Indie tag only as supporting evidence',
        },
        filters: {
          type: 'object',
          description: 'Optional filters to narrow the screen',
          properties: {
            tags: {
              type: 'array',
              items: { type: 'string' },
              description: 'Tag-style content filters such as Roguelite or Horror',
            },
            genres: {
              type: 'array',
              items: { type: 'string' },
              description: 'Broad genre filters',
            },
            categories: {
              type: 'array',
              items: { type: 'string' },
              description: 'Steam feature categories',
            },
            verified_tags_any: {
              type: 'array',
              items: { type: 'string' },
              description: 'Require exact verified Steam tag membership for at least one listed tag; use this when tag trust matters',
            },
            platforms: {
              type: 'array',
              items: { type: 'string', enum: ['windows', 'macos', 'linux'] },
              description: 'Required platform support',
            },
            steam_deck: {
              type: 'array',
              items: { type: 'string', enum: ['verified', 'playable'] },
              description: 'Steam Deck compatibility requirement',
            },
            is_free: {
              type: 'boolean',
              description: 'Filter by free-to-play status',
            },
            min_reviews: {
              type: 'number',
              description: 'Minimum total Steam reviews',
            },
            max_reviews: {
              type: 'number',
              description: 'Maximum total Steam reviews',
            },
            min_reviews_added_7d: {
              type: 'number',
              description: 'Minimum new reviews added in the last 7 days; use this to avoid low-signal momentum rows',
            },
            min_reviews_added_30d: {
              type: 'number',
              description: 'Minimum new reviews added in the last 30 days; use this to avoid low-signal sentiment rows',
            },
            min_score: {
              type: 'number',
              description: 'Minimum positive review percentage (0-100)',
            },
            max_score: {
              type: 'number',
              description: 'Maximum positive review percentage (0-100)',
            },
            release_year: {
              type: 'object',
              properties: {
                gte: { type: 'number', description: 'Released in or after this year' },
                lte: { type: 'number', description: 'Released in or before this year' },
              },
            },
            self_published: {
              type: 'boolean',
              description: 'Require the developer to also be the publisher',
            },
            publisher_size: {
              type: 'string',
              enum: ['indie', 'mid', 'major'],
              description: 'Publisher catalog size heuristic',
            },
            min_ccu: {
              type: 'number',
              description: 'Minimum peak CCU in the latest snapshot',
            },
            min_sentiment_delta: {
              type: 'number',
              description: 'Minimum sentiment delta',
            },
            max_sentiment_delta: {
              type: 'number',
              description: 'Maximum sentiment delta',
            },
          },
        },
        limit: {
          type: 'number',
          description: 'Maximum results (1-20, default 10)',
        },
      },
      required: ['sort_by'],
    },
  },
};

export const LOOKUP_GAMES_TOOL: Tool = {
  type: 'function',
  function: {
    name: 'lookup_games',
    description: `Search for games by name in the database.

Use this tool when users ask about a SPECIFIC game:
- "ARC Raiders" → lookup_games("ARC Raiders") to find appid
- "Elden Ring" → lookup_games("Elden Ring") to find appid
- "What's the review score for Hades?" → lookup first

Returns matching games with appid and name. Use the resolved game in subsequent system-backed discovery, compare, history, or change-intel calls.`,
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Game name to search for (partial match)',
        },
        limit: {
          type: 'number',
          description: 'Maximum results (default 10, max 20)',
        },
      },
      required: ['query'],
    },
  },
};

// Export all tools for the chat interface
export const CUBE_TOOLS: Tool[] = [
  QUERY_CHANGE_ACTIVITY_TOOL,
  GET_GAME_CHANGE_TIMELINE_TOOL,
  GET_RECENT_NEWS_DETAIL_TOOL,
  GET_RECENT_NEWS_DIGEST_TOOL,
  SEARCH_RECENT_NEWS_TOPICS_TOOL,
  GET_CHANGE_ACTIVITY_DETAIL_TOOL,
  COMPARE_CHANGE_BEFORE_AFTER_TOOL,
  FIND_CHANGE_PATTERNS_TOOL,
  FIND_SIMILAR_TOOL,
  SEARCH_BY_CONCEPT_TOOL,
  SEARCH_GAMES_TOOL,
  SCREEN_GAMES_TOOL,
  DISCOVER_TRENDING_TOOL,
  LOOKUP_TAGS_TOOL,
  LOOKUP_PUBLISHERS_TOOL,
  LOOKUP_DEVELOPERS_TOOL,
  LOOKUP_GAMES_TOOL,
];
