# Chat Interface Guide

PublisherIQ chat is a natural-language interface for querying Steam data, similarity search, and Steam change intelligence.

**Last Updated:** April 6, 2026

> Related docs:
> - [Chat Query Examples](./chat-query-examples.md)
> - [Streaming API](../api/streaming-api.md)
> - [Change Feed Guide](./change-feed.md)

## Getting Started

1. Open `/chat`
2. Type a question or prefill one with `/chat?q=...`
3. Press Enter
4. Review the answer, the linked entities, and the query details panel

## What Chat Can Do

The chat route supports these capability families:

- Structured analytics for ranked lists, counts, and comparisons
- Similarity and discovery for "games like X" and concept-based search
- Trend and screening for momentum, velocity, and market screens
- Change intelligence for store-page, announcement, and before/after analysis
- Recent news search for the latest stored Steam news and topic lookups
- Follow-up continuation so "show me more" and "same but..." stay on the same result set

Use these rules as a shortcut:

- Resolve a specific title first when the name may be ambiguous or misspelled.
- Use a game timeline for one title’s recent storefront, media, and news history.
- Ask for the latest news item when you want the newest stored post only.
- Ask for a digest when you want a bounded summary across one or a few titles.
- Use topic search when you care about content across many games rather than one named title.
- Use a market screen when you want a strict ranked list with explicit filters and sorting.
- Use momentum discovery when you want accelerating, breakout, or declining titles.

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
