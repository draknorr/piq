/**
 * Generates contextual follow-up query suggestions based on chat response.
 * Uses tool calls and results to create relevant suggestions.
 */

import type { ChatToolCall } from '@/lib/llm/types';
import type { QuerySuggestion } from './query-templates';

interface SuggestionContext {
  toolCalls: ChatToolCall[];
  originalQuery: string;
}

interface ExtractedEntities {
  games: Array<{ name: string; appid?: number }>;
  publishers: Array<{ name: string; id?: number }>;
  developers: Array<{ name: string; id?: number }>;
  tags: string[];
}

/**
 * Extract entity names from tool results.
 */
function extractEntities(toolCalls: ChatToolCall[]): ExtractedEntities {
  const entities: ExtractedEntities = {
    games: [],
    publishers: [],
    developers: [],
    tags: [],
  };

  for (const tc of toolCalls) {
    if (!tc.result?.success) continue;

    // Extract from query_analytics results
    if (tc.name === 'query_analytics' && tc.result.data) {
      const data = tc.result.data as Record<string, unknown>[];
      for (const row of data.slice(0, 3)) {
        // Look for game names
        const gameName = row['Discovery.name'] || row['LatestMetrics.name'];
        const appid = row['Discovery.appid'] || row['LatestMetrics.appid'];
        if (gameName && typeof gameName === 'string') {
          entities.games.push({ name: gameName, appid: appid as number });
        }
        // Look for publisher/developer names
        const pubName = row['PublisherMetrics.name'] || row['PublisherGameMetrics.publisherName'];
        const pubId = row['PublisherMetrics.publisherId'] || row['PublisherGameMetrics.publisherId'];
        if (pubName && typeof pubName === 'string') {
          entities.publishers.push({ name: pubName, id: pubId as number });
        }
        const devName = row['DeveloperMetrics.name'] || row['DeveloperGameMetrics.developerName'];
        const devId = row['DeveloperMetrics.developerId'] || row['DeveloperGameMetrics.developerId'];
        if (devName && typeof devName === 'string') {
          entities.developers.push({ name: devName, id: devId as number });
        }
      }
    }

    // Extract from find_similar results
    if (tc.name === 'find_similar' && tc.result.results) {
      const results = tc.result.results as Array<{ name: string; id: number }>;
      for (const item of results.slice(0, 3)) {
        if (item.name) {
          entities.games.push({ name: item.name, appid: item.id });
        }
      }
      // Also extract reference game
      if (tc.result.reference?.name) {
        entities.games.unshift({
          name: tc.result.reference.name,
          appid: tc.result.reference.id,
        });
      }
    }

    // Extract from search_games results
    if (tc.name === 'search_games' && tc.result.results) {
      const results = tc.result.results as Array<{ name: string; appid: number }>;
      for (const item of results.slice(0, 3)) {
        if (item.name) {
          entities.games.push({ name: item.name, appid: item.appid });
        }
      }
    }

    // Extract from search_by_concept results
    if (tc.name === 'search_by_concept' && tc.result.results) {
      const results = tc.result.results as Array<{ name: string; appid: number }>;
      for (const item of results.slice(0, 3)) {
        if (item.name) {
          entities.games.push({ name: item.name, appid: item.appid });
        }
      }
    }

    // Extract from discover_trending results
    if (tc.name === 'discover_trending' && tc.result.results) {
      const results = tc.result.results as Array<{ name: string; appid: number }>;
      for (const item of results.slice(0, 3)) {
        if (item.name) {
          entities.games.push({ name: item.name, appid: item.appid });
        }
      }
    }

    if (tc.name === 'screen_games' && tc.result.results) {
      const results = tc.result.results as Array<{ name: string; appid: number }>;
      for (const item of results.slice(0, 3)) {
        if (item.name) {
          entities.games.push({ name: item.name, appid: item.appid });
        }
      }
    }

    // Extract from lookup results
    if (tc.name === 'lookup_games' && tc.result.results) {
      const results = tc.result.results as Array<{ name: string; appid: number }>;
      for (const item of results.slice(0, 2)) {
        if (item.name) {
          entities.games.push({ name: item.name, appid: item.appid });
        }
      }
    }

    if (tc.name === 'lookup_publishers' && tc.result.results) {
      const results = tc.result.results as Array<{ name: string; id: number }>;
      for (const item of results.slice(0, 2)) {
        if (item.name) {
          entities.publishers.push({ name: item.name, id: item.id });
        }
      }
    }

    if (tc.name === 'lookup_developers' && tc.result.results) {
      const results = tc.result.results as Array<{ name: string; id: number }>;
      for (const item of results.slice(0, 2)) {
        if (item.name) {
          entities.developers.push({ name: item.name, id: item.id });
        }
      }
    }

    if (tc.name === 'query_change_activity' && tc.result.results) {
      const results = tc.result.results as Array<{ name: string; appid: number }>;
      for (const item of results.slice(0, 3)) {
        if (item.name) {
          entities.games.push({ name: item.name, appid: item.appid });
        }
      }
    }

    if (tc.name === 'get_game_change_timeline' && tc.result.app) {
      const app = tc.result.app as { name?: string; appid?: number };
      if (app.name) {
        entities.games.unshift({ name: app.name, appid: app.appid });
      }
    }

    if (tc.name === 'compare_change_before_after' && tc.result.app) {
      const app = tc.result.app as { name?: string; appid?: number };
      if (app.name) {
        entities.games.unshift({ name: app.name, appid: app.appid });
      }
    }

    if (tc.name === 'get_recent_news_digest') {
      if (Array.isArray(tc.result.apps)) {
        const apps = tc.result.apps as Array<{ name?: string; appid?: number }>;
        for (const app of apps.slice(0, 3)) {
          if (app.name) {
            entities.games.push({ name: app.name, appid: app.appid });
          }
        }
      } else if (tc.result.app) {
        const app = tc.result.app as { name?: string; appid?: number };
        if (app.name) {
          entities.games.unshift({ name: app.name, appid: app.appid });
        }
      }

      if (Array.isArray(tc.result.items)) {
        const items = tc.result.items as Array<{ appName?: string; appid?: number }>;
        for (const item of items.slice(0, 3)) {
          if (item.appName) {
            entities.games.push({ name: item.appName, appid: item.appid });
          }
        }
      }
    }

    // Extract tags from arguments
    const args = tc.arguments as Record<string, unknown>;
    if (args.tags && Array.isArray(args.tags)) {
      entities.tags.push(...(args.tags as string[]));
    }
    if (args.genres && Array.isArray(args.genres)) {
      entities.tags.push(...(args.genres as string[]));
    }
  }

  // Dedupe
  entities.games = dedupeByName(entities.games);
  entities.publishers = dedupeByName(entities.publishers);
  entities.developers = dedupeByName(entities.developers);
  entities.tags = [...new Set(entities.tags)];

  return entities;
}

function dedupeByName<T extends { name: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter(item => {
    const key = item.name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Generate suggestions based on tool used.
 */
function generateToolBasedSuggestions(
  toolCalls: ChatToolCall[],
  entities: ExtractedEntities
): QuerySuggestion[] {
  const suggestions: QuerySuggestion[] = [];
  const toolNames = new Set(toolCalls.map(tc => tc.name));

  // Based on find_similar
  if (toolNames.has('find_similar')) {
    const game = entities.games[0];
    if (game) {
      suggestions.push({
        label: `Hidden gems like ${game.name}`,
        query: `hidden gem games like ${game.name}`,
        category: 'game',
      });
      suggestions.push({
        label: `Steam Deck games like ${game.name}`,
        query: `Steam Deck games similar to ${game.name}`,
        category: 'game',
      });
    }
  }

  // Based on search_games or search_by_concept
  if (toolNames.has('search_games') || toolNames.has('search_by_concept')) {
    const tag = entities.tags[0];
    if (tag) {
      suggestions.push({
        label: `Trending ${tag} games`,
        query: `trending ${tag} games`,
        category: 'tag',
      });
      suggestions.push({
        label: `${tag} games on Steam Deck`,
        query: `${tag} games on Steam Deck`,
        category: 'tag',
      });
    }
    // Suggest similarity on top result
    const game = entities.games[0];
    if (game) {
      suggestions.push({
        label: `Games like ${game.name}`,
        query: `games similar to ${game.name}`,
        category: 'game',
      });
    }
  }

  // Based on discover_trending
  if (toolNames.has('discover_trending')) {
    suggestions.push({
      label: "What's breaking out?",
      query: "what's breaking out right now?",
      category: 'template',
    });
    const game = entities.games[0];
    if (game) {
      suggestions.push({
        label: `Tell me about ${game.name}`,
        query: `tell me about ${game.name}`,
        category: 'game',
      });
    }
  }

  if (toolNames.has('screen_games')) {
    suggestions.push({
      label: "What's breaking out?",
      query: "what's breaking out right now?",
      category: 'template',
    });
    const game = entities.games[0];
    if (game) {
      suggestions.push({
        label: `Tell me about ${game.name}`,
        query: `tell me about ${game.name}`,
        category: 'game',
      });
    }
  }

  // Based on query_analytics with games
  if (toolNames.has('query_analytics') && entities.games.length > 0) {
    const game = entities.games[0];
    suggestions.push({
      label: `Games like ${game.name}`,
      query: `games similar to ${game.name}`,
      category: 'game',
    });
  }

  if (
    (toolNames.has('query_change_activity') ||
      toolNames.has('get_game_change_timeline') ||
      toolNames.has('get_recent_news_digest')) &&
    entities.games.length > 0
  ) {
    if (entities.games.length > 1 && (toolNames.has('query_change_activity') || toolNames.has('get_recent_news_digest'))) {
      const titles = entities.games.slice(0, 3).map((game) => game.name);
      const joinedTitles =
        titles.length === 2
          ? `${titles[0]} and ${titles[1]}`
          : `${titles.slice(0, -1).join(', ')}, and ${titles[titles.length - 1]}`;

      suggestions.push({
        label: 'Recent news across these titles',
        query: `Summarize the most meaningful recent Steam news across ${joinedTitles}.`,
        category: 'template',
      });
      suggestions.push({
        label: 'Biggest news change here',
        query: `Which of ${joinedTitles} had the most material recent Steam news change, and why?`,
        category: 'template',
      });
    } else {
      const game = entities.games[0];
      suggestions.push({
        label: `What changed in ${game.name} news?`,
        query: `What actually changed in the latest Steam news for ${game.name}?`,
        category: 'game',
      });
      suggestions.push({
        label: `Recent news for ${game.name}`,
        query: `Summarize the most important recent Steam news updates for ${game.name}.`,
        category: 'game',
      });
      if (toolNames.has('get_game_change_timeline') || toolNames.has('query_change_activity')) {
        suggestions.push({
          label: `Compare ${game.name} before and after`,
          query: `What changed on ${game.name} before and after its latest major update?`,
          category: 'game',
        });
      }
    }
  }

  if (toolNames.has('find_change_patterns')) {
    suggestions.push({
      label: 'Recent marketing pushes',
      query: 'Which games look like they started a new marketing push recently?',
      category: 'template',
    });
    suggestions.push({
      label: 'Recent relaunch patterns',
      query: 'Show me games that used a likely relaunch pattern recently',
      category: 'template',
    });
  }

  // Based on lookup_games (specific game query)
  if (toolNames.has('lookup_games') && entities.games.length > 0) {
    const game = entities.games[0];
    suggestions.push({
      label: `Games similar to ${game.name}`,
      query: `games similar to ${game.name}`,
      category: 'game',
    });
    // Try to find developer/publisher from results
    const tc = toolCalls.find(t => t.name === 'lookup_games');
    const results = tc?.result?.results as Array<{ developer?: string; publisher?: string }> | undefined;
    if (results?.[0]?.developer) {
      suggestions.push({
        label: `More by ${results[0].developer}`,
        query: `all games by ${results[0].developer}`,
        category: 'developer',
      });
    }
  }

  // Based on publisher/developer lookups
  if (toolNames.has('lookup_publishers') && entities.publishers.length > 0) {
    const pub = entities.publishers[0];
    suggestions.push({
      label: `${pub.name}'s best rated games`,
      query: `${pub.name} games with best reviews`,
      category: 'publisher',
    });
  }

  if (toolNames.has('lookup_developers') && entities.developers.length > 0) {
    const dev = entities.developers[0];
    suggestions.push({
      label: `All games by ${dev.name}`,
      query: `all games by ${dev.name}`,
      category: 'developer',
    });
  }

  return suggestions;
}

/**
 * Generate fallback suggestions when no specific patterns match.
 */
function generateFallbackSuggestions(
  entities: ExtractedEntities
): QuerySuggestion[] {
  const suggestions: QuerySuggestion[] = [];

  // Suggest based on any extracted game
  if (entities.games.length > 0) {
    const game = entities.games[0];
    suggestions.push({
      label: `Games like ${game.name}`,
      query: `games similar to ${game.name}`,
      category: 'game',
    });
  }

  // General discovery suggestions
  suggestions.push({
    label: "What's trending?",
    query: "what games are trending right now?",
    category: 'template',
  });

  suggestions.push({
    label: 'Steam Deck verified gems',
    query: 'hidden gem games on Steam Deck with great reviews',
    category: 'template',
  });

  return suggestions;
}

/**
 * Main function to generate post-response suggestions.
 */
export function generatePostResponseSuggestions(
  context: SuggestionContext,
  maxSuggestions = 4
): QuerySuggestion[] {
  const { toolCalls } = context;

  // If no tool calls or all failed, return generic suggestions
  const successfulCalls = toolCalls.filter(tc => tc.result?.success);
  if (successfulCalls.length === 0) {
    return generateFallbackSuggestions({ games: [], publishers: [], developers: [], tags: [] })
      .slice(0, maxSuggestions);
  }

  // Extract entities from results
  const entities = extractEntities(successfulCalls);

  // Generate tool-based suggestions
  const suggestions = generateToolBasedSuggestions(successfulCalls, entities);

  // Add fallback suggestions if we don't have enough
  if (suggestions.length < maxSuggestions) {
    const fallbacks = generateFallbackSuggestions(entities);
    suggestions.push(...fallbacks);
  }

  // Dedupe and limit
  const seen = new Set<string>();
  return suggestions
    .filter(s => {
      const key = s.query.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, maxSuggestions);
}
