/**
 * Example prompts for the chat interface.
 * Dashboard and input selections stay deterministic per surface.
 * The chat landing surface uses a curated, seeded rotation.
 */

export const EXAMPLE_PROMPTS = [
  // Change Intelligence
  'Show me the biggest Steam store-page changes in the last 30 days',
  'What changed on Hades II before and after its last big update?',
  'Which upcoming games changed release timing recently?',
  'Find games that refreshed screenshots or trailers without an announcement',
  'Which titles look like they started a new marketing push this month?',

  // Game Discovery
  "Find me Steam Deck verified roguelikes with great reviews",
  "What are the best VR games on Steam?",
  "Show me co-op games that work on Linux",
  "Find indie games released this year with overwhelmingly positive reviews",
  "What free-to-play games have the most players right now?",

  // Publisher/Developer Discovery
  "What publisher has the most games on Steam?",
  "Show me all games by FromSoftware",
  "Which indie developers have multiple hit games?",
  "What publishers are releasing the most games this year?",

  // Franchise & Series
  "What games are in the Half-Life franchise?",
  "Show me all the DLC for Elden Ring",
  "Find games in the same series as Dark Souls",

  // Trends & Analytics
  "What games are trending up in reviews right now?",
  "Which popular games are getting worse reviews lately?",
  "What genres have the most new releases?",
  "Show me games that went from Mixed to Positive reviews",

  // Comparisons & Lists
  "Compare the review scores of Valve's games",
  "What are the highest-rated games with controller support?",
  "Show me RPGs with high Metacritic scores",
  "Which multiplayer games have the best reviews?",
];

export type ExamplePromptSurface = 'dashboard' | 'chat' | 'chat-input';

const CHAT_LANDING_GROUPS = [
  { id: 'discover-games', title: 'Discover Games' },
  { id: 'track-momentum', title: 'Track Momentum' },
  { id: 'research-companies', title: 'Research Companies' },
  { id: 'watch-changes', title: 'Watch Changes' },
] as const;

type ChatLandingPromptGroupId = (typeof CHAT_LANDING_GROUPS)[number]['id'];

interface ChatLandingPromptRecord {
  id: string;
  category: ChatLandingPromptGroupId;
  query: string;
}

export interface ChatLandingPrompt {
  id: string;
  query: string;
}

export interface ChatLandingPromptGroup {
  id: ChatLandingPromptGroupId;
  title: string;
  prompts: ChatLandingPrompt[];
}

const CHAT_LANDING_PROMPTS: readonly ChatLandingPromptRecord[] = [
  {
    id: 'discover-hollow-knight',
    category: 'discover-games',
    query: 'Games similar to Hollow Knight with fewer than 10K reviews',
  },
  {
    id: 'discover-cozy-farming',
    category: 'discover-games',
    query: 'Find cozy farming games under $20',
  },
  {
    id: 'discover-linux-positive',
    category: 'discover-games',
    query: 'Show me Linux games with overwhelmingly positive reviews',
  },
  {
    id: 'discover-steam-deck-roguelikes',
    category: 'discover-games',
    query: 'Find me Steam Deck verified roguelikes with great reviews',
  },
  {
    id: 'discover-vr',
    category: 'discover-games',
    query: 'What are the best VR games on Steam?',
  },
  {
    id: 'discover-coop-linux',
    category: 'discover-games',
    query: 'Show me co-op games that work on Linux',
  },
  {
    id: 'discover-dark-souls-franchise',
    category: 'discover-games',
    query: 'Find games in the same series as Dark Souls',
  },
  {
    id: 'discover-hades-breakout',
    category: 'discover-games',
    query: 'Games like Hades that are breaking out this week',
  },
  {
    id: 'discover-hades-franchise-deck',
    category: 'discover-games',
    query: 'Steam Deck games similar to Hades II from the same franchise',
  },
  {
    id: 'discover-multiplayer-reviews',
    category: 'discover-games',
    query: 'Which multiplayer games have the best reviews?',
  },
  {
    id: 'discover-rpg-metacritic',
    category: 'discover-games',
    query: 'Show me RPGs with high Metacritic scores',
  },
  {
    id: 'momentum-most-players',
    category: 'track-momentum',
    query: 'What game has the most players right now?',
  },
  {
    id: 'momentum-free-to-play',
    category: 'track-momentum',
    query: 'What free-to-play games have the most players right now?',
  },
  {
    id: 'momentum-steam-deck',
    category: 'track-momentum',
    query: 'Show Steam Deck verified games with review momentum',
  },
  {
    id: 'momentum-top-indie',
    category: 'track-momentum',
    query: 'What are the top indie games currently?',
  },
  {
    id: 'momentum-ccu-owners',
    category: 'track-momentum',
    query: 'Show Counter-Strike 2 CCU and owners over the last 30 days',
  },
  {
    id: 'momentum-reviews-30d',
    category: 'track-momentum',
    query: 'How have Hades II reviews changed over the last 30 days?',
  },
  {
    id: 'momentum-worse-reviews',
    category: 'track-momentum',
    query: 'Which popular games are getting worse reviews lately?',
  },
  {
    id: 'momentum-trending-reviews',
    category: 'track-momentum',
    query: 'What games are trending up in reviews right now?',
  },
  {
    id: 'momentum-improving-sentiment',
    category: 'track-momentum',
    query: 'Show me games with improving sentiment',
  },
  {
    id: 'momentum-deck-worsening-sentiment',
    category: 'track-momentum',
    query: 'Show Steam Deck verified games with worsening sentiment',
  },
  {
    id: 'momentum-mixed-to-positive',
    category: 'track-momentum',
    query: 'Show me games that went from Mixed to Positive reviews',
  },
  {
    id: 'companies-compare-major',
    category: 'research-companies',
    query: 'Compare FromSoftware to Rockstar Games',
  },
  {
    id: 'companies-fromsoftware-players',
    category: 'research-companies',
    query: 'How many players do FromSoftware games have?',
  },
  {
    id: 'companies-fromsoftware-catalog',
    category: 'research-companies',
    query: 'Show me all games by FromSoftware',
  },
  {
    id: 'companies-most-games',
    category: 'research-companies',
    query: 'What publisher has the most games on Steam?',
  },
  {
    id: 'companies-hit-developers',
    category: 'research-companies',
    query: 'Which indie developers have multiple hit games?',
  },
  {
    id: 'companies-release-volume',
    category: 'research-companies',
    query: 'What publishers are releasing the most games this year?',
  },
  {
    id: 'companies-top-reviews',
    category: 'research-companies',
    query: 'What are the top games by reviews?',
  },
  {
    id: 'companies-hades-dead-cells',
    category: 'research-companies',
    query: 'Compare Hades and Dead Cells',
  },
  {
    id: 'companies-fromsoftware-rockstar-reviews',
    category: 'research-companies',
    query: 'Compare FromSoftware to Rockstar Games by reviews',
  },
  {
    id: 'companies-devolver-similar',
    category: 'research-companies',
    query: 'What publishers are similar to Devolver Digital?',
  },
  {
    id: 'companies-valve-review-scores',
    category: 'research-companies',
    query: "Compare the review scores of Valve's games",
  },
  {
    id: 'changes-hades-update',
    category: 'watch-changes',
    query: 'What changed on Hades II before and after its last big update?',
  },
  {
    id: 'changes-store-page',
    category: 'watch-changes',
    query: 'Show me the biggest Steam store-page changes in the last 30 days',
  },
  {
    id: 'changes-primeval-announcements',
    category: 'watch-changes',
    query: 'Any recent announcements about Primeval?',
  },
  {
    id: 'changes-primeval-patch-notes',
    category: 'watch-changes',
    query: 'Find patch notes for Primeval',
  },
  {
    id: 'changes-release-timing',
    category: 'watch-changes',
    query: 'Which upcoming games changed release timing recently?',
  },
  {
    id: 'changes-marketing-push',
    category: 'watch-changes',
    query: 'Which titles look like they started a new marketing push this month?',
  },
  {
    id: 'changes-primeval-week',
    category: 'watch-changes',
    query: 'What changed for Primeval this week?',
  },
  {
    id: 'changes-media-refresh',
    category: 'watch-changes',
    query: 'Find games that refreshed screenshots or trailers without an announcement',
  },
  {
    id: 'changes-patch-notes-lately',
    category: 'watch-changes',
    query: 'Which games posted patch notes lately?',
  },
  {
    id: 'changes-developer-diaries',
    category: 'watch-changes',
    query: 'What games have released developer diaries lately?',
  },
] as const;

function getSurfaceOffset(surface: ExamplePromptSurface): number {
  return [...surface].reduce((hash, char) => {
    return (hash * 31 + char.charCodeAt(0)) % EXAMPLE_PROMPTS.length;
  }, 0);
}

/**
 * Returns a deterministic selection of example prompts for a UI surface.
 */
export function getExamplePrompts(
  surface: ExamplePromptSurface,
  count: number = 4
): string[] {
  const safeCount = Math.max(0, Math.min(count, EXAMPLE_PROMPTS.length));
  const offset = getSurfaceOffset(surface);

  return Array.from({ length: safeCount }, (_, index) => {
    return EXAMPLE_PROMPTS[(offset + index) % EXAMPLE_PROMPTS.length];
  });
}

export function getChatLandingPromptGroups(
  seed: string,
  countPerCategory: number = 4
): ChatLandingPromptGroup[] {
  const safeCount = Math.max(1, countPerCategory);

  return CHAT_LANDING_GROUPS.map((group) => {
    const prompts = selectSeededPrompts(
      CHAT_LANDING_PROMPTS.filter((prompt) => prompt.category === group.id),
      `${seed}:${group.id}`,
      safeCount
    ).map(({ id, query }) => ({ id, query }));

    return {
      id: group.id,
      title: group.title,
      prompts,
    };
  });
}

function selectSeededPrompts<T extends { query: string }>(
  prompts: readonly T[],
  seed: string,
  count: number
): T[] {
  const selected: T[] = [];
  const seen = new Set<string>();

  for (const prompt of seededShuffle(prompts, seed)) {
    const key = prompt.query.trim().toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    selected.push(prompt);

    if (selected.length >= count) {
      break;
    }
  }

  return selected;
}

function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  const result = [...items];
  const random = createSeededRandom(seed);

  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }

  return result;
}

function createSeededRandom(seed: string): () => number {
  let state = hashSeed(seed) || 0x9e3779b9;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(seed: string): number {
  let hash = 2166136261;

  for (const char of seed) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}
