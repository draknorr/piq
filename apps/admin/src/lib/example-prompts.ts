/**
 * Example prompts for the chat interface.
 * Selections are deterministic per surface to avoid hydration mismatches.
 */

export const EXAMPLE_PROMPTS = [
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
