# Chat Interface Guide

PublisherIQ chat is a natural-language interface for querying Steam data, similarity search, and Steam change intelligence.

**Last Updated:** March 30, 2026

> Related docs:
> - [Chat Query Examples](./chat-query-examples.md)
> - [Streaming API](../api/streaming-api.md)
> - [Chat Data System](../developer-guide/architecture/chat-data-system.md)
> - [Change Feed Guide](./change-feed.md)

## Getting Started

1. Open `/chat`
2. Type a question or prefill one with `/chat?q=...`
3. Press Enter
4. Review the answer, the linked entities, and the query details panel

## What Chat Uses

The chat route can call these tool families:

- Structured analytics: `query_analytics`
- Similarity and discovery: `find_similar`, `search_by_concept`, `search_games`, `lookup_tags`, `lookup_publishers`, `lookup_developers`, `lookup_games`, `discover_trending`, `screen_games`
- Change intelligence: `query_change_activity`, `get_game_change_timeline`, `get_recent_news_detail`, `get_recent_news_digest`, `search_recent_news_topics`, `get_change_activity_detail`, `compare_change_before_after`, `find_change_patterns`

Use these rules as a shortcut:

- Use `lookup_games` first when a specific title might be ambiguous or misspelled.
- Use `get_game_change_timeline` for one game’s recent Storefront, PICS, media, and news history.
- Use `get_recent_news_detail` when the user wants the newest Steam news item specifically.
- Use `get_recent_news_digest` for a bounded recent-news summary across one title or a small set of titles.
- Use `search_recent_news_topics` for cross-game topic searches like developer diaries, roadmaps, demos, playtests, or patch notes.
- Use `find_change_patterns` for marketing push, relaunch, update tease, under-marketed, signable, rescue, sustained-response, or weak-response prompts.
- Use `screen_games` for strict games-page style screening with ranking metrics.
- Use `discover_trending` for momentum-focused questions like accelerating or breaking-out games.

## What You Can Ask

### Specific Titles

- "Tell me about Hades II"
- "What changed on ARC Raiders in the last 90 days?"
- "What actually changed in the latest Steam news for No Rest for the Wicked?"
- "Show me the before and after for that update"

### Discovery and Analytics

- "What are the top games by review score?"
- "Show me games similar to Hades but less popular"
- "Which games are gaining traction this week?"
- "Find cozy farming games with crafting"
- "What Steam Deck verified roguelikes have at least 1,000 reviews?"

### Recent News and Change Intelligence

- "What games have released developer diaries lately?"
- "Which games posted patch notes lately?"
- "Summarize recent Steam news across ARC Raiders and THE FINALS"
- "Find games that look like signable candidates"
- "Which titles had a marketing push without much downstream response?"

## What Responses Look Like

Chat responses are streamed live and may include:

- markdown tables
- clickable game, publisher, and developer links
- code blocks for SQL or examples
- answer follow-ups when the first result is sparse or incomplete

Open the query details panel to inspect:

- tool calls and arguments
- execution timing
- iteration count
- quality flags
- guardrail trace
- session context carried into the next turn

The session context carries the current resolved entities, active constraints, candidate sets, and last-answer state so follow-up turns can continue the same thread without starting from scratch.

## Tips for Better Results

- Be specific about the title, time window, or filter you want.
- Prefer exact game names for one-title questions.
- Use topic language for recent-news prompts instead of asking for generic "changes."
- If you want the newest Steam post for one title, ask for the latest news item directly.
- If you want a broader "what changed" view, ask for the game timeline instead.

## Related Documentation

- [Chat Query Examples](./chat-query-examples.md)
- [Change Feed Guide](./change-feed.md)
- [Account Guide](./account.md)
- [Streaming API](../api/streaming-api.md)
- [Chat Data System](../developer-guide/architecture/chat-data-system.md)
