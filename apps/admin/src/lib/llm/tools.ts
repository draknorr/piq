import type { Tool } from './types';

export const QUERY_DATABASE_TOOL: Tool = {
  type: 'function',
  function: {
    name: 'query_database',
    description: `Query the Steam analytics PostgreSQL database. Use this to answer questions about games, publishers, developers, reviews, player counts, and trends.

RULES:
- Only SELECT queries are allowed
- MUST include ORDER BY for list queries (default: release_date DESC)
- Always include LIMIT (max 50 rows)
- Use explicit JOINs (no implicit joins)
- Use ILIKE for case-insensitive text searches
- For latest metrics, filter: metric_date = (SELECT MAX(metric_date) FROM daily_metrics WHERE appid = a.appid)
- Use NULLIF(total_reviews, 0) when calculating ratios to avoid division by zero

Return the SQL query that answers the user's question.`,
    parameters: {
      type: 'object',
      properties: {
        sql: {
          type: 'string',
          description:
            'The SELECT SQL query to execute. Must be valid PostgreSQL with LIMIT clause.',
        },
        reasoning: {
          type: 'string',
          description:
            'Brief explanation of why this query answers the user question and what tables/joins are used.',
        },
      },
      required: ['sql', 'reasoning'],
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

Returns results with fields: id (entity ID for links), name, type ("game"/"publisher"/"developer"), and optional score/genres/tags.
Use the 'type' field to determine link format: [name](game:{id}), [name](/publishers/{id}), or [name](/developers/{id}).`,
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

IMPORTANT: Call this tool DIRECTLY with all parameters. Do NOT call lookup_tags first.

Examples - call search_games directly like this:
- "Action RPG games from 2025" → tags: ["Action RPG"], release_year: {gte: 2025, lte: 2025}
- "JRPG games with good reviews" → tags: ["JRPG"], review_percentage: {gte: 80}
- "Steam Deck roguelikes with great reviews" → tags: ["Roguelike"], steam_deck: ["verified"], review_percentage: {gte: 90}
- "Metroidvania games on Steam Deck" → tags: ["Metroidvania"], steam_deck: ["verified"]
- "Cozy games with good reviews" → tags: ["Cozy"], review_percentage: {gte: 80}

Tags are the PRIMARY filter - use for game types like Action RPG, JRPG, Roguelike, Souls-like, etc.
Genres are SECONDARY - only use for broad categories like Indie, Free to Play, Early Access.

Returns results with fields: appid (for game: links), name, platforms, review data, etc.
Always format game names as: [name](game:{appid})`,
    parameters: {
      type: 'object',
      properties: {
        tags: {
          type: 'array',
          items: { type: 'string' },
          description:
            'PRIMARY filter - Steam tags (fuzzy match). Use for game types: "Action RPG", "JRPG", "CRPG", "Roguelike", "Souls-like", "Metroidvania", "Survival Horror", "Cozy"',
        },
        genres: {
          type: 'array',
          items: { type: 'string' },
          description:
            'SECONDARY filter - broad Steam categories only (fuzzy match): "Indie", "Free to Play", "Early Access", "Simulation". For specific game types, use tags instead.',
        },
        categories: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Steam feature categories (fuzzy match). Examples: "Achievements", "Cloud Saves", "Co-op", "Workshop", "VR"',
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
        metacritic_score: {
          type: 'object',
          properties: {
            gte: { type: 'number', description: 'Minimum Metacritic score (0-100)' },
          },
          description: 'Metacritic score filter',
        },
        is_free: {
          type: 'boolean',
          description: 'Filter by free-to-play status',
        },
        on_sale: {
          type: 'boolean',
          description: 'Filter to games currently on sale (has active discount)',
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

IMPORTANT: Do NOT use this tool for common tags like Roguelike, Metroidvania, Souls-like, CRPG, Cozy, RPG, Action, etc. - these work directly with search_games.

Only use this tool when:
- User asks "what tags exist for X" or "show me available tags"
- You encounter an unusual tag name you don't recognize`,
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

export const TOOLS: Tool[] = [QUERY_DATABASE_TOOL, FIND_SIMILAR_TOOL, SEARCH_GAMES_TOOL, LOOKUP_TAGS_TOOL];
